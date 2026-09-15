import { requirePermission, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { archiveCategoryAction, saveCategoryAction } from '@/app/actions/taxonomy';

export const dynamic = 'force-dynamic';

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  sku_segment: string | null;
  template_key: string;
  shopify_category: string | null;
  shopify_type: string | null;
  description: string | null;
  is_archived: number;
  product_count: number;
}

export default async function CategoriesPage() {
  const user = await requirePermission('taxonomy.category.view');
  const categories = all<CategoryRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM product p WHERE p.category_id = c.id AND p.is_archived = 0) AS product_count
     FROM category c ORDER BY c.sort_order, c.name`,
  );
  const canManage = userCan(user, 'taxonomy.category.manage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product categories"
        subtitle="Categories drive the attribute set (Saree vs Apparel vs Generic) and the Shopify product category and type on export."
      />

      <Card title="Categories">
        {categories.length === 0 ? (
          <EmptyState title="No categories yet" body="Create the first category — for example Sarees, Everyday Wear or T-Shirts." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>SKU segment</th>
                  <th>Attribute set</th>
                  <th>Shopify category</th>
                  <th>Shopify type</th>
                  <th>Products</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <tr key={category.id} className={category.is_archived ? 'opacity-50' : ''}>
                    <td className="font-medium">{category.name}</td>
                    <td className="mono text-xs">{category.slug}</td>
                    <td className="mono text-xs">{category.sku_segment ?? '—'}</td>
                    <td>
                      <Badge tone="neutral">{category.template_key.toLowerCase()}</Badge>
                    </td>
                    <td className="text-xs">{category.shopify_category ?? '—'}</td>
                    <td className="text-xs">{category.shopify_type ?? '—'}</td>
                    <td className="text-center">{category.product_count}</td>
                    <td>
                      {category.is_archived === 1 && <Badge tone="neutral">Archived</Badge>}
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
          <ActionForm action={saveCategoryAction}>
            <Card title="New category">
              <div className="flex flex-col gap-3 px-4 py-3">
                <label>
                  Name <span className="text-red-600">*</span>
                  <input className="field" name="name" required placeholder="Sarees" />
                </label>
                <label>
                  Slug
                  <input className="field" name="slug" placeholder="sarees" />
                  <span className="text-2xs text-ink-400">Leave blank to generate from the name.</span>
                </label>
                <label>
                  SKU segment
                  <input className="field mono" name="sku_segment" placeholder="SAR" />
                  <span className="text-2xs text-ink-400">The {'{TYPE}'} part of the SKU pattern.</span>
                </label>
                <label>
                  Attribute set
                  <select className="field" name="template_key" defaultValue="GENERIC">
                    <option value="SAREE">Saree — length, blouse, pallu, fall &amp; pico…</option>
                    <option value="APPAREL">Apparel — fit, neckline, sleeve, closure, lining…</option>
                    <option value="GENERIC">Generic — common attributes only</option>
                  </select>
                  <span className="text-2xs text-ink-400">
                    Saree-only fields are never required for apparel products.
                  </span>
                </label>
                <label>
                  Shopify product category
                  <input className="field" name="shopify_category" placeholder="Apparel & Accessories > Clothing" />
                </label>
                <label>
                  Shopify product type
                  <input className="field" name="shopify_type" placeholder="Saree" />
                </label>
                <label>
                  Description
                  <textarea className="field" name="description" rows={2} />
                </label>
              </div>
              <div className="border-t border-ink-200 px-4 py-2.5">
                <button className="btn btn-primary btn-sm" type="submit">
                  Create category
                </button>
              </div>
            </Card>
          </ActionForm>

          <div className="flex flex-col gap-4">
            {categories
              .filter((category) => !category.is_archived)
              .map((category) => (
                <ActionForm key={category.id} action={saveCategoryAction}>
                  <Card
                    title={`Edit · ${category.name}`}
                    action={
                      <div className="flex gap-1">
                        <button className="btn btn-sm" type="submit">
                          Save
                        </button>
                      </div>
                    }
                  >
                    <input type="hidden" name="id" value={category.id} />
                    <div className="flex flex-col gap-3 px-4 py-3">
                      <label>
                        Name
                        <input className="field" name="name" defaultValue={category.name} required />
                      </label>
                      <label>
                        Slug
                        <input className="field" name="slug" defaultValue={category.slug} />
                      </label>
                      <label>
                        SKU segment
                        <input className="field mono" name="sku_segment" defaultValue={category.sku_segment ?? ''} />
                      </label>
                      <label>
                        Attribute set
                        <select className="field" name="template_key" defaultValue={category.template_key}>
                          <option value="SAREE">Saree</option>
                          <option value="APPAREL">Apparel</option>
                          <option value="GENERIC">Generic</option>
                        </select>
                      </label>
                      <label>
                        Shopify product category
                        <input className="field" name="shopify_category" defaultValue={category.shopify_category ?? ''} />
                      </label>
                      <label>
                        Shopify product type
                        <input className="field" name="shopify_type" defaultValue={category.shopify_type ?? ''} />
                      </label>
                    </div>
                    <div className="flex justify-end gap-1 border-t border-ink-200 px-4 py-2.5">
                      <button className="btn btn-sm btn-primary" type="submit">
                        Save
                      </button>
                    </div>
                  </Card>
                </ActionForm>
              ))}

            {categories.length > 0 && (
              <Card title="Archive">
                <ul className="flex flex-col divide-y divide-ink-100">
                  {categories.map((category) => (
                    <li key={category.id} className="flex items-center gap-2 px-4 py-2">
                      <span className="flex-1 text-sm">{category.name}</span>
                      {category.product_count > 0 && (
                        <span className="text-2xs text-ink-400">{category.product_count} product(s) — reassign first</span>
                      )}
                      <ActionForm action={archiveCategoryAction}>
                        <input type="hidden" name="id" value={category.id} />
                        <button className="btn btn-sm" type="submit">
                          {category.is_archived ? 'Restore' : 'Archive'}
                        </button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
