'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { requirePermission } from '@/lib/auth';
import { all, get, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { logAudit } from '@/lib/audit';
import { getList, getNumber } from '@/lib/settings';
import { getProduct, recomputeProduct } from '@/lib/products';
import { canonicalFileName, validateImageBuffer, type ImageRules } from '@/lib/images';
import { inspectImage } from '@/lib/image-info';
import { getStorage, resolvePublicUrl } from '@/lib/storage';
import { publicBaseUrlForRequest } from '@/lib/public-url';
import type { ImageFolder } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function imageRules(): ImageRules {
  return {
    maxBytes: getNumber('images.max.bytes', 15 * 1024 * 1024),
    minBytes: getNumber('images.min.bytes', 20 * 1024),
    minWidth: getNumber('images.min.width', 1200),
    minHeight: getNumber('images.min.height', 1200),
    allowedTypes: getList('images.allowed.types'),
    recommendBytes: getNumber('images.recommend.bytes', 2 * 1024 * 1024),
  };
}

export async function uploadImagesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.upload');
    const publicBaseUrl = await publicBaseUrlForRequest();
    const productId = String(formData.get('product_id') ?? '');
    const slotId = String(formData.get('slot_id') ?? '') || null;
    const folder = (String(formData.get('folder') ?? 'ORIGINAL') || 'ORIGINAL').toUpperCase() as ImageFolder;
    const product = getProduct(productId);
    if (!product) return fail('Product not found.');

    const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (files.length === 0) return fail('Choose at least one image.');

    const slot = slotId
      ? get<{ key: string; file_suffix: string; label: string }>(
          'SELECT key, file_suffix, label FROM image_slot_definition WHERE id = ?',
          [slotId],
        )
      : null;

    const rules = imageRules();
    const storage = getStorage();
    const warnings: string[] = [];
    const saved: string[] = [];
    const stamp = nowIso();

    const existingChecksums = new Map(
      all<{ checksum: string; file_name: string }>(
        'SELECT checksum, file_name FROM product_image WHERE product_id = ? AND checksum IS NOT NULL',
        [productId],
      ).map((row) => [row.checksum as string, row.file_name]),
    );

    // Start after whatever already occupies this slot, so a second upload
    // request cannot generate a filename that overwrites an existing one.
    let index = slot
      ? get<{ n: number }>('SELECT COUNT(*) AS n FROM product_image WHERE product_id = ? AND slot_id = ?', [
          productId,
          slotId,
        ])?.n ?? 0
      : 0;
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const detectedType = file.type || 'application/octet-stream';
      const issues = validateImageBuffer(buffer, { mimeType: detectedType, originalName: file.name, rules });
      const blocking = issues.filter((issue) => issue.severity === 'ERROR');
      if (blocking.length > 0) {
        warnings.push(...blocking.map((issue) => issue.message));
        continue;
      }
      warnings.push(...issues.filter((i) => i.severity === 'WARNING').map((issue) => issue.message));

      const checksum = createHash('sha256').update(buffer).digest('hex');
      const duplicateName = existingChecksums.get(checksum);
      if (duplicateName) {
        warnings.push(`${file.name}: identical to ${duplicateName} already on this product — upload skipped.`);
        continue;
      }
      existingChecksums.set(checksum, file.name);

      const info = inspectImage(buffer);
      const fileName = canonicalFileName({
        sku: product.sku,
        slotSuffix: slot?.file_suffix ?? null,
        mimeType: detectedType,
        originalName: file.name,
        index,
      });

      const stored = await storage.put({
        data: buffer,
        fileName,
        mimeType: detectedType,
        folder,
        groupKey: product.sku,
        publicBaseUrl,
      });

      const publicUrl =
        stored.publicUrl ??
        resolvePublicUrl({
          storageBackend: stored.backend,
          storageKey: stored.storageKey,
          driveFileId: stored.driveFileId ?? null,
          publicUrl: stored.publicUrl,
          publicBaseUrl,
        });

      const maxSort = get<{ m: number }>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_image WHERE product_id = ?', [
        productId,
      ])?.m ?? 0;
      const imageCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM product_image WHERE product_id = ?', [productId])?.c ?? 0;

      const id = cuid();
      run(
        `INSERT INTO product_image
           (id, product_id, slot_id, file_name, storage_key, path, public_url, mime_type, bytes, width, height,
            folder, alt_text, sort_order, is_primary, review_status, storage_backend, drive_file_id, drive_folder_id,
            checksum, uploaded_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          productId,
          slotId,
          fileName,
          stored.storageKey,
          stored.path || stored.storageKey,
          publicUrl,
          detectedType,
          buffer.length,
          info.width,
          info.height,
          folder,
          null,
          maxSort + 1,
          imageCount === 0 ? 1 : 0,
          stored.backend,
          stored.driveFileId ?? null,
          stored.driveFolderId ?? null,
          checksum,
          user.id,
          stamp,
          stamp,
        ],
      );
      saved.push(fileName);
      index += 1;
    }

    if (saved.length > 0) {
      run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [user.id, stamp, productId]);
      logAudit({
        entityType: 'PRODUCT',
        entityId: productId,
        entityLabel: product.sku,
        action: 'IMAGE_UPLOAD',
        changes: [{ field: 'images', label: 'Images uploaded', oldValue: null, newValue: saved.join(', ') }],
        meta: { folder, slot: slot?.label ?? null, count: saved.length },
        userId: user.id,
      });
      recomputeProduct(productId, user.id);
    }

    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    revalidatePath('/dashboard');

    if (saved.length === 0) {
      return { ok: false, error: warnings.join(' ') || 'No images could be saved.' };
    }
    return {
      ok: true,
      message: `${saved.length} image${saved.length === 1 ? '' : 's'} uploaded to ${folder === 'FINAL' ? 'Final' : 'Original'}.`,
      warnings,
    };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function updateImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.edit');
    const imageId = String(formData.get('image_id') ?? '');
    const productId = String(formData.get('product_id') ?? '');
    const altText = formData.has('alt_text') ? String(formData.get('alt_text') ?? '') : null;
    const slotId = formData.has('slot_id') ? String(formData.get('slot_id') ?? '') || null : undefined;
    const folder = formData.has('folder') ? (String(formData.get('folder') ?? 'ORIGINAL').toUpperCase() as ImageFolder) : undefined;

    const sets: string[] = [];
    const params: unknown[] = [];
    if (altText !== null) { sets.push('alt_text = ?'); params.push(altText || null); }
    if (slotId !== undefined) { sets.push('slot_id = ?'); params.push(slotId); }
    if (folder !== undefined) { sets.push('folder = ?'); params.push(folder); }
    if (sets.length === 0) return { ok: true, message: 'Nothing to change.' };

    run(`UPDATE product_image SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, nowIso(), imageId]);
    run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [user.id, nowIso(), productId]);
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    return { ok: true, message: 'Image updated.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function reorderImagesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.edit');
    const productId = String(formData.get('product_id') ?? '');
    const order = String(formData.get('order') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    order.forEach((imageId, index) => {
      run('UPDATE product_image SET sort_order = ?, updated_at = ? WHERE id = ? AND product_id = ?', [
        index,
        nowIso(),
        imageId,
        productId,
      ]);
    });
    if (order.length > 0) {
      run('UPDATE product_image SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE product_id = ?', [
        order[0],
        productId,
      ]);
    }
    run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [user.id, nowIso(), productId]);
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: getProduct(productId)?.sku ?? productId,
      action: 'IMAGE_REORDER',
      changes: [{ field: 'images', label: 'Image order', oldValue: null, newValue: order.join(' → ') }],
      userId: user.id,
    });
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    return { ok: true, message: 'Order saved.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function setPrimaryImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.edit');
    const productId = String(formData.get('product_id') ?? '');
    const imageId = String(formData.get('image_id') ?? '');
    run('UPDATE product_image SET is_primary = 0 WHERE product_id = ?', [productId]);
    run('UPDATE product_image SET is_primary = 1, sort_order = 0, updated_at = ? WHERE id = ?', [nowIso(), imageId]);
    run('UPDATE product SET modified_by_id = ?, updated_at = ? WHERE id = ?', [user.id, nowIso(), productId]);
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: 'Primary image set.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

