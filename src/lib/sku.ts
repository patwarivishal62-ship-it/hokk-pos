/**
 * SKU generation (spec §3).
 *
 * Pattern is configurable, e.g. HOKK-{TYPE}-{CULTURE}-{SEQ}
 *   HOKK-SAR-ZK-001
 *   HOKK-APP-TS-014
 *
 * The sequence is scoped (GLOBAL | CULTURE | CATEGORY) and derived from the
 * highest existing suffix so deleted products never cause a SKU to be reused.
 */
import { all } from '@/lib/db';

export const SKU_PATTERN_DEFAULT = 'HOKK-{TYPE}-{CULTURE}-{SEQ}';
const SKU_REGEX = /^[A-Z0-9][A-Z0-9-]*$/;

export interface SkuSegment {
  type?: string | null;
  culture?: string | null;
  category?: string | null;
}

export function normalizeSegment(value: string | null | undefined, maxLength = 4): string {
  const cleaned = (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLength);
  return cleaned;
}

export function buildSkuPrefix(pattern: string, segments: SkuSegment): string {
  const replaced = pattern
    .replace(/\{TYPE\}/gi, () => normalizeSegment(segments.type, 4) || 'GEN')
    .replace(/\{CULTURE\}/gi, () => normalizeSegment(segments.culture, 4))
    .replace(/\{CATEGORY\}/gi, () => normalizeSegment(segments.category, 4))
    .replace(/\{SEQ\}/gi, '');
  return replaced
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatSequence(n: number, padding: number): string {
  return String(Math.max(1, Math.floor(n))).padStart(Math.max(1, padding), '0');
}

/** Highest existing numeric suffix for a prefix, or 0 when none exist. */
export function maxSequence(prefix: string, existingSkus: string[]): number {
  const needle = `${prefix}-`;
  let max = 0;
  for (const sku of existingSkus) {
    if (!sku.toUpperCase().startsWith(needle.toUpperCase())) continue;
    const tail = sku.slice(needle.length);
    const match = /^(\d+)$/.exec(tail);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

export function generateSku(opts: {
  pattern?: string;
  padding?: number;
  prefix: string;
  existingSkus: string[];
  reserved?: Set<string>;
}): string {
  const padding = opts.padding ?? 3;
  const reserved = opts.reserved ?? new Set<string>();
  let next = maxSequence(opts.prefix, opts.existingSkus) + 1;
  // Skip anything already reserved in this batch (bulk create).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${opts.prefix}-${formatSequence(next, padding)}`;
    const exists = opts.existingSkus.some((s) => s.toUpperCase() === candidate.toUpperCase());
    if (!exists && !reserved.has(candidate.toUpperCase())) return candidate;
    next += 1;
    if (next > 9_999_999) throw new Error('SKU sequence exhausted.');
  }
}

export function isValidSku(sku: string): boolean {
  return !!sku && sku.length <= 64 && SKU_REGEX.test(sku);
}

export function skuIssues(sku: string): string[] {
  const problems: string[] = [];
  if (!sku) {
    problems.push('SKU is required.');
    return problems;
  }
  if (!SKU_REGEX.test(sku)) problems.push('SKU may only contain uppercase letters, numbers and hyphens.');
  if (sku.length > 64) problems.push('SKU must be 64 characters or fewer.');
  return problems;
}

export function loadExistingSkus(): string[] {
  return all<{ sku: string }>('SELECT sku FROM product').map((r) => r.sku);
}
