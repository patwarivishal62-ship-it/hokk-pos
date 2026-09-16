import { requirePermission, userCan } from '@/lib/auth';
import { all, get, parseJson } from '@/lib/db';
import { getBoolean, getSetting } from '@/lib/settings';
import { SCHEMA_PRESETS, findPreset } from '@/lib/shopify/schema';
import { buildLocalConfig } from '@/lib/storage';
import { diskStatus, hostingPublicBaseUrl, isRender, renderExternalUrl } from '@/lib/hosting';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { applyShopifyPresetAction, saveSettingsAction, updateMappingAction } from '@/app/actions/settings';

export const dynamic = 'force-dynamic';

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

export default async function SettingsPage() {
  const user = await requirePermission('settings.view');
  const canManage = userCan(user, 'settings.manage');
  const canConfigureExport = userCan(user, 'export.configure');

  const settings = all<SettingRow>('SELECT key, value, updated_at FROM setting ORDER BY key');
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  // What the app will actually use — includes the Render fallbacks, so the
  // operator sees the effective base URL rather than a blank field.
  const effectiveBase = getSetting('storage.public_base_url') || hostingPublicBaseUrl();
  const disk = diskStatus();
  const onRender = isRender();
  const schemaKey = getSetting('shopify.schema_key') || 'shopify-product-csv';
  const preset = findPreset(schemaKey);
  const mappings = all<{ id: string; column: string; level: string; enabled: number; sort_order: number }>(
    'SELECT id, column, level, enabled, sort_order FROM shopify_field_mapping ORDER BY sort_order',
  );
  const roleCount = get<{ n: number }>('SELECT COUNT(*) AS n FROM role')?.n ?? 0;
  const userCount = get<{ n: number }>('SELECT COUNT(*) AS n FROM "user"')?.n ?? 0;

  const group = (prefix: string) => settings.filter((setting) => setting.key.startsWith(prefix));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        subtitle="SKU pattern, units, image rules, storage and the Shopify field mapping. Every value here is read by the engine at runtime."
      />

      <ActionForm action={saveSettingsAction}>
        <div className="flex flex-col gap-4">
          <Card title="Brand & SKU">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
              {['brand.name', 'brand.tagline'].map((key) => (
                <SettingField key={key} setting={byKey.get(key)} disabled={!canManage} />
              ))}
              <SettingField setting={byKey.get('sku.pattern')} disabled={!canManage} />
              <SettingField setting={byKey.get('sku.variant.pattern')} disabled={!canManage} />
              <SettingField setting={byKey.get('sku.sequence.padding')} disabled={!canManage} />
              <SettingField setting={byKey.get('sku.sequence.scope')} disabled={!canManage} />
            </div>
            <p className="border-t border-ink-100 px-4 py-2 text-2xs text-ink-400">
              Pattern tokens: <span className="mono">{'{TYPE}'}</span> product type segment, <span className="mono">{'{CULTURE}'}</span>{' '}
              handloom culture code, <span className="mono">{'{SEQ}'}</span> zero-padded sequence. Example:{' '}
              <span className="mono">{getSetting('sku.pattern')}</span> → <span className="mono">HOKK-SAR-ZK-001</span>. SKUs are
              immutable for normal users; only an admin with <span className="mono">product.sku.edit</span> can change one.
            </p>
          </Card>

          <Card title="Units & pricing">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
              {['units.currency', 'units.length', 'units.weight'].map((key) => (
                <SettingField key={key} setting={byKey.get(key)} disabled={!canManage} />
              ))}
            </div>
            <p className="border-t border-ink-100 px-4 py-2 text-2xs text-ink-400">
              Weights are converted to grams on Shopify export regardless of the display unit.
            </p>
          </Card>

          <Card title="Image rules">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
              {['images.allowed.types', 'images.min.bytes', 'images.max.bytes', 'images.recommend.bytes', 'images.min.width', 'images.min.height'].map(
                (key) => <SettingField key={key} setting={byKey.get(key)} disabled={!canManage} />,
              )}
            </div>
            <p className="border-t border-ink-100 px-4 py-2 text-2xs text-ink-400">
              Uploads outside these limits are rejected with the reason shown to the uploader.
            </p>
          </Card>

          <Card
            title="Storage"
            action={
              <span className="flex items-center gap-2">
                {onRender && (
                  <Badge tone={disk.persistent ? 'success' : 'danger'}>
                    {disk.persistent ? `Render disk ${disk.mountPath}` : 'Render disk missing'}
                  </Badge>
                )}
                <Badge tone="neutral">Local disk</Badge>
              </span>
            }
          >
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SettingField setting={byKey.get('storage.public_base_url')} disabled={!canManage} />
              </div>
              <div className="rounded border border-ink-200 bg-ink-50/50 px-3 py-2 text-xs text-ink-600">
                <p>
                  Uploads are filed into two folders: <strong>Original</strong> for raw photographs and <strong>Final</strong>{' '}
                  for approved, export-ready assets. Approving an image copies it from Original to Final.
                </p>
                <p className="mt-1">
                  Files are stored at <span className="mono">{buildLocalConfig().uploadDir}</span> and served publicly at{' '}
                  <span className="mono">/api/media/&lt;key&gt;</span> — Shopify fetches{' '}
                  <span className="mono">Product image URL</span> with no credentials, so the public base URL must be this
                  server (for example <span className="mono">{effectiveBase || 'https://your-domain'}</span>).
                </p>
                <p className="mt-1">
                  On <strong>Render</strong> everything below happens automatically: uploads and the database live on the
                  persistent disk at <span className="mono">{buildLocalConfig().uploadDir}</span> /{' '}
                  <span className="mono">{disk.mountPath}</span>, and the public base URL defaults to{' '}
                  <span className="mono">{renderExternalUrl() || 'RENDER_EXTERNAL_URL'}</span>. See{' '}
                  <span className="mono">RENDER.md</span>.
                </p>
              </div>
            </div>
          </Card>

          <Card title="Workflow & Shopify defaults">
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
              {['shopify.vendor', 'shopify.default_status'].map((key) => (
                <SettingField key={key} setting={byKey.get(key)} disabled={!canManage} />
              ))}
              {['shopify.published', 'shopify.collection_column', 'shopify.include.google_columns', 'workflow.allow_export_warnings'].map(
                (key) => (
                  <label key={key} className="flex items-start gap-2 text-xs normal-case">
                    <input type="checkbox" name={`setting:${key}`} value="1" defaultChecked={getBoolean(key, false)} disabled={!canManage} />
                    <span className="flex flex-col">
                      <span>{labelFor(key)}</span>
                      <span className="mono text-2xs text-ink-400">{key}</span>
                    </span>
                  </label>
                ),
              )}
            </div>
          </Card>

          {canManage && (
            <div className="flex justify-end">
              <button className="btn btn-primary" type="submit">
                Save settings
              </button>
            </div>
          )}
        </div>
      </ActionForm>

      <Card
        title="Shopify CSV schema"
        action={
          <span className="flex items-center gap-2">
            <Badge tone="info">{preset?.version ?? 'unknown'}</Badge>
            <span className="mono text-2xs text-ink-400">{schemaKey}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-xs text-ink-600">
            The export is generated from these column mappings, not from a hard-coded header list. When Shopify changes its
            template, apply the matching preset or edit the mapping — no deploy required.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SCHEMA_PRESETS.map((option) => (
              <div key={option.key} className={`rounded border px-3 py-2 ${option.key === schemaKey ? 'border-brand bg-brand-50' : 'border-ink-200'}`}>
                <p className="text-sm font-medium">{option.name}</p>
                <p className="text-2xs text-ink-500">{option.description}</p>
                <p className="mono text-2xs text-ink-400">
                  {option.version} · {option.columns.filter((column) => column.enabled).length} columns
                </p>
                {canConfigureExport && option.key !== schemaKey && (
                  <ActionForm action={applyShopifyPresetAction} className="mt-1">
                    <input type="hidden" name="preset" value={option.key} />
                    <button className="btn btn-sm" type="submit">
                      Apply this preset
                    </button>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {mappings.length > 0 && canConfigureExport && (
        <ActionForm action={updateMappingAction}>
          <Card title="Column mapping" action={<span className="text-2xs text-ink-400">{mappings.length} columns</span>}>
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
              {mappings.map((mapping) => (
                <label key={mapping.id} className="flex items-center gap-2 text-xs normal-case">
                  <input type="checkbox" name={`map:${mapping.id}`} value="1" defaultChecked={mapping.enabled === 1} />
                  <span className="flex flex-col">
                    <span className="mono">{mapping.column}</span>
                    <span className="text-2xs text-ink-400">{mapping.level}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="border-t border-ink-200 px-4 py-2.5">
              <button className="btn btn-sm btn-primary" type="submit">
                Save column mapping
              </button>
            </div>
          </Card>
        </ActionForm>
      )}

      <Card title="Access">
        <div className="flex flex-wrap gap-6 px-4 py-3 text-xs text-ink-600">
          <span>
            <strong>{roleCount}</strong> roles · <strong>{userCount}</strong> users
          </span>
          <span>Permissions are stored on each role row and checked on every action.</span>
          <a className="btn btn-sm" href="/roles">
            Manage roles
          </a>
          <a className="btn btn-sm" href="/users">
            Manage users
          </a>
        </div>
      </Card>
    </div>
  );
}

function SettingField({ setting, disabled }: { setting?: SettingRow; disabled: boolean }) {
  if (!setting) return null;
  return (
    <label className="text-xs">
      <span className="text-ink-600">{labelFor(setting.key)}</span>
      <input
        className="field field-sm mono"
        name={`setting:${setting.key}`}
        defaultValue={setting.value ?? ''}
        disabled={disabled}
      />
      {HINTS[setting.key] && <span className="text-2xs text-ink-400">{HINTS[setting.key]}</span>}
    </label>
  );
}

const LABELS: Record<string, string> = {
  'brand.name': 'Brand name',
  'brand.tagline': 'Tagline',
  'sku.pattern': 'SKU pattern',
  'sku.variant.pattern': 'Variant SKU pattern',
  'sku.sequence.padding': 'SKU sequence padding',
  'sku.sequence.scope': 'SKU sequence scope',
  'units.currency': 'Currency',
  'units.length': 'Length unit',
  'units.weight': 'Weight unit',
  'images.allowed.types': 'Allowed image types',
  'images.min.bytes': 'Minimum file size (bytes)',
  'images.max.bytes': 'Maximum file size (bytes)',
  'images.recommend.bytes': 'Recommended size (bytes)',
  'images.min.width': 'Minimum width (px)',
  'images.min.height': 'Minimum height (px)',
  'storage.backend': 'Storage backend',
  'storage.public_base_url': 'Public base URL',
  'shopify.vendor': 'Shopify vendor',
  'shopify.default_status': 'Shopify default status',
  'shopify.published': 'Publish to the online store on export',
  'shopify.collection_column': 'Include the Collection column',
  'shopify.include.google_columns': 'Include Google Shopping columns',
  'workflow.allow_export_warnings': 'Allow exporting products with warnings',
};

function labelFor(key: string): string {
  return LABELS[key] ?? key;
}

const HINTS: Record<string, string> = {
  'sku.pattern': 'Tokens: {TYPE} {CULTURE} {SEQ}',
  'sku.sequence.padding': 'Digits in the sequence, e.g. 3 → 001',
  'sku.sequence.scope': 'GLOBAL, CATEGORY or CULTURE',
  'images.allowed.types': 'Comma-separated MIME types',
  'images.min.bytes': 'Rejects files below this size',
  'images.max.bytes': 'Rejects files above this size',
  'images.min.width': 'Pixels — warns when smaller',
  'storage.public_base_url': 'Must be reachable by Shopify',
  'shopify.default_status': 'draft, active or archived',
};
