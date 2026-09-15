import Link from 'next/link';
import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { assessSelection, listExports } from '@/lib/export';
import { getSetting, getBoolean } from '@/lib/settings';
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { runExportAction } from '@/app/actions/exports';
import type { ExportMode } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ExportsPage({ searchParams }: { searchParams: Promise<{ product?: string; mode?: string; warnings?: string }> }) {
  const user = await requirePermission('export.view');
  const params = await searchParams;
  const mode = ((params.mode ?? 'FULL').toUpperCase() as ExportMode) || 'FULL';
  const includeWarnings = params.warnings === '1';

  const { assessments, summary } = assessSelection({
    mode,
    productIds: params.product ? [params.product] : undefined,
    includeImages: true,
    includeCollectionColumn: getBoolean('shopify.collection_column', true),
    includeWarnings,
  });

  const blocked = assessments.filter((a) => a.state === 'BLOCKED');
  const warned = assessments.filter((a) => a.state === 'WARNINGS');
  const history = listExports(20);
  const publicBase = getSetting('storage.public_base_url') || process.env.PUBLIC_BASE_URL || '';
  const backend = getSetting('storage.backend') || 'LOCAL';
  const canRun = userCan(user, 'export.run');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Shopify export"
        subtitle="Nothing is exported unless it passes validation. Errors block, warnings need an explicit override."
      />

      {!publicBase && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>No public image URL is configured.</strong> Images cannot be imported into Shopify until publicly
          accessible URLs are available.{' '}
          {backend === 'LOCAL'
            ? 'Set “Public base URL” in Settings → Storage, or switch the backend to Google Drive.'
            : 'Check the Google Drive folder links in Settings → Storage.'}{' '}
          The CSV will still be generated, with blank image URLs for affected assets.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Export options">
            <div className="flex flex-col gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <label>Mode</label>
                <div className="flex gap-1">
                  {(['NEW', 'UPDATE', 'FULL'] as ExportMode[]).map((option) => (
                    <Link
                      key={option}
                      href={`/exports?mode=${option}${params.product ? `&product=${params.product}` : ''}${includeWarnings ? '&warnings=1' : ''}`}
                      className={`btn btn-sm flex-1 ${mode === option ? 'btn-primary' : ''}`}
                    >
                      {option}
                    </Link>
                  ))}
                </div>
                <p className="text-2xs text-ink-400">
                  NEW creates products in Shopify. UPDATE overwrites products that already exist (matched by handle).
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm normal-case">
                <input type="checkbox" defaultChecked={getBoolean('shopify.collection_column', true)} disabled />
                <span className="flex flex-col">
                  Collection column
                  <span className="text-2xs text-ink-400">Adds the non-breaking “Collection” column (one collection per product).</span>
                </span>
              </label>

              <div className="border-t border-ink-200 pt-3 text-xs">
                <p className="text-2xs uppercase tracking-wider text-ink-500">Schema</p>
                <p>{getSetting('shopify.schema_key')}</p>
                <p className="text-ink-400">version {getSetting('shopify.schema_version')}</p>
                <p className="mt-1 text-2xs text-ink-400">Column mapping is configurable under Settings → Shopify.</p>
              </div>
            </div>
          </Card>

          {canRun && (
            <Card title="Run export">
              <ActionForm action={runExportAction} className="flex flex-col gap-2 px-4 py-3">
                <input type="hidden" name="mode" value={mode} />
                <input type="hidden" name="include_images" value="1" />
                <input type="hidden" name="include_collections" value={getBoolean('shopify.collection_column', true) ? '1' : '0'} />
                {params.product && <input type="hidden" name="ids" value={params.product} />}
                <div className="flex items-center justify-between">
                  <span className="text-sm">Ready</span>
                  <span className="text-lg font-semibold text-emerald-700">{summary.ready}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Warnings</span>
                  <span className="text-lg font-semibold text-amber-700">{summary.warnings}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Blocked</span>
                  <span className="text-lg font-semibold text-red-700">{summary.blocked}</span>
                </div>
                <button className="btn btn-primary" type="submit" disabled={summary.included === 0}>
                  Export {summary.included} ready product{summary.included === 1 ? '' : 's'}
                </button>
                {warned.length > 0 && (
                  <>
                    <label className="flex items-center gap-2 text-xs normal-case">
                      <input type="checkbox" name="include_warnings" value="1" defaultChecked={includeWarnings} />
                      Include {warned.length} product(s) with warnings (admin override)
                    </label>
                    <p className="text-2xs text-ink-400">Errors can never be overridden.</p>
                  </>
                )}
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card title="Export summary">
            <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-5">
              <SummaryStat label="Selected" value={summary.total} />
              <SummaryStat label="Ready" value={summary.ready} tone="text-emerald-700" />
              <SummaryStat label="Warnings" value={summary.warnings} tone="text-amber-700" />
              <SummaryStat label="Blocked" value={summary.blocked} tone="text-red-700" />
              <SummaryStat label="Will export" value={summary.included} />
            </div>
          </Card>

          <Card title={`Blocked products (${blocked.length})`}>
            {blocked.length === 0 ? (
              <EmptyState title="Nothing blocked" body="Every selected product passed the error checks." />
            ) : (
              <ul className="flex flex-col divide-y divide-ink-100">
                {blocked.slice(0, 40).map((assessment) => (
                  <li key={assessment.product.id} className="flex flex-col gap-1 px-4 py-2">
                    <Link href={`/products/${assessment.product.id}`} className="mono text-xs text-brand hover:underline">
                      {assessment.product.sku}
                    </Link>
                    <ul className="flex flex-col">
                      {assessment.issues
                        .filter((issue) => issue.severity === 'ERROR')
                        .slice(0, 4)
                        .map((issue, index) => (
                          <li key={index} className="text-xs text-red-700">
                            {issue.message}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Products with warnings (${warned.length})`}>
            {warned.length === 0 ? (
              <EmptyState title="No warnings" />
            ) : (
              <ul className="flex flex-col divide-y divide-ink-100">
                {warned.slice(0, 40).map((assessment) => (
                  <li key={assessment.product.id} className="flex flex-col gap-1 px-4 py-2">
                    <Link href={`/products/${assessment.product.id}`} className="mono text-xs text-brand hover:underline">
                      {assessment.product.sku}
                    </Link>
                    <ul className="flex flex-col">
                      {assessment.issues
                        .filter((issue) => issue.severity === 'WARNING')
                        .slice(0, 3)
                        .map((issue, index) => (
                          <li key={index} className="text-xs text-amber-800">
                            {issue.message}
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="Export history">
        {history.length === 0 ? (
          <EmptyState title="No exports yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Export</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th>Ready</th>
                  <th>Warnings</th>
                  <th>Blocked</th>
                  <th>Schema</th>
                  <th>By</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/exports/${row.id}`} className="mono text-brand hover:underline">
                        #{String(row.number).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="text-xs">{row.mode}</td>
                    <td>
                      <Badge tone={row.status === 'IMPORTED' ? 'success' : 'neutral'}>{row.status.toLowerCase()}</Badge>
                    </td>
                    <td>{row.product_count}</td>
                    <td className="text-emerald-700">{row.ready_count}</td>
                    <td className="text-amber-700">{row.warning_count}</td>
                    <td className={row.blocked_count > 0 ? 'text-red-700' : ''}>{row.blocked_count}</td>
                    <td className="mono text-2xs">{row.schema_version}</td>
                    <td className="text-xs">{row.user_name ?? '—'}</td>
                    <td className="whitespace-nowrap text-2xs text-ink-500">{formatDateTime(row.created_at)}</td>
                    <td>
                      <a className="btn btn-sm" href={`/api/exports/${row.id}?format=csv`}>
                        CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
