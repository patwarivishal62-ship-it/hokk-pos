import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, migrate, run, schemaVersion, tableExists } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { hashPassword } from '@/lib/password';
import { DEFAULT_ROLES } from '@/lib/rbac';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import { CURRENT_SCHEMA, findPreset } from '@/lib/shopify/schema';

export const SCHEMA_VERSION = 1;

interface SlotSeed {
  key: string;
  label: string;
  suffix: string;
  required: boolean;
  guidance?: string;
}

const IMAGE_TEMPLATES: Array<{ key: string; name: string; description: string; slots: SlotSeed[] }> = [
  {
    key: 'SAREE',
    name: 'Saree photography',
    description: 'Required and optional assets for a saree listing.',
    slots: [
      { key: 'HERO', label: 'Hero / model', suffix: 'HERO', required: true, guidance: 'Full drape on model, front facing, clean background.' },
      { key: 'FULL', label: 'Full look', suffix: 'FULL', required: true, guidance: 'Complete drape including pallu fall.' },
      { key: 'DETAIL', label: 'Detail', suffix: 'DETAIL', required: true, guidance: 'Close-up of weave and motif.' },
      { key: 'PALLU', label: 'Pallu', suffix: 'PALLU', required: true, guidance: 'Pallu laid flat or draped, full width visible.' },
      { key: 'BORDER', label: 'Border', suffix: 'BORDER', required: true, guidance: 'Border running the length of the saree.' },
      { key: 'FABRIC', label: 'Fabric / weave', suffix: 'FABRIC', required: true, guidance: 'Macro shot showing handloom texture.' },
      { key: 'BLOUSE', label: 'Blouse', suffix: 'BLOUSE', required: false, guidance: 'Attached or unstitched blouse piece.' },
      { key: 'EDITORIAL', label: 'Editorial', suffix: 'EDITORIAL', required: false, guidance: 'Styling / campaign frame.' },
    ],
  },
  {
    key: 'APPAREL',
    name: 'Apparel photography',
    description: 'Required and optional assets for contemporary garments.',
    slots: [
      { key: 'HERO', label: 'Hero / model', suffix: 'HERO', required: true, guidance: 'On model, front facing.' },
      { key: 'FRONT', label: 'Front', suffix: 'FRONT', required: true, guidance: 'Flat lay or ghost mannequin, front.' },
      { key: 'BACK', label: 'Back', suffix: 'BACK', required: true, guidance: 'Flat lay or ghost mannequin, back.' },
      { key: 'SIDE', label: 'Side', suffix: 'SIDE', required: false },
      { key: 'DETAIL', label: 'Detail', suffix: 'DETAIL', required: true, guidance: 'Neckline, closure or print close-up.' },
      { key: 'FABRIC', label: 'Fabric', suffix: 'FABRIC', required: true, guidance: 'Macro shot of the handloom fabric.' },
      { key: 'FIT', label: 'Fit', suffix: 'FIT', required: false, guidance: 'Movement / drape shot.' },
      { key: 'EDITORIAL', label: 'Editorial', suffix: 'EDITORIAL', required: false },
    ],
  },
  {
    key: 'GENERIC',
    name: 'Generic product photography',
    description: 'Minimal set for categories that are neither saree nor apparel.',
    slots: [
      { key: 'HERO', label: 'Hero', suffix: 'HERO', required: true },
      { key: 'DETAIL', label: 'Detail', suffix: 'DETAIL', required: false },
      { key: 'EDITORIAL', label: 'Editorial', suffix: 'EDITORIAL', required: false },
    ],
  },
];

interface AttributeSeed {
  templateKey: string;
  groupKey: string;
  groupLabel: string;
  key: string;
  label: string;
  fieldType?: string;
  unit?: string;
  required?: boolean;
  options?: string[];
}

