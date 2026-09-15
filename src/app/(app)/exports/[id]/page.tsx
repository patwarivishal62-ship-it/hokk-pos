import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { getExport, markExportStatus, readExportFile } from '@/lib/export';
import { parseJson } from '@/lib/db';
import { Badge, Card, PageHeader, formatDateTime } from '@/components/ui';
import type { Issue } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ExportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('export.view');
  const { id } = await params;
  const exportRecord = getExport(id);
  if (!exportRecord) notFound();
  const { run, items } = exportRecord;

  const summary = parseJson<{
    csvWarnings?: string[];
    includeWarnings?: boolean;
    blockedSkus?: string[];
  }>(String(run.summary ?? '{}'), {});

  const hasFile = Boolean(run.file_path) && readExportFile(String(run.file_path)) !== null;
  if (hasFile && run.status === 'GENERATED') markExportStatus(id, 'DOWNLOADED');

  const grouped = {
    READY: items.filter((item) => item.state === 'READY'),
    WARNINGS: items.filter((item) => item.state === 'WARNINGS'),
    BLOCKED: items.filter((item) => item.state === 'BLOCKED'),
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Shopify export #${String(run.number).padStart(4, '0')}`}
        subtitle={`${run.product_count} products · ${run.mode} · schema ${run.schema_version} · ${formatDateTime(String(run.created_at))}`}
        actions={
          hasFile ? (
            <>
              <a className="btn btn-primary" href={`/api/exports/${id}?format=csv`}>
                Download CSV
              </a>
              <a className="btn" href={`/api/exports/${id}?format=xlsx`}>
                Excel workbook
              </a>
            </>
          ) : (
            <span className="text-xs text-ink-400">File no longer available on disk.</span>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Selected" value={Number(run.product_count) + grouped.BLOCKED.length} />
        <Stat label="Included" value={Number(run.product_count)} tone="text-emerald-700" />
        <Stat label="Ready" value={Number(run.ready_count)} tone="text-emerald-700" />
        <Stat label="Warnings" value={Number(run.warning_count)} tone="text-amber-700" />
        <Stat label="Blocked" value={Number(run.blocked_count)} tone="text-red-700" />
      </div>

      {summary.csvWarnings && summary.csvWarnings.length > 0 && (
        <Card title="Export warnings">
          <ul className="flex flex-col divide-y divide-ink-100">
            {summary.csvWarnings.map((warning, index) => (
              <li key={index} className="px-4 py-1.5 text-xs text-amber-800">
                {warning}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.includeWarnings && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Warning-level products were included by administrator override.
        </div>
      )}

      <Card title={`Blocked products (${grouped.BLOCKED.length})`}>
        {grouped.BLOCKED.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-500">Nothing was blocked.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {grouped.BLOCKED.map((item) => {
              const issues = parseJson<Issue[]>(item.issues, []);
              return (
                <li key={item.sku} className="flex flex-col gap-1 px-4 py-2">
                  <span className="mono text-xs">{item.sku}</span>
                  <ul className="flex flex-col">
                    {issues
                      .filter((issue) => issue.severity === 'ERROR')
                      .map((issue, index) => (
                        <li key={index} className="text-xs text-red-700">
                          {issue.message}
                        </li>
                      ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Included products">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>State</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {[...grouped.READY, ...grouped.WARNINGS].map((item) => {
                const issues = parseJson<Issue[]>(item.issues, []);
                return (
                  <tr key={item.sku}>
                    <td className="mono">{item.sku}</td>
                    <td>
                      <Badge tone={item.state === 'READY' ? 'success' : 'warn'}>{item.state.toLowerCase()}</Badge>
                    </td>
                    <td className="text-xs text-ink-600">{issues.map((issue) => issue.message).join(' · ') || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Import into Shopify">
        <div className="flex flex-col gap-2 px-4 py-3 text-xs text-ink-600">
          <p>
            <strong>Create vs update.</strong> Shopify matches rows by <span className="mono">URL handle</span>. This run was
            generated in <strong>{String(run.mode)}</strong> mode:
          </p>
          <ul className="list-disc pl-5">
            <li>NEW — products that have never been exported. Importing creates them.</li>
            <li>UPDATE — products already exported or published. Importing overwrites the mapped columns.</li>
            <li>FULL — everything that passed validation.</li>
          </ul>
          <p>
            Import as <strong>draft</strong> first (the Status column defaults to draft) and review in Shopify before
            publishing. Images must be reachable at the URLs in the CSV.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
