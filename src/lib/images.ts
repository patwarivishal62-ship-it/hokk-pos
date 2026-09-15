/**
 * Image naming convention + upload validation (spec §20/§21).
 * Pure functions — no I/O — so they are unit tested directly.
 */
import { extensionFor, inspectImage } from '@/lib/image-info';

export interface ImageRules {
  maxBytes: number;
  minBytes: number;
  minWidth: number;
  minHeight: number;
  allowedTypes: string[];
  recommendBytes: number;
}

export const DEFAULT_IMAGE_RULES: ImageRules = {
  maxBytes: 15 * 1024 * 1024,
  minBytes: 20 * 1024,
  minWidth: 1200,
  minHeight: 1200,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  recommendBytes: 2 * 1024 * 1024,
};

/**
 * Canonical filename: {SKU}-{SLOT}.jpg  →  HOKK-SAR-ZK-001-HERO.jpg
 * Falls back to a sanitised original name when no slot is chosen.
 */
export function canonicalFileName(opts: {
  sku: string;
  slotSuffix?: string | null;
  mimeType: string;
  originalName?: string;
  index?: number;
}): string {
  const sku = (opts.sku || 'UNASSIGNED').toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  const ext = extensionFor(opts.mimeType);
  if (opts.slotSuffix) {
    const suffix = opts.slotSuffix.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `${sku}-${suffix}.${ext}`;
  }
  const base = (opts.originalName ?? 'IMG')
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const seq = typeof opts.index === 'number' ? `-${String(opts.index).padStart(2, '0')}` : '';
  return `${sku}-${base || 'IMAGE'}${seq}.${ext}`;
}

export interface ImageIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
}

export function validateImageBuffer(
  buf: Buffer,
  opts: { mimeType: string; originalName: string; rules?: ImageRules },
): ImageIssue[] {
  const rules = opts.rules ?? DEFAULT_IMAGE_RULES;
  const issues: ImageIssue[] = [];
  const info = inspectImage(buf);

  if (!rules.allowedTypes.includes(opts.mimeType.toLowerCase())) {
    issues.push({
      code: 'TYPE_NOT_ALLOWED',
      message: `${opts.originalName}: ${opts.mimeType || 'unknown type'} is not an accepted format. Allowed: ${rules.allowedTypes.join(', ')}.`,
      severity: 'ERROR',
    });
  }
  if (info.format === 'unknown') {
    issues.push({
      code: 'UNREADABLE',
      message: `${opts.originalName}: the file does not look like a valid image.`,
      severity: 'ERROR',
    });
  }
  if (buf.length > rules.maxBytes) {
    issues.push({
      code: 'TOO_LARGE',
      message: `${opts.originalName}: ${(buf.length / 1024 / 1024).toFixed(1)} MB exceeds the ${(rules.maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
      severity: 'ERROR',
    });
  }
  if (buf.length < rules.minBytes) {
    issues.push({
      code: 'TOO_SMALL',
      message: `${opts.originalName}: only ${(buf.length / 1024).toFixed(0)} KB — likely a thumbnail or preview, not a master photograph.`,
      severity: 'WARNING',
    });
  }
  if (info.width && info.width < rules.minWidth) {
    issues.push({
      code: 'WIDTH_TOO_SMALL',
      message: `${opts.originalName}: ${info.width}px wide, below the recommended ${rules.minWidth}px.`,
      severity: 'WARNING',
    });
  }
  if (info.height && info.height < rules.minHeight) {
    issues.push({
      code: 'HEIGHT_TOO_SMALL',
      message: `${opts.originalName}: ${info.height}px tall, below the recommended ${rules.minHeight}px.`,
      severity: 'WARNING',
    });
  }
  return issues;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Builds the per-slot photography checklist (spec §17).
 * `images` must already carry slot_key so we can group.
 */
export interface SlotChecklistItem {
  slotId: string;
  slotKey: string;
  label: string;
  fileSuffix: string;
  required: boolean;
  count: number;
  state: 'FILLED' | 'MISSING';
}

export function buildSlotChecklist(
  slots: Array<{ id: string; key: string; label: string; file_suffix: string; is_required: number }>,
  images: Array<{ slot_id: string | null }>,
): SlotChecklistItem[] {
  // Order comes from the caller (image_slot_definition.sort_order), which is
  // the shooting order the team works in: HERO, FULL, DETAIL, PALLU, ...
  return slots
    .slice()
    .map((slot) => {
      const count = images.filter((img) => img.slot_id === slot.id).length;
      return {
        slotId: slot.id,
        slotKey: slot.key,
        label: slot.label,
        fileSuffix: slot.file_suffix,
        required: slot.is_required === 1,
        count,
        state: count > 0 ? 'FILLED' : 'MISSING',
      };
    });
}

export function photographyProgress(checklist: SlotChecklistItem[]): { complete: number; required: number; pct: number } {
  const requiredSlots = checklist.filter((s) => s.required);
  const complete = requiredSlots.filter((s) => s.state === 'FILLED').length;
  const required = requiredSlots.length;
  return { complete, required, pct: required === 0 ? 0 : Math.round((complete / required) * 100) };
}