const ATTRIBUTE_SEEDS: AttributeSeed[] = [
  { templateKey: 'SAREE', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'weave_density', label: 'Weave density / count' },
  { templateKey: 'SAREE', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'zari_purity', label: 'Zari purity', fieldType: 'SELECT', options: ['Pure zari', 'Half-fine zari', 'Imitation zari', 'Tested zari'] },
  { templateKey: 'SAREE', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'loom_type', label: 'Loom type', fieldType: 'SELECT', options: ['Pit loom', 'Frame loom', 'Jacquard', 'Dobby'] },
  { templateKey: 'SAREE', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'handloom_mark', label: 'Handloom Mark number' },
  { templateKey: 'SAREE', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'weaving_duration', label: 'Time on the loom', unit: 'days' },
  { templateKey: 'SAREE', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'weaver_cluster', label: 'Weaver cluster / cooperative' },
  { templateKey: 'SAREE', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'gi_tag', label: 'GI tag reference' },
  { templateKey: 'APPAREL', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'gsm', label: 'Fabric GSM', fieldType: 'NUMBER', unit: 'gsm' },
  { templateKey: 'APPAREL', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'shrinkage', label: 'Shrinkage after wash', unit: '%' },
  { templateKey: 'APPAREL', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'colour_fastness', label: 'Colour fastness', fieldType: 'SELECT', options: ['Good', 'Moderate', 'Dry clean only'] },
  { templateKey: 'APPAREL', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'model_height', label: 'Model height', unit: 'cm' },
  { templateKey: 'APPAREL', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'model_wears', label: 'Model wears size' },
  { templateKey: 'APPAREL', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'handwoven', label: 'Handwoven fabric', fieldType: 'BOOLEAN' },
  { templateKey: 'APPAREL', groupKey: 'HANDLOOM', groupLabel: 'Handloom & craft', key: 'fabric_origin', label: 'Fabric origin (mill / cluster)' },
  { templateKey: 'GENERIC', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'gsm', label: 'Fabric GSM', fieldType: 'NUMBER', unit: 'gsm' },
  { templateKey: 'GENERIC', groupKey: 'SPECIFICATION', groupLabel: 'Product details', key: 'model_wears', label: 'Model wears size' },
];

// Performance: cache schema check and init check to avoid DB roundtrips on every request
let schemaEnsured = false;
let schemaEnsuredUrl: string | null = null;
let initCache: { value: boolean; expiresAt: number; url: string } | null = null;
const INIT_TTL = 60_000;

function currentDbUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveDbUrl } = require('@/lib/db') as typeof import('@/lib/db');
    return resolveDbUrl();
  } catch {
    return '';
  }
}

