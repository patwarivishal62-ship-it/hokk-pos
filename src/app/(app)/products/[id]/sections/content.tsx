import { requireUser, userCan } from '@/lib/auth';
import { all, parseJson } from '@/lib/db';
import type { ProductBundle } from '@/lib/completeness';
import { Badge, Card } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { setHandleAction, updateProductAction } from '@/app/actions/products';
import { slugify } from '@/lib/handle';
import { FormActions, TextAreaField, TextField } from './fields';

export async function ContentTab({ bundle }: { bundle: ProductBundle }) {
  const user = await requireUser();
  const { product } = bundle;
  const canEdit = userCan(user, 'content.edit') || userCan(user, 'product.edit');

  return (
    <ActionForm
      action={async (prev, formData) => updateProductAction(product.id, formData).then((result) => ({ ...prev, ...result }))}
      className="flex flex-col gap-4"
    >
      <Card title="Descriptions" action={<span className="text-2xs text-ink-400">Separate fields — assembled for Shopify on export</span>}>
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextAreaField
            name="short_description"
            label="Short description"
            value={product.short_description}
            rows={2}
            hint={`${(product.short_description ?? '').length} characters. Used for listings and cards.`}
          />
          <TextAreaField
            name="full_description"
            label="Full description"
            value={product.full_description}
            rows={6}
            hint={`${(product.full_description ?? '').length} characters. HTML is preserved if present, otherwise paragraphs are generated.`}
          />
        </div>
      </Card>

      <Card title="Storytelling">
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextAreaField name="story" label="The story" value={product.story} rows={5} hint="Brand storytelling. Exported as its own section." />
          <TextAreaField name="about_the_weave" label="About the weave" value={product.about_the_weave} rows={5} />
          <TextAreaField name="about_the_artisan" label="About the artisan" value={product.about_the_artisan} rows={4} hint="Only verified, consented information." />
        </div>
      </Card>

      <Card title="Details, care & shipping">
        <div className="flex flex-col gap-3 px-4 py-3">
          <TextAreaField
            name="details"
            label="Details (one bullet per line)"
            value={parseJson<string[]>(product.details, []).join('\n')}
            rows={5}
          />
          <TextAreaField name="care" label="Care instructions" value={product.care} rows={3} />
          <TextAreaField name="shipping_notes" label="Shipping / packaging notes" value={product.shipping_notes} rows={3} hint="Customer-facing notes." />
          <TextAreaField name="packaging_notes" label="Internal packaging notes" value={product.packaging_notes} rows={2} hint="Never exported." />
        </div>
      </Card>

      {canEdit && <FormActions label="Save content" />}
    </ActionForm>
  );
}

export async function SeoTab({ bundle }: { bundle: ProductBundle }) {
  const user = await requireUser();
  const { product } = bundle;
  const clashes = product.handle
    ? all<{ id: string; sku: string }>('SELECT id, sku FROM product WHERE handle = ? AND id != ?', [product.handle, product.id])
    : [];
  const suggested = slugify(product.name ?? product.sku);

  return (
    <div className="flex flex-col gap-4">
      <ActionForm
        action={async (prev, formData) => updateProductAction(product.id, formData).then((result) => ({ ...prev, ...result }))}
        className="flex flex-col gap-4"
      >
        <Card title="SEO">
          <div className="flex flex-col gap-3 px-4 py-3">
            <TextField
              name="seo_title"
              label="SEO title"
              value={product.seo_title}
              hint={`${(product.seo_title ?? '').length}/70 characters recommended.`}
            />
            <TextAreaField
              name="seo_description"
              label="SEO description"
              value={product.seo_description}
              rows={3}
              hint={`${(product.seo_description ?? '').length}/320 characters. Shopify truncates beyond 320.`}
            />
          </div>
        </Card>
        {userCan(user, 'product.edit') && <FormActions label="Save SEO" />}
      </ActionForm>

      <Card
        title="Shopify handle"
        action={
          product.handle_locked === 1 ? (
            <Badge tone="info">Locked</Badge>
          ) : (
            <Badge tone="neutral">Auto-generated from the name</Badge>
          )
        }
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-500">Current:</span>
            <span className="mono">{product.handle ?? <em className="text-ink-400">none</em>}</span>
          </div>
          {product.name && <div className="text-2xs text-ink-400">Suggested from the name: <span className="mono">{suggested}</span></div>}
          {clashes.length > 0 && (
            <p className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              Duplicate handle — also used by {clashes.map((c) => c.sku).join(', ')}. Export is blocked until this is fixed.
            </p>
          )}
          {userCan(user, 'product.edit') && (
            <ActionForm action={setHandleAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="product_id" value={product.id} />
              <TextField name="handle" label="Manual override" value={product.handle} className="w-72" />
              <label className="flex items-center gap-1.5 pb-2 text-xs normal-case">
                <input type="checkbox" name="lock" value="1" defaultChecked={product.handle_locked === 1} />
                Lock this handle
              </label>
              <button className="btn btn-sm" type="submit">
                Save handle
              </button>
            </ActionForm>
          )}
          <p className="text-2xs text-ink-400">
            Handles are lowercase, hyphen separated, unique across the catalog. Shopify requires the handle on every variant row.
          </p>
        </div>
      </Card>
    </div>
  );
}
