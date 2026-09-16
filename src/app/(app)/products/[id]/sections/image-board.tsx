'use client';

import { useActionState, useState, type DragEvent } from 'react';
import {
  deleteImageAction,
  promoteImageAction,
  reorderImagesAction,
  reviewImageAction,
  setPrimaryImageAction,
  updateImageAction,
  uploadImagesAction,
} from '@/app/actions/media';
import { ActionForm, type FormResult } from '@/components/action-form';
import { Badge } from '@/components/ui';
import { formatBytes } from '@/lib/images';

export interface BoardImage {
  id: string;
  fileName: string;
  src: string | null;
  altText: string | null;
  slotId: string | null;
  slotLabel: string | null;
  isPrimary: boolean;
  folder: 'ORIGINAL' | 'FINAL';
  reviewStatus: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface BoardSlot {
  id: string;
  key: string;
  label: string;
  required: boolean;
  guidance: string | null;
}

export function ImageBoard({
  productId,
  images,
  slots,
  canUpload,
  canEdit,
  canApprove,
  canDelete,
}: {
  productId: string;
  images: BoardImage[];
  slots: BoardSlot[];
  canUpload: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}) {
  const [order, setOrder] = useState<string[]>(images.map((image) => image.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [reorderState, reorderAction, reorderPending] = useActionState(reorderImagesAction, null);
  const [uploadStates, setUploadStates] = useState<Record<string, FormResult | null>>({});
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

  const dirty = order.join(',') !== images.map((image) => image.id).join(',');

  const move = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setOrder((prev) => {
      const next = prev.filter((id) => id !== dragId);
      const index = next.indexOf(targetId);
      next.splice(index === -1 ? next.length : index, 0, dragId);
      return next;
    });
  };

  const ordered = order
    .map((id) => images.find((image) => image.id === id))
    .filter((image): image is BoardImage => Boolean(image));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-ink-200 bg-white px-3 py-2 text-xs text-ink-500">
        <p>
          Assets are uploaded to <strong>local storage</strong> and filed into{' '}
          <strong>Original</strong> (raw photographs) or <strong>Final</strong> (approved, export-ready). Shopify only receives
          images with a publicly reachable URL.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {slots.map((slot) => {
          const slotImages = ordered.filter((image) => image.slotId === slot.id);
          return (
            <section
              key={slot.id}
              className={`card flex flex-col ${dragOverSlot === slot.id ? 'ring-2 ring-brand' : ''}`}
              onDragOver={(event: DragEvent) => {
                if (event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  setDragOverSlot(slot.id);
                }
              }}
              onDragLeave={() => setDragOverSlot(null)}
              onDrop={() => setDragOverSlot(null)}
            >
              <header className="card-head">
                <h2 className="card-title">{slot.label}</h2>
                <Badge tone={slot.required ? (slotImages.length > 0 ? 'success' : 'danger') : slotImages.length > 0 ? 'success' : 'neutral'}>
                  {slot.required ? (slotImages.length > 0 ? 'Present' : 'Required') : slotImages.length > 0 ? 'Present' : 'Optional'}
                </Badge>
              </header>

              <div className="flex flex-1 flex-col gap-2 p-3">
                {slotImages.map((image) => (
                  <ImageCard
                    key={image.id}
                    image={image}
                    productId={productId}
                    slots={slots}
                    canEdit={canEdit}
                    canApprove={canApprove}
                    canDelete={canDelete}
                    onDragStart={() => setDragId(image.id)}
                    onDragEnter={() => move(image.id)}
                  />
                ))}

                {canUpload && (
                  <form
                    action={async (formData: FormData) => {
                      const result = await uploadImagesAction(null, formData);
                      setUploadStates((prev) => ({ ...prev, [slot.id]: result }));
                    }}
                    className={`dropzone ${dragOverSlot === slot.id ? 'dropzone-active' : ''}`}
                  >
                    <input type="hidden" name="product_id" value={productId} />
                    <input type="hidden" name="slot_id" value={slot.id} />
                    <input
                      type="file"
                      name="files"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="text-2xs file:mr-2 file:rounded file:border file:border-ink-300 file:bg-white file:px-2 file:py-1"
                    />
                    <select className="field field-sm mt-1" name="folder" defaultValue="ORIGINAL">
                      <option value="ORIGINAL">Original (raw)</option>
                      <option value="FINAL">Final (approved)</option>
                    </select>
                    <button className="btn btn-sm mt-1" type="submit">
                      Upload
                    </button>
                    {uploadStates[slot.id] && (
                      <p className={`text-2xs ${uploadStates[slot.id]!.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                        {uploadStates[slot.id]!.ok ? uploadStates[slot.id]!.message : uploadStates[slot.id]!.error}
                      </p>
                    )}
                    {slot.guidance && <p className="text-2xs text-ink-400">{slot.guidance}</p>}
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="card">
        <header className="card-head">
          <h2 className="card-title">Image order ({ordered.length})</h2>
          <div className="flex items-center gap-2">
            {dirty && <span className="text-2xs text-amber-700">Unsaved order</span>}
            <form action={reorderAction} className="flex items-center gap-2">
              <input type="hidden" name="product_id" value={productId} />
              <input type="hidden" name="order" value={order.join(',')} />
              <button className="btn btn-sm btn-primary" type="submit" disabled={!dirty || reorderPending}>
                {reorderPending ? 'Saving…' : 'Save order'}
              </button>
            </form>
          </div>
        </header>
        {reorderState && (
          <p className={`border-b px-3 py-1.5 text-xs ${reorderState.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {reorderState.ok ? reorderState.message : reorderState.error}
          </p>
        )}
        <p className="border-b border-ink-100 px-3 py-1.5 text-2xs text-ink-400">
          Drag to reorder. The first image becomes the primary / hero image and Shopify position 1.
        </p>
        <ul className="flex flex-col divide-y divide-ink-100">
          {ordered.map((image, index) => (
            <li
              key={image.id}
              draggable={canEdit}
              onDragStart={() => setDragId(image.id)}
              onDragEnter={() => move(image.id)}
              onDragEnd={() => setDragId(null)}
              className={`flex items-center gap-3 px-3 py-2 ${dragId === image.id ? 'opacity-50' : ''}`}
            >
              <span className="w-6 text-right text-xs text-ink-400">{index + 1}</span>
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded bg-ink-100">
                {image.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.src} alt={image.altText ?? image.fileName} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-2xs text-ink-300">n/a</span>
                )}
              </span>
              <span className="mono min-w-0 flex-1 truncate text-xs">{image.fileName}</span>
              <Badge tone={image.folder === 'FINAL' ? 'success' : 'neutral'}>{image.folder.toLowerCase()}</Badge>
              <Badge tone={image.reviewStatus === 'APPROVED' ? 'success' : image.reviewStatus === 'REJECTED' ? 'danger' : 'warn'}>
                {image.reviewStatus.toLowerCase()}
              </Badge>
              {image.isPrimary && <Badge tone="info">Primary</Badge>}
              <span className="text-2xs text-ink-400">{formatBytes(image.bytes)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ImageCard({
  image,
  productId,
  slots,
  canEdit,
  canApprove,
  canDelete,
  onDragStart,
  onDragEnter,
}: {
  image: BoardImage;
  productId: string;
  slots: BoardSlot[];
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded border border-ink-200 p-2"
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
    >
      <div className="flex gap-2">
        <span className="h-16 w-16 shrink-0 overflow-hidden rounded bg-ink-100">
          {image.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.src} alt={image.altText ?? image.fileName} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xs text-ink-300">no URL</span>
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="mono truncate text-2xs">{image.fileName}</span>
          <span className="text-2xs text-ink-400">
            {image.width && image.height ? `${image.width}×${image.height} · ` : ''}
            {formatBytes(image.bytes)}
          </span>
          <span className="text-2xs text-ink-400">{image.slotLabel ?? 'Unassigned'}</span>
        </div>
      </div>

      {canEdit && (
        <ActionForm action={updateImageAction} className="flex flex-col gap-1">
          <input type="hidden" name="image_id" value={image.id} />
          <input type="hidden" name="product_id" value={productId} />
          <input className="field field-sm" name="alt_text" defaultValue={image.altText ?? ''} placeholder="Alt text" />
          <div className="flex gap-1">
            <select className="field field-sm flex-1" name="slot_id" defaultValue={image.slotId ?? ''}>
              <option value="">No slot</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
            </select>
            <select className="field field-sm w-24" name="folder" defaultValue={image.folder}>
              <option value="ORIGINAL">Original</option>
              <option value="FINAL">Final</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-1">
            <button className="btn btn-sm" type="submit">
              Save
            </button>
          </div>
        </ActionForm>
      )}

      <div className="flex flex-wrap gap-1">
        {!image.isPrimary && canEdit && (
          <ActionForm action={setPrimaryImageAction}>
            <input type="hidden" name="image_id" value={image.id} />
            <input type="hidden" name="product_id" value={productId} />
            <button className="btn btn-sm" type="submit">
              Make primary
            </button>
          </ActionForm>
        )}
        {canApprove && image.reviewStatus !== 'APPROVED' && (
          <ActionForm action={reviewImageAction}>
            <input type="hidden" name="image_id" value={image.id} />
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="review_status" value="APPROVED" />
            <button className="btn btn-sm" type="submit">
              Approve
            </button>
          </ActionForm>
        )}
        {canApprove && image.reviewStatus !== 'REJECTED' && (
          <ActionForm action={reviewImageAction}>
            <input type="hidden" name="image_id" value={image.id} />
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="review_status" value="REJECTED" />
            <button className="btn btn-sm" type="submit">
              Reject
            </button>
          </ActionForm>
        )}
        {canEdit && image.folder === 'ORIGINAL' && (
          <ActionForm action={promoteImageAction}>
            <input type="hidden" name="image_id" value={image.id} />
            <input type="hidden" name="product_id" value={productId} />
            <button className="btn btn-sm" type="submit">
              Move to Final
            </button>
          </ActionForm>
        )}
        {canDelete && (
          <ActionForm action={deleteImageAction}>
            <input type="hidden" name="image_id" value={image.id} />
            <input type="hidden" name="product_id" value={productId} />
            <input type="hidden" name="delete_remote" value="1" />
            <button className="btn btn-sm btn-danger" type="submit">
              Delete
            </button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