export function ensureSchema(): void {
  const url = currentDbUrl();
  if (schemaEnsured && schemaEnsuredUrl === url) return;
  if (tableExists('product') && schemaVersion() === SCHEMA_VERSION) {
    schemaEnsured = true;
    schemaEnsuredUrl = url;
    return;
  }
  const schemaPath = path.resolve(process.cwd(), 'db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  migrate(sql, SCHEMA_VERSION);
  schemaEnsured = true;
  schemaEnsuredUrl = url;
}

export function isInitialized(): boolean {
  const url = currentDbUrl();
  if (initCache && Date.now() < initCache.expiresAt && initCache.url === url) {
    return initCache.value;
  }
  ensureSchema();
  const row = get<{ c: number }>('SELECT COUNT(*) AS c FROM "user"', [], { ttlMs: INIT_TTL });
  const value = (row?.c ?? 0) > 0;
  initCache = { value, expiresAt: Date.now() + INIT_TTL, url };
  return value;
}

export function clearBootstrapCache(): void {
  schemaEnsured = false;
  schemaEnsuredUrl = null;
  initCache = null;
}

// Expose for db layer to clear on close
if (typeof globalThis !== 'undefined') {
  (globalThis as unknown as { __hokkClearBootstrapCache?: () => void }).__hokkClearBootstrapCache = clearBootstrapCache;
}

export function seedSystemDefaults(): void {
  ensureSchema();
  const stamp = nowIso();

  for (const role of DEFAULT_ROLES) {
    const existing = get<{ key: string }>('SELECT key FROM role WHERE key = ?', [role.key]);
    if (existing) continue;
    run(
      `INSERT INTO role (key, name, description, is_system, permissions, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      [role.key, role.name, role.description, JSON.stringify(role.permissions), role.sortOrder, stamp, stamp],
    );
  }

  const existingKeys = new Set(all<{ key: string }>('SELECT key FROM setting').map((r) => r.key));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existingKeys.has(key)) continue;
    run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', [key, value, stamp]);
  }
  // Databases created before the Drive/S3 trials were retired may still carry
  // their settings — drop them so uploads always stay on local disk.
  run(`DELETE FROM setting WHERE key LIKE 'drive.%' OR key LIKE 's3.%'`);
  run(`UPDATE setting SET value = 'LOCAL', updated_at = ? WHERE key = 'storage.backend' AND value != 'LOCAL'`, [stamp]);

  for (const template of IMAGE_TEMPLATES) {
    const existing = get<{ id: string }>('SELECT id FROM image_slot_template WHERE key = ?', [template.key]);
    const templateId = existing?.id ?? cuid();
    if (!existing) {
      run(
        `INSERT INTO image_slot_template (id, key, name, description, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [templateId, template.key, template.name, template.description, stamp, stamp],
      );
    }
    template.slots.forEach((slot, index) => {
      const slotExists = get<{ id: string }>('SELECT id FROM image_slot_definition WHERE template_id = ? AND key = ?', [templateId, slot.key]);
      if (slotExists) return;
      run(
        `INSERT INTO image_slot_definition (id, template_id, key, label, file_suffix, is_required, sort_order, guidance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cuid(), templateId, slot.key, slot.label, slot.suffix, slot.required ? 1 : 0, index, slot.guidance ?? null],
      );
    });
  }

  ATTRIBUTE_SEEDS.forEach((seed, index) => {
    const existing = get<{ id: string }>('SELECT id FROM attribute_field WHERE template_key = ? AND key = ?', [seed.templateKey, seed.key]);
    if (existing) return;
    run(
      `INSERT INTO attribute_field
         (id, template_key, group_key, group_label, key, label, field_type, options, unit,
          is_required, track_gap, sort_order, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
      [
        cuid(), seed.templateKey, seed.groupKey, seed.groupLabel, seed.key, seed.label,
        seed.fieldType ?? 'TEXT', JSON.stringify(seed.options ?? []), seed.unit ?? null,
        seed.required ? 1 : 0, index, stamp, stamp,
      ],
    );
  });

  seedShopifyMapping();
}

export function seedShopifyMapping(presetKey = CURRENT_SCHEMA.key): { inserted: number; updated: number } {
  const stamp = nowIso();
  const preset = findPreset(presetKey);
  let inserted = 0;
  let updated = 0;
  preset.columns.forEach((column, index) => {
    const existing = get<{ id: string; schema_key: string }>('SELECT id, schema_key FROM shopify_field_mapping WHERE schema_key = ?', [column.key]);
    if (!existing) {
      run(
        `INSERT INTO shopify_field_mapping
           (id, schema_key, column, level, section, enabled, required, sort_order, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cuid(), column.key, column.column, column.level, column.section, column.enabled ? 1 : 0, column.required ? 1 : 0, index, column.notes ?? null, stamp],
      );
      inserted += 1;
      return;
    }
    run(
      `UPDATE shopify_field_mapping
         SET column = ?, level = ?, section = ?, required = ?, sort_order = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [column.column, column.level, column.section, column.required ? 1 : 0, index, column.notes ?? null, stamp, existing.id],
    );
    updated += 1;
  });
  return { inserted, updated };
}

export interface CreateAdminInput {
  name: string;
  email: string;
  password: string;
}

export function createSuperAdmin(input: CreateAdminInput, opts: { allowWhenInitialized?: boolean } = {}): { id: string } {
  seedSystemDefaults();
  if (!opts.allowWhenInitialized && isInitialized()) {
    throw new Error('The system is already initialised.');
  }
  const stamp = nowIso();
  const id = cuid();
  const email = input.email.trim().toLowerCase();
  run(
    `INSERT INTO "user"
       (id, email, name, password_hash, role_key, job_title, is_active, must_change_password,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, 'SUPER_ADMIN', NULL, 1, 0, ?, ?)`,
    [id, email, input.name.trim(), hashPassword(input.password), stamp, stamp],
  );
  logAudit({ entityType: 'SYSTEM', entityId: 'bootstrap', entityLabel: email, action: 'BOOTSTRAP', userId: id, meta: { note: 'First super admin created' } });
  clearBootstrapCache();
  return { id };
}
