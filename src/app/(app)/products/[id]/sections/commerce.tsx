import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import type { ProductBundle } from '@/lib/completeness';
import { Badge, Card, EmptyState } from '@/components/ui';
import { ActionForm, ConfirmSubmit } from '@/components/action-form';
import { deleteVariantAction, saveVariantAction, setCollectionsAction, updateProductAction } from '@/app/actions/products';
import { CheckboxField, FormActions, MoneyField, SelectField, TextField } from './fields';
import { CollectionPicker } from './collection-picker';

export async function VariantsTab({ bundle, tags }: { bundle: ProductBundle; tags: string[] }) {
  const user = await requireUser();
  const { product } = bundle;
  const canEdit = userCan(user, 'product.edit');
  const currency = product.currency || getSetting('units.currency') || 'INR';
  const weightUnit = getSetting('units.weight') || 'g';

  return (
    <div className="flex flex-col gap-4">
      <ActionForm
        action={updateProductAction}
      >
          <input type="hidden" name="product_id" value={product.id} />
        <Card title="Product-level pricing & inventory" action={<span className="text-2xs text-ink-400">Used as the default for variants</span>}>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyField name="price" label="Selling price" value={product.price} currency={currency} />
            <MoneyField name="compare_at_price" label="Compare-at price" value={product.compare_at_price} currency={currency} />
            <MoneyField name="cost_price" label="Cost price" value={product.cost_price} currency={currency} />
            <TextField name="currency" label="Currency" value={product.currency} hint="Defaults to INR." />
            <TextField name="inventory_qty" label="Inventory quantity" value={product.inventory_qty} type="number" />
            <SelectField
              name="inventory_policy"
              label="When out of stock"
              value={product.inventory_policy}
              options={[
                { value: 'deny', label: 'Deny (stop selling)' },
                { value: 'continue', label: 'Continue selling' },
              ]}
            />
            <TextField name="weight" label={`Weight (${weightUnit})`} value={product.weight} type="number" />
            <TextField name="tax_code" label="Tax code" value={product.tax_code} />
            <div className="flex flex-col gap-2">
              <CheckboxField name="taxable" label="Charge tax" checked={product.taxable} />
              <CheckboxField name="track_inventory" label="Track inventory" checked={product.track_inventory} />
              <CheckboxField name="requires_shipping" label="Requires shipping" checked={product.requires_shipping} />
              <CheckboxField name="discount_eligible" label="Discount eligible" checked={product.discount_eligible} />
            </div>
          </div>
          {canEdit && <FormActions label="Save pricing" />}
        </Card>
      </ActionForm>

      <Card
        title={`Variants (${bundle.variants.length})`}
        action={
          <span className="text-2xs text-ink-400">
            Shopify allows 3 options and 100 variants. Tags: {tags.length > 0 ? tags.join(', ') : 'none'}
          </span>
        }
      >
        {bundle.variants.length === 0 ? (
          <EmptyState title="No variants" body="Add at least one variant so pricing, SKU and inventory can be exported." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Option 1</th>
                  <th>Option 2</th>
                  <th>Option 3</th>
                  <th>Price</th>
                  <th>Compare</th>
                  <th>Cost</th>
                  <th>Qty</th>
                  <th>Weight</th>
                  <th>Barcode</th>
                </tr>
              </thead>
              <tbody>
                {bundle.variants.map((variant) => (
                  <tr key={variant.id}>
                    <td className="mono">{variant.sku}</td>
                    <td>
                      <span className="text-2xs text-ink-400">{variant.option1_name}: </span>
                      {variant.option1_value}
                    </td>
                    <td>{variant.option2_value ?? '—'}</td>
                    <td>{variant.option3_value ?? '—'}</td>
                    <td>{variant.price ?? '—'}</td>
                    <td>{variant.compare_at_price ?? '—'}</td>
                    <td>{variant.cost_price ?? '—'}</td>
                    <td>{variant.track_inventory === 1 ? variant.inventory_qty : <span className="text-ink-300">n/t</span>}</td>
                    <td>
                      {variant.weight ?? '—'} {variant.weight_unit}
                    </td>
                    <td className="mono">{variant.barcode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canEdit && (
        <div className="grid gap-4 lg:grid-cols-2">
          {bundle.variants.map((variant) => (
            <ActionForm key={variant.id} action={saveVariantAction}>
              <Card title={`Edit variant · ${variant.sku}`}>
                <input type="hidden" name="product_id" value={product.id} />
                <input type="hidden" name="variant_id" value={variant.id} />
                <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                  <TextField name="sku" label="Variant SKU" value={variant.sku} />
                  <TextField name="position" label="Position" value={variant.position} type="number" />
                  <TextField name="option1_name" label="Option 1 name" value={variant.option1_name} placeholder="Size" />
                  <TextField name="option1_value" label="Option 1 value" value={variant.option1_value} placeholder="M" />
                  <TextField name="option2_name" label="Option 2 name" value={variant.option2_name} placeholder="Colour" />
                  <TextField name="option2_value" label="Option 2 value" value={variant.option2_value} />
                  <TextField name="option3_name" label="Option 3 name" value={variant.option3_name} />
                  <TextField name="option3_value" label="Option 3 value" value={variant.option3_value} />
                  <MoneyField name="price" label="Price" value={variant.price} currency={currency} />
                  <MoneyField name="compare_at_price" label="Compare-at" value={variant.compare_at_price} currency={currency} />
                  <MoneyField name="cost_price" label="Cost" value={variant.cost_price} currency={currency} />
                  <TextField name="inventory_qty" label="Inventory" value={variant.inventory_qty} type="number" />
                  <TextField name="weight" label={`Weight (${variant.weight_unit})`} value={variant.weight} type="number" />
                  <TextField name="barcode" label="Barcode" value={variant.barcode} />
                  <div className="flex flex-col gap-2">
                    <CheckboxField name="taxable" label="Taxable" checked={variant.taxable} />
                    <CheckboxField name="track_inventory" label="Track inventory" checked={variant.track_inventory} />
                    <CheckboxField name="requires_shipping" label="Requires shipping" checked={variant.requires_shipping} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-ink-200 px-4 py-2.5">
                  <button className="btn btn-sm btn-primary" type="submit">
                    Save variant
                  </button>
                  <ActionForm action={deleteVariantAction}>
                    <input type="hidden" name="product_id" value={product.id} />
                    <input type="hidden" name="variant_id" value={variant.id} />
                    <ConfirmSubmit label="Delete" confirm="Delete this variant?" />
                  </ActionForm>
                </div>
              </Card>
            </ActionForm>
          ))}

          <ActionForm action={saveVariantAction}>
            <Card title="Add variant">
              <input type="hidden" name="product_id" value={product.id} />
              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                <TextField name="sku" label="Variant SKU" placeholder={`${product.sku}-M`} />
                <TextField name="option1_name" label="Option 1 name" value="Size" />
                <TextField name="option1_value" label="Option 1 value" placeholder="M" />
                <TextField name="option2_name" label="Option 2 name" placeholder="Colour" />
                <TextField name="option2_value" label="Option 2 value" />
                <MoneyField name="price" label="Price" value={product.price} currency={currency} />
                <TextField name="inventory_qty" label="Inventory" value={0} type="number" />
                <TextField name="weight" label={`Weight (${weightUnit})`} value={product.weight} type="number" />
              </div>
              <FormActions label="Add variant" />
            </Card>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

export async function CollectionsTab({ bundle }: { bundle: ProductBundle }) {
  const user = await requireUser();
  const { product } = bundle;
  const collections = all<{ id: string; name: string; kind: string; description: string | null; handle: string }>(
    'SELECT id, name, kind, description, handle FROM collection WHERE is_archived = 0 ORDER BY sort_order, name',
  );
  const assigned = bundle.collections.map((c) => c.id);

  return (
    <ActionForm action={setCollectionsAction} className="flex flex-col gap-4">
      <input type="hidden" name="product_id" value={product.id} />
      <Card title="Collections" action={<span className="text-2xs text-ink-400">A product can belong to many collections</span>}>
        {collections.length === 0 ? (
          <EmptyState title="No collections yet" body="Create collections under Catalogue structure → Collections." />
        ) : (
          <CollectionPicker collections={collections} assigned={assigned} />
        )}
      </Card>
      {userCan(user, 'product.edit') && collections.length > 0 && <FormActions label="Save collections" />}
    </ActionForm>
  );
}
