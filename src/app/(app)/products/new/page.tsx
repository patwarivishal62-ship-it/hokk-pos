import { requirePermission } from '@/lib/auth';
import { all } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { Card, PageHeader } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { createProductAction } from '@/app/actions/products';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requirePermission('product.create');
  const categories = all<{ id: string; name: string; template_key: string; sku_segment: string | null }>(
    'SELECT id, name, template_key, sku_segment FROM category WHERE is_archived = 0 ORDER BY sort_order, name',
  );
  const cultures = all<{ id: string; name: string; code: string }>(
    'SELECT id, name, code FROM handloom_culture WHERE is_archived = 0 ORDER BY sort_order, name',
  );
  const guides = all<{ id: string; name: string; unit: string }>('SELECT id, name, unit FROM size_guide WHERE is_archived = 0 ORDER BY name');
  const users = all<{ id: string; name: string }>('SELECT id, name FROM "user" WHERE is_active = 1 ORDER BY name');
  const pattern = getSetting('sku.pattern');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New product"
        subtitle="Step 1 of the pipeline. Everything else — naming, photography, content, review — happens on the product page."
      />

      <ActionForm action={createProductAction}>
        <Card title="Identification" action={<span className="text-2xs text-ink-400">SKU is generated from {pattern}</span>}>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <label>
              Product name
              <input className="field" name="name" placeholder="Leave blank — naming is a separate step" />
              <span className="text-2xs text-ink-400">
                Never required here. A product can exist unnamed; it cannot be approved unnamed.
              </span>
            </label>
            <label>
              Internal reference
              <input className="field" name="internal_reference" placeholder="Supplier lot, design number…" />
            </label>
            <label>
              SKU override
              <input className="field mono" name="sku" placeholder="Auto-generated" />
              <span className="text-2xs text-ink-400">Leave blank to allocate the next free SKU. Immutable once created.</span>
            </label>
            <label>
              Product type label
              <input className="field" name="product_type_label" placeholder="Handloom saree" />
            </label>
          </div>
        </Card>

        <Card title="Classification">
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <label>
              Category
              <select className="field" name="category_id" defaultValue="">
                <option value="">Unassigned</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} ({category.template_key.toLowerCase()})
                  </option>
                ))}
              </select>
              <span className="text-2xs text-ink-400">
                Determines which attribute set and image slot template apply. Create categories first if this list is empty.
              </span>
            </label>
            <label>
              Handloom culture
              <select className="field" name="handloom_culture_id" defaultValue="">
                <option value="">Unknown — information required</option>
                {cultures.map((culture) => (
                  <option key={culture.id} value={culture.id}>
                    {culture.name} ({culture.code})
                  </option>
                ))}
              </select>
              <span className="text-2xs text-ink-400">
                Leave as unknown rather than guessing. It will appear on the missing-information dashboard.
              </span>
            </label>
            <label>
              Size guide
              <select className="field" name="size_guide_id" defaultValue="">
                <option value="">None</option>
                {guides.map((guide) => (
                  <option key={guide.id} value={guide.id}>
                    {guide.name} ({guide.unit})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assign to
              <select className="field" name="assignee_id" defaultValue="">
                <option value="">Unassigned</option>
                {users.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Opening values">
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              Selling price
              <input className="field" name="price" type="number" step="0.01" min="0" />
            </label>
            <label>
              Currency
              <input className="field" name="currency" defaultValue={getSetting('units.currency')} />
            </label>
            <label>
              Colour
              <input className="field" name="colour" />
            </label>
            <label>
              Fabric
              <input className="field" name="fabric" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-ink-200 px-4 py-2.5">
            <p className="text-2xs text-ink-400">
              The product starts as DRAFT with a completion percentage and an explicit list of missing items.
            </p>
            <button className="btn btn-primary" type="submit">
              Create product
            </button>
          </div>
        </Card>
      </ActionForm>

      {categories.length === 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No product categories exist yet. A product without a category has no attribute set and no image slot template —
          create one under <a className="underline" href="/categories">Catalogue structure → Categories</a> first.
        </div>
      )}
    </div>
  );
}
