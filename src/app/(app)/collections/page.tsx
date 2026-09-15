import Link from 'next/link';
import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionForm, ConfirmSubmit } from '@/components/action-form';
import { archiveCollectionAction, reorderCollectionsAction, saveCollectionAction } from '@/app/actions/taxonomy';
import { CollectionsBoard } from './collections-board';

export const dynamic = 'force-dynamic';

interface CollectionRow {
  id: string;
  name: string;
  handle: string;
  kind: string;
  description: string | null;
  sort_order: number;
  is_archived: number;
  product_count: number;
}

export default async function CollectionsPage() {
  const user = await requirePermission('taxonomy.collection.view');
  const canManage = userCan(user, 'taxonomy.collection.manage');

  const collections = all<CollectionRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM product_collection pc WHERE pc.collection_id = c.id) AS product_count
     FROM collection c ORDER BY c.sort_order, c.name`,
  );
  const categories = all<{ id: string; name: string; template_key: string; product_count: number }>(
    `SELECT c.id, c.name, c.template_key,
            (SELECT COUNT(*) FROM product p WHERE p.category_id = c.id AND p.is_archived = 0) AS product_count
     FROM category c WHERE c.is_archived = 0 ORDER BY c.sort_order, c.name`,
  );
  const cultures = all<{ id: string; name: string; code: string; state: string | null; region: string | null; product_count: number }>(
    `SELECT hc.id, hc.name, hc.code, hc.state, hc.region,
            (SELECT COUNT(*) FROM product p WHERE p.handloom_culture_id = hc.id AND p.is_archived = 0) AS product_count
     FROM handloom_culture hc WHERE hc.is_archived = 0 ORDER BY hc.sort_order, hc.name`,
  );

  const active = collections.filter((c) => !c.is_archived);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Collections & structure"
        subtitle="Product category, handloom culture and customer-facing collections are three separate dimensions. A product holds one category, one culture and many collections."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Product categories" action={<Link href="/categories" className="btn btn-sm">Manage</Link>}>
          {categories.length === 0 ? (
            <EmptyState title="No categories" />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-100">
              {categories.map((category) => (
                <li key={category.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1 text-sm">{category.name}</span>
                  <Badge tone="neutral">{category.template_key.toLowerCase()}</Badge>
                  <span className="text-xs text-ink-400">{category.product_count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Handloom cultures" action={<Link href="/cultures" className="btn btn-sm">Manage</Link>}>
          {cultures.length === 0 ? (
            <EmptyState title="No cultures" body="Cultures drive the SKU culture code and the weave attributes." />
          ) : (
            <ul className="flex flex-col divide-y divide-ink-100">
              {cultures.map((culture) => (
                <li key={culture.id} className="flex items-center gap-2 px-4 py-2">
                  <span className="flex-1 text-sm">{culture.name}</span>
                  <span className="mono text-2xs text-ink-400">{culture.code}</span>
                  <span className="text-xs text-ink-400">{culture.product_count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Customer collections" action={<span className="text-2xs text-ink-400">{active.length} active</span>}>
          {active.length === 0 ? (
            <EmptyState title="No collections yet" body="Create New Arrivals, Everyday, Festive, Occasion…" />
          ) : (
            <CollectionsBoard collections={active} canManage={canManage} />
          )}
        </Card>
      </div>

      <Card title="Products per collection">
        {collections.length === 0 ? (
          <EmptyState title="Nothing to show" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Handle</th>
                  <th>Kind</th>
                  <th>Products</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <tr key={collection.id} className={collection.is_archived ? 'opacity-50' : ''}>
                    <td className="font-medium">
                      <Link href={`/products?collection=${collection.id}`} className="text-brand hover:underline">
                        {collection.name}
                      </Link>
                    </td>
                    <td className="mono text-xs">{collection.handle}</td>
                    <td className="text-xs">{collection.kind}</td>
                    <td className="text-center">{collection.product_count}</td>
                    <td>{collection.is_archived ? <Badge tone="neutral">Archived</Badge> : <Badge tone="success">Active</Badge>}</td>
                    <td className="whitespace-nowrap">
                      {canManage && (
                        <ActionForm action={archiveCollectionAction}>
                          <input type="hidden" name="id" value={collection.id} />
                          <button className="btn btn-sm" type="submit">
                            {collection.is_archived ? 'Restore' : 'Archive'}
                          </button>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={saveCollectionAction}>
            <Card title="New collection">
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Festive" />
                </label>
                <label>
                  Handle
                  <input className="field" name="handle" placeholder="festive" />
                </label>
                <label>
                  Kind
                  <select className="field" name="kind" defaultValue="CUSTOMER">
                    <option value="CUSTOMER">Customer-facing</option>
                    <option value="INTERNAL">Internal</option>
                  </select>
                </label>
                <label>
                  Description
                  <textarea className="field" name="description" rows={2} />
                </label>
                <label>
                  Sort order
                  <input className="field" name="sort_order" type="number" defaultValue={0} />
                </label>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-sm btn-primary" type="submit">
                  Create collection
                </button>
              </div>
            </Card>
          </ActionForm>

          <div className="flex flex-col gap-4">
            {active.map((collection) => (
              <ActionForm key={collection.id} action={saveCollectionAction}>
                <Card title={`Edit · ${collection.name}`}>
                  <input type="hidden" name="id" value={collection.id} />
                  <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                    <label>
                      Name
                      <input className="field" name="name" defaultValue={collection.name} required />
                    </label>
                    <label>
                      Handle
                      <input className="field" name="handle" defaultValue={collection.handle} />
                    </label>
                    <label>
                      Kind
                      <select className="field" name="kind" defaultValue={collection.kind}>
                        <option value="CUSTOMER">Customer-facing</option>
                        <option value="INTERNAL">Internal</option>
                      </select>
                    </label>
                    <label>
                      Sort order
                      <input className="field" name="sort_order" type="number" defaultValue={collection.sort_order} />
                    </label>
                  </div>
                  <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5">
                    <button className="btn btn-sm btn-primary" type="submit">
                      Save
                    </button>
                    <ActionForm action={archiveCollectionAction}>
                      <input type="hidden" name="id" value={collection.id} />
                      <ConfirmSubmit label="Archive" confirm={`Archive “${collection.name}”?`} />
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
