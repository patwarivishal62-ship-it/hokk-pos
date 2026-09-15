import Link from 'next/link';
import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { getStorage } from '@/lib/storage';
import { buildSlotChecklist, photographyProgress } from '@/lib/images';
import { Badge, Card, EmptyState, Meter, PageHeader, StatusBadge, formatDateTime } from '@/components/ui';
import type { ProductStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PhotoProduct {
  id: string;
  sku: string;
  name: string | null;
  status: ProductStatus;
  template_key: string;
  colour: string | null;
  updated_at: string;
}

export default async function PhotographyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase();
  const canUpload = userCan(user, 'image.upload');

  const products = all<PhotoProduct>(
    `SELECT p.id, p.sku, p.name, p.status, COALESCE(c.template_key,'GENERIC') AS template_key, p.colour, p.updated_at
     FROM product p LEFT JOIN category c ON c.id = p.category_id
     WHERE p.is_archived = 0 ORDER BY p.updated_at DESC`,
  );

  const rows = products
    .map((product) => {
      const slots = all<{ id: string; key: string; label: string; file_suffix: string; is_required: number }>(
        `SELECT s.id, s.key, s.label, s.file_suffix, s.is_required FROM image_slot_definition s
         JOIN image_slot_template t ON t.id = s.template_id WHERE t.key = ? ORDER BY s.sort_order`,
        [product.template_key],
      );
      const images = all<{ id: string; slot_id: string | null; folder: string; review_status: string }>(
        'SELECT id, slot_id, folder, review_status FROM product_image WHERE product_id = ?',
        [product.id],
      );
      const checklist = buildSlotChecklist(slots, images);
      const progress = photographyProgress(checklist);
      return { product, checklist, progress, images };
    })
    .filter((row) => {
      if (!q) return true;
      return (
        row.product.sku.toLowerCase().includes(q) ||
        (row.product.name ?? '').toLowerCase().includes(q) ||
        (row.product.colour ?? '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // Missing required shots first, then most recently touched.
      const aMissing = a.progress.required - a.progress.complete;
      const bMissing = b.progress.required - b.progress.complete;
      if (aMissing !== bMissing) return bMissing - aMissing;
      return b.product.updated_at.localeCompare(a.product.updated_at);
    });

  const totals = rows.reduce(
    (acc, row) => ({
      products: acc.products + 1,
      complete: acc.complete + (row.progress.required > 0 && row.progress.complete === row.progress.required ? 1 : 0),
      outstanding: acc.outstanding + Math.max(0, row.progress.required - row.progress.complete),
    }),
    { products: 0, complete: 0, outstanding: 0 },
  );

  const storage = getStorage();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Photography workspace"
        subtitle="Slot grid per product. Required shots block export until they are filled."
        actions={
          <form className="flex items-center gap-2">
            <input className="field field-sm w-56" name="q" defaultValue={params.q ?? ''} placeholder="Search SKU, name, colour" />
            <button className="btn btn-sm" type="submit">
              Search
            </button>
          </form>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Products" value={totals.products} />
        <Kpi label="Photo complete" value={totals.complete} tone="text-emerald-700" />
        <Kpi label="Outstanding shots" value={totals.outstanding} tone="text-amber-700" />
        <Kpi label="Storage" value={storage.backend === "GDRIVE" ? "Google Drive" : "Local disk"} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No products" body="Create a product first — photography needs a SKU to name the files." />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Card
              key={row.product.id}
              title={row.product.name ?? row.product.sku}
              action={
                <span className="flex items-center gap-2">
                  <span className="mono text-xs text-ink-500">{row.product.sku}</span>
                  <StatusBadge status={row.product.status} />
                  <span className="text-2xs text-ink-400">
                    {row.progress.complete}/{row.progress.required} required
                  </span>
                </span>
              }
            >
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {row.checklist.map((slot) => (
                    <Link
                      key={slot.slotId}
                      href={`/products/${row.product.id}?tab=images`}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                        slot.state === 'FILLED'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : slot.required
                            ? 'border-red-200 bg-red-50 text-red-900'
                            : 'border-ink-200 bg-white text-ink-600'
                      }`}
                    >
                      <span className="w-3">{slot.state === 'FILLED' ? '✓' : '○'}</span>
                      <span className="flex-1">{slot.label}</span>
                      {slot.required && slot.state === 'MISSING' && <span className="text-2xs uppercase">required</span>}
                    </Link>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Meter value={row.progress.pct} />
                  <span className="whitespace-nowrap text-2xs text-ink-400">
                    updated {formatDateTime(row.product.updated_at)}
                  </span>
                  {canUpload && (
                    <Link href={`/products/${row.product.id}?tab=images`} className="btn btn-sm shrink-0">
                      Upload
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card title="How image slots work">
        <div className="flex flex-col gap-1 px-4 py-3 text-xs text-ink-600">
          <p>Each product category uses a slot template (Saree, Apparel or Generic) defined in the system.</p>
          <p>
            Files are named automatically as <span className="mono">HOKK-SAR-ZK-001-HERO.jpg</span> — SKU plus slot plus
            index — so nothing depends on the display name.
          </p>
          <p>
            Uploads land in the <strong>Original</strong> folder. Approving an image copies it to <strong>Final</strong>,
            which is what Shopify receives.
          </p>
          <p>Only JPG, JPEG, PNG and WEBP are accepted. Oversized, undersized and duplicate files are rejected with a reason.</p>
        </div>
      </Card>

      {!canUpload && (
        <p className="text-xs text-ink-400">
          <Badge tone="neutral">Read-only</Badge> Your role cannot upload images.
        </p>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2">
      <p className="text-2xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