export async function reviewImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.approve');
    const productId = String(formData.get('product_id') ?? '');
    const imageId = String(formData.get('image_id') ?? '');
    const status = String(formData.get('review_status') ?? 'APPROVED');
    const stamp = nowIso();
    run('UPDATE product_image SET review_status = ?, reviewed_by_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?', [
      status,
      user.id,
      stamp,
      stamp,
      imageId,
    ]);
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    return { ok: true, message: status === 'APPROVED' ? 'Image approved.' : 'Image rejected.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

/**
 * Deleting the primary image would otherwise leave a product with no hero at
 * all, which silently blocks Shopify export. Hand the flag to the first
 * remaining image so there is always exactly one primary while images exist.
 */
function reassignPrimary(productId: string, deletedWasPrimary: boolean): void {
  if (!deletedWasPrimary) return;
  const next = get<{ id: string }>(
    'SELECT id FROM product_image WHERE product_id = ? ORDER BY sort_order, created_at LIMIT 1',
    [productId],
  );
  if (!next) return;
  run('UPDATE product_image SET is_primary = 0 WHERE product_id = ?', [productId]);
  run('UPDATE product_image SET is_primary = 1 WHERE id = ?', [next.id]);
}

export async function deleteImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.delete');
    const productId = String(formData.get('product_id') ?? '');
    const imageId = String(formData.get('image_id') ?? '');
    const image = get<{ file_name: string; storage_key: string; drive_file_id: string | null; is_primary: number }>(
      'SELECT file_name, storage_key, drive_file_id, is_primary FROM product_image WHERE id = ?',
      [imageId],
    );
    if (!image) return fail('Image not found.');
    const deleteRemote = String(formData.get('delete_remote') ?? '0') === '1';
    if (deleteRemote) {
      try {
        await getStorage().remove({ storageKey: image.storage_key, driveFileId: image.drive_file_id });
      } catch (error) {
        // Keep the record removal even if remote deletion fails, but surface it.
        run('DELETE FROM product_image WHERE id = ?', [imageId]);
        reassignPrimary(productId, image.is_primary === 1);
        recomputeProduct(productId, user.id);
        revalidatePath(`/products/${productId}`);
        return { ok: true, message: `Record removed, but the stored file could not be deleted: ${(error as Error).message}` };
      }
    }
    run('DELETE FROM product_image WHERE id = ?', [imageId]);
    reassignPrimary(productId, image.is_primary === 1);
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: getProduct(productId)?.sku ?? productId,
      action: 'IMAGE_DELETE',
      changes: [{ field: 'images', label: 'Image removed', oldValue: image.file_name, newValue: null }],
      userId: user.id,
    });
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    return { ok: true, message: 'Image removed.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** Promotes an asset from Original to Final (spec: two-folder workflow). */
export async function promoteImageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('image.edit');
    const publicBaseUrl = await publicBaseUrlForRequest();
    const productId = String(formData.get('product_id') ?? '');
    const imageId = String(formData.get('image_id') ?? '');
    const image = get<{ storage_key: string; path: string; file_name: string; mime_type: string; drive_file_id: string | null }>(
      'SELECT storage_key, path, file_name, mime_type, drive_file_id FROM product_image WHERE id = ?',
      [imageId],
    );
    if (!image) return fail('Image not found.');
    const product = getProduct(productId);
    if (!product) return fail('Product not found.');

    const storage = getStorage();
    const data = await storage.read({
      storageKey: image.storage_key,
      path: image.path || undefined,
      driveFileId: image.drive_file_id,
    });
    const stored = await storage.put({
      data,
      fileName: image.file_name,
      mimeType: image.mime_type,
      folder: 'FINAL',
      groupKey: product.sku,
      publicBaseUrl,
    });
    const publicUrl =
      stored.publicUrl ??
      resolvePublicUrl({
        storageBackend: stored.backend,
        storageKey: stored.storageKey,
        driveFileId: stored.driveFileId ?? null,
        publicUrl: stored.publicUrl,
        publicBaseUrl,
      });
    run(
      `UPDATE product_image SET folder = 'FINAL', storage_key = ?, path = ?, public_url = ?, drive_file_id = ?,
         drive_folder_id = ?, updated_at = ? WHERE id = ?`,
      [stored.storageKey, stored.path || stored.storageKey, publicUrl, stored.driveFileId ?? null, stored.driveFolderId ?? null, nowIso(), imageId],
    );
    logAudit({
      entityType: 'PRODUCT',
      entityId: productId,
      entityLabel: product.sku,
      action: 'IMAGE_PROMOTED',
      changes: [{ field: 'folder', label: 'Image folder', oldValue: 'ORIGINAL', newValue: 'FINAL' }],
      userId: user.id,
    });
    recomputeProduct(productId, user.id);
    revalidatePath(`/products/${productId}`);
    revalidatePath('/photography');
    return { ok: true, message: 'Moved to Final.' };
  } catch (error) {
    return fail((error as Error).message);
  }
}
