import { requireUser, userCan } from '@/lib/auth';
import { all } from '@/lib/db';
import { resolvePublicUrl } from '@/lib/storage';
import { buildSlotChecklist, photographyProgress } from '@/lib/images';
import type { ProductBundle } from '@/lib/completeness';
import { Badge, Card, Meter } from '@/components/ui';
import { ImageBoard, type BoardImage, type BoardSlot } from './image-board';

interface Photos {
  complete: number;
  required: number;
}

export async function ImagesTab({
  bundle,
  photos,
  publicBaseUrl,
}: {
  bundle: ProductBundle;
  photos: Photos;
  publicBaseUrl: string;
}) {
  const user = await requireUser();
  const { product } = bundle;
  const templateKey = product.template_key || 'GENERIC';

  const slotRows = all<{ id: string; key: string; label: string; file_suffix: string; is_required: number; guidance: string | null }>(
    `SELECT s.id, s.key, s.label, s.file_suffix, s.is_required, s.guidance
     FROM image_slot_definition s JOIN image_slot_template t ON t.id = s.template_id
     WHERE t.key = ? ORDER BY s.sort_order`,
    [templateKey],
  );

  const slots: BoardSlot[] = slotRows.map((slot) => ({
    id: slot.id,
    key: slot.key,
    label: slot.label,
    required: slot.is_required === 1,
    guidance: slot.guidance,
  }));

  const images = bundle.images.map((image) => {
    const publicUrl = resolvePublicUrl({
      storageBackend: image.storage_backend,
      storageKey: image.storage_key,
      driveFileId: image.drive_file_id,
      publicUrl: image.public_url,
      publicBaseUrl,
    });
    const preview =
      image.storage_backend === 'LOCAL'
        ? `/api/media/${image.storage_key.split('/').map(encodeURIComponent).join('/')}`
        : publicUrl;
    return {
      id: image.id,
      fileName: image.file_name,
      src: preview,
      altText: image.alt_text,
      slotId: image.slot_id,
      slotLabel: image.slot_label ?? null,
      isPrimary: image.is_primary === 1,
      folder: image.folder,
      reviewStatus: image.review_status,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      publicUrl,
    };
  });

  const boardImages: BoardImage[] = images.map(({ publicUrl: _publicUrl, ...rest }) => rest);

  const checklist = buildSlotChecklist(slotRows, bundle.images);
  const progress = photographyProgress(checklist);
  const missingPublic = images.filter((image) => !image.publicUrl);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card title="Image checklist">
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {checklist.map((item) => (
              <span key={item.slotId} className="flex items-center gap-1">
                <Badge tone={item.state === 'FILLED' ? 'success' : item.required ? 'danger' : 'neutral'}>
                  {item.state === 'FILLED' ? '✓' : '✕'} {item.label}
                </Badge>
              </span>
            ))}
          </div>
        </Card>

        <Card title="Photography completeness">
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-2xs uppercase tracking-wider text-ink-500">Required assets</span>
              <span className="text-sm font-semibold">
                {progress.complete} / {progress.required}
              </span>
            </div>
            <Meter value={progress.pct} />
            <p className="text-2xs text-ink-400">
              {progress.required - progress.complete === 0
                ? 'All required shots are present.'
                : `${progress.required - progress.complete} required shot(s) still missing.`}
            </p>
          </div>
        </Card>
      </div>

      {missingPublic.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>{missingPublic.length} image(s) have no public URL.</strong> Images cannot be imported into Shopify until
          publicly accessible URLs are available.{' '}
          {`Set “Public base URL” in Settings → Storage (current request host: ${publicBaseUrl || 'not detected'}).`}
        </div>
      )}

      <ImageBoard
        productId={product.id}
        images={boardImages}
        slots={slots}
        canUpload={userCan(user, 'image.upload')}
        canEdit={userCan(user, 'image.edit')}
        canApprove={userCan(user, 'image.approve')}
        canDelete={userCan(user, 'image.delete')}
      />

      <Card title="Storage">
        <div className="grid gap-2 px-4 py-3 text-xs sm:grid-cols-2">
          <div>
            <span className="text-2xs uppercase tracking-wider text-ink-500">Backend</span>
            <p>Local disk</p>
          </div>
          <div>
            <span className="text-2xs uppercase tracking-wider text-ink-500">Public base URL</span>
            <p className="mono">{publicBaseUrl || 'not detected'}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
