import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionForm, ConfirmSubmit } from '@/components/action-form';
import { archiveSizeGuideAction, saveSizeGuideAction } from '@/app/actions/taxonomy';
import { getSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

interface Guide {
  id: string;
  name: string;
  unit: string;
  applies_to: string | null;
  is_archived: number;
  product_count: number;
  columns: Array<{ id: string; label: string }>;
  rows: Array<{ id: string; size_label: string; cells: Record<string, string> }>;
}

export default async function SizeGuidesPage() {
  const user = await requirePermission('sizeguide.view');
  const canManage = userCan(user, 'sizeguide.manage');
  const defaultUnit = getSetting('units.length') || 'cm';

  const guideRows = all<{ id: string; name: string; unit: string; applies_to: string | null; is_archived: number; product_count: number }>(
    `SELECT sg.*, (SELECT COUNT(*) FROM product p WHERE p.size_guide_id = sg.id AND p.is_archived = 0) AS product_count
     FROM size_guide sg ORDER BY sg.name`,
  );

  const guides: Guide[] = guideRows.map((guide) => {
    const columns = all<{ id: string; label: string }>(
      'SELECT id, label FROM size_guide_column WHERE size_guide_id = ? ORDER BY sort_order',
      [guide.id],
    );
    const rows = all<{ id: string; size_label: string }>(
      'SELECT id, size_label FROM size_guide_row WHERE size_guide_id = ? ORDER BY sort_order',
      [guide.id],
    );
    const cells = all<{ row_id: string; column_id: string; value: string }>(
      'SELECT row_id, column_id, value FROM size_guide_cell WHERE row_id IN (SELECT id FROM size_guide_row WHERE size_guide_id = ?)',
      [guide.id],
    );
    return {
      ...guide,
      columns,
      rows: rows.map((row) => ({
        id: row.id,
        size_label: row.size_label,
        cells: Object.fromEntries(
          cells.filter((cell) => cell.row_id === row.id).map((cell) => [cell.column_id, cell.value]),
        ),
      })),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Size guides"
        subtitle={`Reusable measurement tables. Columns are configured per guide — nothing is hard-coded. Default unit: ${defaultUnit}. Sarees use product-specific measurements instead.`}
      />

      {guides.length === 0 ? (
        <EmptyState title="No size guides yet" body="Create a guide, define its measurement columns, then attach it to products." />
      ) : (
        <div className="flex flex-col gap-3">
          {guides.map((guide) => (
            <Card
              key={guide.id}
              title={guide.name}
              action={
                <span className="flex items-center gap-2">
                  <Badge tone="neutral">{guide.unit}</Badge>
                  {guide.applies_to && <span className="text-2xs text-ink-400">{guide.applies_to}</span>}
                  <span className="text-2xs text-ink-400">{guide.product_count} product(s)</span>
                  {guide.is_archived === 1 && <Badge tone="neutral">Archived</Badge>}
                </span>
              }
            >
              {guide.rows.length === 0 ? (
                <p className="px-4 py-3 text-xs text-ink-400">No measurement rows defined.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Size</th>
                        {guide.columns.map((column) => (
                          <th key={column.id}>
                            {column.label} ({guide.unit})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {guide.rows.map((row) => (
                        <tr key={row.id}>
                          <td className="font-medium">{row.size_label}</td>
                          {guide.columns.map((column) => (
                            <td key={column.id}>{row.cells[column.id] ?? '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={saveSizeGuideAction}>
            <Card title="New size guide">
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Womens Kurta" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    Unit
                    <input className="field" name="unit" defaultValue={defaultUnit} />
                  </label>
                  <label>
                    Applies to
                    <input className="field" name="applies_to" placeholder="Kurtas, tops" />
                  </label>
                </div>
                <label>
                  Measurement columns (one per line)
                  <textarea className="field mono" name="columns" rows={4} placeholder={'Bust\nWaist\nHip\nLength'} />
                </label>
                <label>
                  Rows — size label then values separated by <span className="mono">|</span>
                  <textarea className="field mono" name="rows" rows={4} placeholder={'S | 36 | 28 | 38 | 40\nM | 38 | 30 | 40 | 41'} />
                </label>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-sm btn-primary" type="submit">
                  Create size guide
                </button>
              </div>
            </Card>
          </ActionForm>

          <div className="flex flex-col gap-4">
            {guides.map((guide) => (
              <ActionForm key={guide.id} action={saveSizeGuideAction}>
                <Card title={`Edit · ${guide.name}`}>
                  <input type="hidden" name="id" value={guide.id} />
                  <div className="flex flex-col gap-3 px-4 py-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label>
                        Name
                        <input className="field" name="name" defaultValue={guide.name} required />
                      </label>
                      <label>
                        Unit
                        <input className="field" name="unit" defaultValue={guide.unit} />
                      </label>
                      <label>
                        Applies to
                        <input className="field" name="applies_to" defaultValue={guide.applies_to ?? ''} />
                      </label>
                    </div>
                    <label>
                      Measurement columns
                      <textarea className="field mono" name="columns" rows={4} defaultValue={guide.columns.map((c) => c.label).join('\n')} />
                    </label>
                    <label>
                      Rows
                      <textarea
                        className="field mono"
                        name="rows"
                        rows={5}
                        defaultValue={guide.rows
                          .map((row) => [row.size_label, ...guide.columns.map((column) => row.cells[column.id] ?? '')].join(' | '))
                          .join('\n')}
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5">
                    <button className="btn btn-sm btn-primary" type="submit">
                      Save guide
                    </button>
                    <ActionForm action={archiveSizeGuideAction}>
                      <input type="hidden" name="id" value={guide.id} />
                      <ConfirmSubmit label={guide.is_archived ? 'Restore' : 'Archive'} confirm="Archive this size guide?" />
                    </ActionForm>
                  </div>
                </Card>
              </ActionForm>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
