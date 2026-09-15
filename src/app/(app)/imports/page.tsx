import { requirePermission } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { stageImportAction } from '@/app/actions/imports';
import { getStagedPreview } from '@/lib/import-staging';
import { IMPORT_TARGETS } from '@/lib/importer';
import { ImportPreview } from './import-preview';
import type { Issue } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const user = await requirePermission('import.view');
  const params = await searchParams;

  const history = all<{
    id: string;
    file_name: string;
    status: string;
    row_count: number;
    imported_count: number;
    skipped_count: number;
    failed_count: number;
    duplicate_count: number;
    created_at: string;
    user_name: string | null;
  }>(
    `SELECT i.*, u.name AS user_name FROM import_run i LEFT JOIN "user" u ON u.id = i.user_id ORDER BY i.created_at DESC LIMIT 20`,
  );

  const preview = params.preview ? getStagedPreview(params.preview) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Import"
        subtitle="Upload → detect columns → map → preview → validate → flag duplicates → import. Nothing is written before you confirm."
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card title="Upload a CSV">
            <ActionForm action={stageImportAction} className="flex flex-col gap-3 px-4 py-3">
              <label>
                File <span className="text-red-600">*</span>
                <input className="field" type="file" name="file" accept=".csv,text/csv" required />
                <span className="text-2xs text-ink-400">UTF-8 CSV, maximum 15 MB. Headers must be on the first row.</span>
              </label>
              <label>
                Mode
                <select className="field" name="mode" defaultValue="NEW">
                  <option value="NEW">New products — flag anything that already exists</option>
                  <option value="UPDATE">Update products — match on SKU or handle</option>
                  <option value="FULL">Full catalog — create what is missing, update what matches</option>
                </select>
              </label>
              <button className="btn btn-primary btn-sm" type="submit">
                Analyse file
              </button>
              <p className="text-2xs text-ink-400">
                A Shopify product CSV can be re-imported: Title, URL handle, Price and Option1 are recognised
                automatically.
              </p>
            </ActionForm>
          </Card>

          <Card title="Import history">
            {history.length === 0 ? (
              <EmptyState title="No imports yet" />
            ) : (
              <ul className="flex flex-col divide-y divide-ink-100">
                {history.map((row) => (
                  <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={row.status === 'COMPLETED' ? 'success' : 'neutral'}>{row.status.toLowerCase()}</Badge>
                      <span className="mono text-2xs text-ink-500">{row.file_name}</span>
                    </div>
                    <p className="text-2xs text-ink-500">
                      {row.row_count} rows · {row.imported_count} imported · {row.skipped_count} skipped ·{' '}
                      {row.duplicate_count} duplicates
                    </p>
                    <p className="text-2xs text-ink-400">
                      {row.user_name ?? '—'} · {formatDateTime(row.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {preview ? (
            <>
              <Card title="Column mapping" action={<span className="text-2xs text-ink-400">{preview.columns.length} columns detected</span>}>
                <form className="grid gap-2 px-4 py-3 sm:grid-cols-2">
                  {IMPORT_TARGETS.map((target) => (
                    <label key={target.key} className="text-xs">
                      <span className="text-ink-600">{target.label}</span>
                      <select className="field field-sm" name={`map:${target.key}`} defaultValue={preview.mapping[target.key] ?? ''}>
                        <option value="">— not mapped —</option>
                        {preview.columns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </form>
              </Card>

              <ImportPreview previewId={params.preview!} mode={preview.mode} summary={preview.summary} />

              <Card title={`Preview (${preview.rows.length} rows)`}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Name</th>
                        <th>SKU</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>Duplicate</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 60).map((row) => (
                        <tr key={row.rowNumber} className={row.issues.some((i) => i.severity === 'ERROR') ? 'bg-red-50/60' : ''}>
                          <td className="mono text-2xs">{row.rowNumber}</td>
                          <td className="text-xs">{String(row.mapped.name ?? '—')}</td>
                          <td className="mono text-xs">{String(row.mapped.sku ?? '—')}</td>
                          <td className="text-xs">{String(row.mapped.category ?? '—')}</td>
                          <td className="text-xs">{String(row.mapped.price ?? '—')}</td>
                          <td className="text-xs">
                            {row.duplicate ? <Badge tone="warn">{row.duplicate.type.toLowerCase()}</Badge> : '—'}
                          </td>
                          <td className="text-xs">
                            {row.issues.length === 0 ? (
                              <span className="text-emerald-700">ok</span>
                            ) : (
                              <ul className="flex flex-col">
                                {row.issues.slice(0, 3).map((issue: Issue, index: number) => (
                                  <li key={index} className={issue.severity === 'ERROR' ? 'text-red-700' : 'text-amber-800'}>
                                    {issue.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 60 && (
                  <p className="px-4 py-2 text-2xs text-ink-400">Showing the first 60 of {preview.rows.length} rows.</p>
                )}
              </Card>

              {preview.rows.some((row) => row.duplicate) && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>{preview.summary.duplicates} potential duplicate(s) detected</strong> on SKU, handle, name or a
                  similar name. Duplicates are skipped unless you tick the override when importing.
                </div>
              )}
            </>
          ) : (
            <EmptyState title="No file analysed yet" body="Upload a CSV on the left to detect its columns and preview the import." />
          )}
        </div>
      </div>
    </div>
  );
}
