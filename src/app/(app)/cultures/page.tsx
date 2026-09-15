import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { saveCultureAction } from '@/app/actions/taxonomy';

export const dynamic = 'force-dynamic';

interface CultureRow {
  id: string;
  name: string;
  slug: string;
  code: string;
  region: string | null;
  state: string | null;
  country: string | null;
  technique: string | null;
  typical_materials: string | null;
  typical_motifs: string | null;
  significance: string | null;
  history: string | null;
  description: string | null;
  is_archived: number;
  product_count: number;
}

const TEXT_FIELDS: Array<[keyof CultureRow, string]> = [
  ['region', 'Region'],
  ['state', 'State'],
  ['country', 'Country'],
  ['technique', 'Weave technique'],
  ['typical_materials', 'Typical materials / yarn'],
  ['typical_motifs', 'Typical motifs'],
];

export default async function CulturesPage() {
  const user = await requirePermission('taxonomy.culture.view');
  const canManage = userCan(user, 'taxonomy.culture.manage');

  const cultures = all<CultureRow>(
    `SELECT hc.*, (SELECT COUNT(*) FROM product p WHERE p.handloom_culture_id = hc.id AND p.is_archived = 0) AS product_count
     FROM handloom_culture hc ORDER BY hc.sort_order, hc.name`,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Handloom cultures"
        subtitle="Culture is a first-class dimension: it sets the SKU code, drives the weave attributes and must never be guessed. Leave a field blank rather than inventing detail."
      />

      <Card title={`Cultures (${cultures.length})`}>
        {cultures.length === 0 ? (
          <EmptyState title="No handloom cultures yet" body="Add the weaves you work with — Zari Kota, Baluchari, Banarasi, Ikkat…" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Code</th>
                  <th>Region / state</th>
                  <th>Technique</th>
                  <th>Materials</th>
                  <th>Products</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cultures.map((culture) => (
                  <tr key={culture.id} className={culture.is_archived ? 'opacity-50' : ''}>
                    <td className="font-medium">{culture.name}</td>
                    <td className="mono">{culture.code}</td>
                    <td className="text-xs">{[culture.region, culture.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="text-xs">{culture.technique ?? '—'}</td>
                    <td className="text-xs">{culture.typical_materials ?? '—'}</td>
                    <td className="text-center">{culture.product_count}</td>
                    <td>{culture.is_archived ? <Badge tone="neutral">Archived</Badge> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={saveCultureAction}>
            <Card title="New handloom culture">
              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                <label>
                  Name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Zari Kota" />
                </label>
                <label>
                  SKU code <span className="text-red-600">*</span>
                  <input className="field" name="code" placeholder="ZK" />
                  <span className="text-2xs text-ink-400">Appears in SKUs — must stay unique.</span>
                </label>
                {TEXT_FIELDS.map(([key, label]) => (
                  <label key={String(key)}>
                    {label}
                    <input className="field" name={String(key)} />
                  </label>
                ))}
                <label className="sm:col-span-2">
                  Significance
                  <textarea className="field" name="significance" rows={2} />
                </label>
                <label className="sm:col-span-2">
                  History
                  <textarea className="field" name="history" rows={3} />
                  <span className="text-2xs text-ink-400">Only verified, sourced information — never invented.</span>
                </label>
                <label className="sm:col-span-2">
                  Description
                  <textarea className="field" name="description" rows={2} />
                </label>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-sm btn-primary" type="submit">
                  Create culture
                </button>
              </div>
            </Card>
          </ActionForm>

          <div className="flex flex-col gap-4">
            {cultures
              .filter((culture) => !culture.is_archived)
              .map((culture) => (
                <ActionForm key={culture.id} action={saveCultureAction}>
                  <Card title={`Edit · ${culture.name}`} action={<span className="mono text-2xs text-ink-400">{culture.code}</span>}>
                    <input type="hidden" name="id" value={culture.id} />
                    <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                      <label>
                        Name
                        <input className="field" name="name" defaultValue={culture.name} required />
                      </label>
                      <label>
                        SKU code
                        <input className="field" name="code" defaultValue={culture.code} required />
                      </label>
                      {TEXT_FIELDS.map(([key, label]) => (
                        <label key={String(key)}>
                          {label}
                          <input className="field" name={String(key)} defaultValue={String(culture[key] ?? '')} />
                        </label>
                      ))}
                    </div>
                    <div className="border-t border-ink-200 px-4 py-2.5">
                      <button className="btn btn-sm btn-primary" type="submit">
                        Save
                      </button>
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
