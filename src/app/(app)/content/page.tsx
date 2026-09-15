import Link from 'next/link';
import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, Meter, PageHeader, StatusBadge } from '@/components/ui';
import { NAME_STATUS_LABELS, type NameStatus, type ProductStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface ContentRow {
  id: string;
  sku: string;
  name: string | null;
  name_status: string;
  status: ProductStatus;
  short_description: string | null;
  full_description: string | null;
  story: string | null;
  seo_title: string | null;
  seo_description: string | null;
  handle: string | null;
  completeness_score: number;
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ q?: string; missing?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase();
  const missing = params.missing === '1';
  const canEdit = userCan(user, 'content.edit');

  const rows = all<ContentRow>(
    `SELECT p.id, p.sku, p.name, p.name_status, p.status, p.short_description, p.full_description, p.story,
            p.seo_title, p.seo_description, p.handle, p.completeness_score
     FROM product p WHERE p.is_archived = 0 ORDER BY p.completeness_score ASC, p.updated_at DESC`,
  );

  const filtered = rows
    .filter((row) => {
      if (missing && !isMissingContent(row)) return false;
      if (!q) return true;
      return row.sku.toLowerCase().includes(q) || (row.name ?? '').toLowerCase().includes(q);
    })
    .map((row) => ({ row, issues: contentIssues(row) }))
    .filter((entry) => (missing ? entry.issues.length > 0 : true));

  const stats = {
    total: rows.length,
    unnamed: rows.filter((row) => row.name_status === 'NOT_NAMED' || row.name_status === 'NAMING_REQUIRED').length,
    pending: rows.filter((row) => row.name_status === 'NAME_PROPOSED').length,
    missingDescription: rows.filter((row) => !row.short_description || !row.full_description).length,
    missingSeo: rows.filter((row) => !row.seo_title || !row.seo_description).length,
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Content workspace"
        subtitle="Names, descriptions, story, SEO. Every character count is shown — Shopify truncates long SEO text."
        actions={
          <form className="flex items-center gap-2">
            <input className="field field-sm w-56" name="q" defaultValue={params.q ?? ''} placeholder="Search SKU or name" />
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="missing" value="1" defaultChecked={missing} />
              Incomplete only
            </label>
            <button className="btn btn-sm" type="submit">
              Filter
            </button>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Products" value={stats.total} />
        <Kpi label="Needs naming" value={stats.unnamed} tone="text-red-700" />
        <Kpi label="Name pending" value={stats.pending} tone="text-amber-700" />
        <Kpi label="Missing description" value={stats.missingDescription} tone="text-amber-700" />
        <Kpi label="Missing SEO" value={stats.missingSeo} tone="text-amber-700" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={missing ? 'Nothing incomplete' : 'No products'} body={missing ? 'Every product has the required content.' : 'Create a product first.'} />
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(({ row, issues }) => (
            <Card
              key={row.id}
              title={row.name ?? <em className="text-ink-400">Unnamed product</em>}
              action={
                <span className="flex items-center gap-2">
                  <span className="mono text-xs text-ink-500">{row.sku}</span>
                  <Badge tone={row.name_status === 'NAME_APPROVED' ? 'success' : row.name_status === 'NAME_PROPOSED' ? 'warn' : 'danger'}>
                    {NAME_STATUS_LABELS[row.name_status as NameStatus]}
                  </Badge>
                  <StatusBadge status={row.status} />
                </span>
              }
            >
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <Counter label="Short description" text={row.short_description} max={320} />
                  <Counter label="Full description" text={row.full_description} max={2000} />
                  <Counter label="The story" text={row.story} max={1200} />
                  <Counter label="SEO title" text={row.seo_title} max={70} />
                </div>
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <Counter label="SEO description" text={row.seo_description} max={320} />
                  <div>
                    <p className="text-2xs uppercase tracking-wider text-ink-500">Handle</p>
                    <p className="mono text-xs">{row.handle ?? <span className="text-ink-300">not generated</span>}</p>
                  </div>
                </div>
                {issues.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {issues.map((issue) => (
                      <li key={issue}>
                        <Badge tone="warn">{issue}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-3">
                  <Meter value={row.completeness_score} />
                  <Link href={`/products/${row.id}?tab=content`} className="btn btn-sm shrink-0">
                    {canEdit ? 'Write content' : 'View'}
                  </Link>
                  <Link href={`/products/${row.id}?tab=seo`} className="btn btn-sm shrink-0">
                    SEO
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function isMissingContent(row: ContentRow): boolean {
  return contentIssues(row).length > 0;
}

function contentIssues(row: ContentRow): string[] {
  const issues: string[] = [];
  if (!row.name) issues.push('No name');
  if (row.name_status !== 'NAME_APPROVED') issues.push('Name not approved');
  if (!row.short_description) issues.push('No short description');
  if (!row.full_description) issues.push('No full description');
  if (!row.story) issues.push('No story');
  if (!row.seo_title) issues.push('No SEO title');
  if (!row.seo_description) issues.push('No SEO description');
  if (row.seo_title && row.seo_title.length > 70) issues.push('SEO title too long');
  if (row.seo_description && row.seo_description.length > 320) issues.push('SEO description too long');
  return issues;
}

function Counter({ label, text, max }: { label: string; text: string | null; max: number }) {
  const length = text?.length ?? 0;
  const over = length > max;
  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xs ${over ? 'text-red-600' : length === 0 ? 'text-ink-300' : 'text-ink-700'}`}>
        {length === 0 ? 'empty' : `${length} characters`}
        <span className="text-ink-400"> / {max}</span>
      </p>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
