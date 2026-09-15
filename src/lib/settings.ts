/**
 * Global settings. Stored in the `setting` key/value table so administrators
 * can change them from the UI (spec §42 — configurable units, currency,
 * SKU structure, image rules, Shopify defaults).
 */
import { all, get, run, parseJson } from '@/lib/db';
import { nowIso } from '@/lib/id';

export const DEFAULT_SETTINGS: Record<string, string> = {
  // Brand
  'brand.name': 'House of Kala Katha',
  'brand.tagline': 'Stories of India, Woven for You.',

  // SKU generation (spec §3)
  'sku.pattern': 'HOKK-{TYPE}-{CULTURE}-{SEQ}',
  'sku.sequence.padding': '3',
  // GLOBAL | CULTURE | CATEGORY  — what the sequence counter is scoped to
  'sku.sequence.scope': 'CULTURE',
  'sku.variant.pattern': '{SKU}-{OPTION}',

  // Units & currency (spec §42)
  'units.currency': 'INR',
  'units.length': 'cm',
  'units.weight': 'g',

  // Image rules (spec §21)
  'images.max.bytes': '15728640', // 15 MB
  'images.min.bytes': '20480', // 20 KB
  'images.min.width': '1200',
  'images.min.height': '1200',
  'images.allowed.types': 'image/jpeg,image/png,image/webp',
  'images.recommend.bytes': '2097152',

  // Storage
  'storage.backend': 'LOCAL', // LOCAL | GDRIVE
  'storage.public_base_url': '',
  'drive.original_folder_id': '',
  'drive.final_folder_id': '',
  'drive.parent_folder_id': '',
  'drive.public_url_template': 'https://lh3.googleusercontent.com/d/{fileId}',

  // Shopify defaults (spec §32)
  'shopify.vendor': 'House of Kala Katha',
  'shopify.default_status': 'draft',
  'shopify.published': 'FALSE',
  'shopify.schema_version': '2025-01',
  'shopify.schema_key': 'shopify-product-csv',
  'shopify.taxonomy.default': '',
  'shopify.include.google_columns': 'false',
  'shopify.collection_column': 'true',

  // Workflow policy
  'workflow.allow_export_warnings': 'false',
};

export type Settings = Record<string, string>;

// Cache settings for 60 seconds — they rarely change and are read on every request
let settingsCache: { data: Settings; expiresAt: number } | null = null;
const SETTINGS_TTL = 60_000;

function loadAllSettings(): Settings {
  if (settingsCache && Date.now() < settingsCache.expiresAt) {
    return settingsCache.data;
  }
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM setting', [], { ttlMs: SETTINGS_TTL });
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  settingsCache = { data: out, expiresAt: Date.now() + SETTINGS_TTL };
  return out;
}

export function getSetting(key: string): string {
  const allSettings = loadAllSettings();
  if (key in allSettings) return allSettings[key] ?? DEFAULT_SETTINGS[key] ?? '';
  // Fallback to direct query if not in cache (e.g., during bootstrap)
  const row = get<{ value: string }>('SELECT value FROM setting WHERE key = ?', [key], { ttlMs: 30_000 });
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] ?? '';
}

export function getSettings(keys?: string[]): Settings {
  const out = loadAllSettings();
  if (keys) {
    const picked: Settings = {};
    for (const key of keys) picked[key] = out[key] ?? '';
    return picked;
  }
  return out;
}

export function setSetting(key: string, value: string): void {
  const stamp = nowIso();
  run(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, stamp],
  );
  // Invalidate cache on write
  settingsCache = null;
}

export function setSettings(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) setSetting(key, value);
  settingsCache = null;
}

export function clearSettingsCache(): void {
  settingsCache = null;
}

export function getNumber(key: string, fallback = 0): number {
  const value = Number(getSetting(key));
  return Number.isFinite(value) ? value : fallback;
}

export function getBoolean(key: string, fallback = false): boolean {
  const value = getSetting(key).toLowerCase();
  if (!value) return fallback;
  return value === 'true' || value === '1' || value === 'yes';
}

export function getList(key: string): string[] {
  return getSetting(key)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getJson<T>(key: string, fallback: T): T {
  return parseJson<T>(getSetting(key), fallback);
}

/** Seeds defaults for any key not already present. Idempotent. */
export function ensureDefaultSettings(): void {
  const existing = new Set(all<{ key: string }>('SELECT key FROM setting').map((r) => r.key));
  const stamp = nowIso();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing.has(key)) continue;
    run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', [key, value, stamp]);
  }
}
