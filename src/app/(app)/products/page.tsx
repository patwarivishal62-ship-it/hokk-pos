import Link from 'next/link';
import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { listProducts, type ProductFilters } from '@/lib/products';
import { PRODUCT_STATUSES, STATUS_LABELS } from '@/lib/types';
import { EmptyState, PageHeader } from '@/components/ui';
import { CatalogTable } from './catalog-table';

export const dynamic = 'force-dynamic';

interface Params {
  q?: string;
  status?: string;
  category?: string;
  culture?: string;
  collection?: string;
  assignee?: string;
  colour?: string;
  fabric?: string;
  region?: string;
  readiness?: string;
  missing?: string;
  nameless?: string;
  unassigned?: string;
  archived?: string;
  price_min?: string;
  price_max?: string;
  updated_after?: string;
  sort?: string;
  dir?: string;
  offset?: string;
  limit?: string;
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireUser();
  const params = await searchParams;
  const limit = Math.min(200, Math.max(10, Number(params.limit ?? 50) || 50));
  const offset = Math.max(0, Number(params.offset ?? 0) || 0);

  const filters: ProductFilters = {
    search: params.q,
    status: params.status ? params.status.split(',').filter(Boolean) : undefined,
    categoryId: params.category || undefined,
    cultureId: params.culture || undefined,
    collectionId: params.collection || undefined,
    colour: params.colour || undefined,
    fabric: params.fabric || undefined,
    region: params.region || undefined,
    readiness: params.readiness ? params.readiness.split(',').filter(Boolean) : undefined,
    priceMin: params.price_min ? Number(params.price_min) : undefined,
    priceMax: params.price_max ? Number(params.price_max) : undefined,
    updatedAfter: params.updated_after || undefined,
    archived: params.archived === '1',
    missingInfo: params.missing === 'info',
    missingPhotography: params.missing === 'photos',
    awaitingApproval: params.missing === 'approval',
    sortBy: (params.sort as ProductFilters['sortBy']) ?? 'updated',
    sortDir: params.dir === 'asc' ? 'asc' : 'desc',
    limit,
    offset,
  };
  if (params.assignee === 'me') filters.assigneeId = user.id;
  else if (params.assignee) filters.assigneeId = params.assignee;
  if (params.unassigned === '1') filters.unassigned = true;

  // "Not named" is expressed as the two name statuses that mean no approved name.
  if (params.nameless === '1') filters.nameStatus = 'NOT_NAMED';

  const { rows, total } = listProducts(filters);

  const [categories, cultures, collections, users] = [
    all<{ id: string; name: string }>('SELECT id, name FROM category WHERE is_archived = 0 ORDER BY sort_order, name'),
    all<{ id: string; name: string }>('SELECT id, name FROM handloom_culture WHERE is_archived = 0 ORDER BY sort_order, name'),
    all<{ id: string; name: string }>('SELECT id, name FROM collection WHERE is_archived = 0 ORDER BY sort_order, name'),
    all<{ id: string; name: string }>('SELECT id, name FROM "user" WHERE is_active = 1 ORDER BY name'),
  ];

  const activeFilters = Object.entries(params).filter(
    ([key, value]) => value && !['limit', 'offset', 'sort', 'dir'].includes(key),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Catalog"
        subtitle={`${total} product${total === 1 ? '' : 's'}${activeFilters ? ` · ${activeFilters} filter${activeFilters === 1 ? '' : 's'} active` : ''}`}
        actions={
          <>
            {userCan(user, 'product.create') && (
              <Link href="/products/new" className="btn btn-primary">
                New product
              </Link>
            )}
            <Link href="/exports" className="btn">
              Export
            </Link>
          </>
        }
      />

      <form method="get" className="card flex flex-wrap items-end gap-2 px-3 py-2.5">
        <input type="hidden" name="sort" value={params.sort ?? ''} />
        <input type="hidden" name="dir" value={params.dir ?? ''} />
        <div className="flex min-w-52 flex-1 flex-col gap-1">
          <label>Search</label>
          <input className="field" name="q" defaultValue={params.q ?? ''} placeholder="SKU, name, handle, fabric, colour…" />
        </div>
        <FilterSelect name="status" label="Status" value={params.status} options={PRODUCT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <FilterSelect name="category" label="Category" value={params.category} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="culture" label="Handloom culture" value={params.culture} options={cultures.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect name="collection" label="Collection" value={params.collection} options={collections.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect
          name="assignee"
          label="Assigned"
          value={params.assignee}
          options={[{ id: 'me', name: 'Me' }, { id: 'none', name: '—' }, ...users].map((u) => ({ value: u.id, label: u.name }))}
        />
        <FilterSelect
          name="readiness"
          label="Shopify"
          value={params.readiness}
          options={[
            { value: 'READY', label: 'Ready' },
            { value: 'WARNINGS', label: 'Warnings' },
            { value: 'BLOCKED', label: 'Blocked' },
          ]}
        />
        <FilterSelect
          name="missing"
          label="Missing"
          value={params.missing}
          options={[
            { value: 'info', label: 'Information' },
            { value: 'photos', label: 'Photography' },
            { value: 'approval', label: 'Approval' },
          ]}
        />
        <div className="flex flex-col gap-1">
          <label>Colour</label>
          <input className="field w-28" name="colour" defaultValue={params.colour ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <label>Fabric</label>
          <input className="field w-28" name="fabric" defaultValue={params.fabric ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <label>Region</label>
          <input className="field w-28" name="region" defaultValue={params.region ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <label>Price ≥</label>
          <input className="field w-24" name="price_min" defaultValue={params.price_min ?? ''} inputMode="numeric" />
        </div>
        <div className="flex flex-col gap-1">
          <label>Price ≤</label>
          <input className="field w-24" name="price_max" defaultValue={params.price_max ?? ''} inputMode="numeric" />
        </div>
        <div className="flex items-center gap-2 pb-1">
          <label className="flex items-center gap-1 text-2xs normal-case">
            <input type="checkbox" name="nameless" value="1" defaultChecked={params.nameless === '1'} />
            Unnamed
          </label>
          <label className="flex items-center gap-1 text-2xs normal-case">
            <input type="checkbox" name="unassigned" value="1" defaultChecked={params.unassigned === '1'} />
            Unassigned
          </label>
          <label className="flex items-center gap-1 text-2xs normal-case">
            <input type="checkbox" name="archived" value="1" defaultChecked={params.archived === '1'} />
            Archived
          </label>
        </div>
        <div className="flex items-center gap-1.5 pb-0.5">
          <button className="btn btn-sm btn-primary" type="submit">
            Filter
          </button>
          <Link className="btn btn-sm" href="/products">
            Reset
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={total === 0 ? 'No products match these filters' : 'Nothing on this page'}
            body={
              total === 0
                ? 'Adjust the filters, or create the first product. Nothing is sent to Shopify until a product is approved and exported.'
                : 'Try a different page.'
            }
            action={
              userCan(user, 'product.create') ? (
                <Link href="/products/new" className="btn btn-primary">
                  New product
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <CatalogTable
          rows={rows}
          total={total}
          offset={offset}
          limit={limit}
          canBulk={userCan(user, 'product.bulk')}
          users={users}
          categories={categories}
          cultures={cultures}
          collections={collections}
          statuses={PRODUCT_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
          queryString={new URLSearchParams(Object.entries(params).filter(([, v]) => v) as Array<[string, string]>).toString()}
        />
      )}
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label>{label}</label>
      <select className="field w-36" name={name} defaultValue={value ?? ''}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
