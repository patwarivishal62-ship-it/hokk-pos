/**
 * Media actions (spec §11–13): enforced slot templates, canonical filenames,
 * Original/Final folders, duplicate rejection by checksum, drag-drop ordering
 * with the first image preserved as primary, and per-image approval.
 *
 * Runs the real actions against a real SQLite file and the real local storage
 * adapter; only the request-scoped Next.js APIs and auth are stubbed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeJpeg, fakePng } from './helpers/fake-images';
import { cuid } from '@/lib/id';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-media-'));
const uploadDir = path.join(tmpDir, 'uploads');
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';
process.env.STORAGE_BACKEND = 'LOCAL';
process.env.UPLOAD_DIR = uploadDir;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const authState = vi.hoisted(() => ({ permissions: ['*'] as string[], id: '' }));

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ id: authState.id, permissions: authState.permissions }),
  requirePermission: async (permission: string) => {
    const allowed = authState.permissions.includes('*') || authState.permissions.includes(permission);
    if (!allowed) throw new Error(`You do not have permission to ${permission}.`);
    return { id: authState.id, permissions: authState.permissions };
  },
  userCan: () => true,
}));

const { all, get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const { createProduct } = await import('@/lib/products');
const {
  uploadImagesAction,
  updateImageAction,
  reorderImagesAction,
  setPrimaryImageAction,
  reviewImageAction,
  deleteImageAction,
  promoteImageAction,
} = await import('@/app/actions/media');

ensureSchema();
seedSystemDefaults();
const adminId = createSuperAdmin({ name: 'Media Admin', email: 'media@test.local', password: 'test-password-123' }).id;
authState.id = adminId;

const categoryId = cuid();
run(
  `INSERT INTO category (id, name, slug, sku_segment, template_key, sort_order, created_at, updated_at)
   VALUES (?, 'Sarees', 'sarees', 'SAR', 'SAREE', 1, datetime('now'), datetime('now'))`,
  [categoryId],
);

function heroSlotId(): string {
  return get<{ id: string }>(
    `SELECT s.id FROM image_slot_definition s JOIN image_slot_template t ON t.id = s.template_id
     WHERE t.key = 'SAREE' AND s.key = 'HERO'`,
  )!.id;
}

function newProduct(): string {
  return createProduct({ name: `Media Test ${cuid()}`, categoryId }, adminId).id;
}

/** Form with only metadata fields — no file part. */
function plainForm(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function formWith(files: Array<{ name: string; type: string; bytes: Buffer }>, extra: Record<string, string> = {}): FormData {
  const data = plainForm(extra);
  for (const file of files) data.append('files', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  return data;
}

function imagesFor(productId: string) {
  return all<{ id: string; file_name: string; folder: string; is_primary: number; sort_order: number; review_status: string; alt_text: string | null; slot_id: string | null }>(
    'SELECT id, file_name, folder, is_primary, sort_order, review_status, alt_text, slot_id FROM product_image WHERE product_id = ? ORDER BY sort_order',
    [productId],
  );
}

beforeEach(() => {
  authState.permissions = ['*'];
});

describe('uploadImagesAction', () => {
  it('stores the file, assigns the slot and names it from the SKU', async () => {
    const productId = newProduct();
    const sku = get<{ sku: string }>('SELECT sku FROM product WHERE id = ?', [productId])!.sku;

    const result = await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, slot_id: heroSlotId(), folder: 'ORIGINAL' },
    ));
    expect(result.ok).toBe(true);

    const images = imagesFor(productId);
    expect(images).toHaveLength(1);
    // Canonical name is SKU + slot suffix, never the display name.
    expect(images[0].file_name).toBe(`${sku}-HERO.jpg`);
    expect(images[0].folder).toBe('ORIGINAL');
    expect(images[0].slot_id).toBe(heroSlotId());
    // The first image becomes primary automatically.
    expect(images[0].is_primary).toBe(1);
    expect(fs.existsSync(path.join(uploadDir, 'original', sku, `${sku}-HERO.jpg`))).toBe(true);
  });

  it('rejects a disallowed file type instead of storing it', async () => {
    const productId = newProduct();
    const result = await uploadImagesAction(null, formWith(
      [{ name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('not an image at all') }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    expect(imagesFor(productId)).toHaveLength(0);
    expect(result.ok).toBe(false);
    // When nothing could be saved the reasons are folded into `error`.
    expect(result.error).toMatch(/allowed|unsupported|not an image/i);
  });

  it('skips a byte-identical duplicate of an image already on the product', async () => {
    const productId = newProduct();
    const bytes = fakePng(2000, 2400);
    await uploadImagesAction(null, formWith(
      [{ name: 'first.png', type: 'image/png', bytes }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const second = await uploadImagesAction(null, formWith(
      [{ name: 'same-again.png', type: 'image/png', bytes }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    expect(imagesFor(productId)).toHaveLength(1);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/identical to|skipped/i);
  });

  it('increments the suffix when several images share one slot', async () => {
    const productId = newProduct();
    const sku = get<{ sku: string }>('SELECT sku FROM product WHERE id = ?', [productId])!.sku;
    // Distinct byte payloads so the checksum de-dupe does not skip them.
    await uploadImagesAction(null, formWith(
      [
        { name: 'a.png', type: 'image/png', bytes: fakePng(2000, 2400) },
        { name: 'b.png', type: 'image/png', bytes: fakePng(2001, 2401) },
      ],
      { product_id: productId, slot_id: heroSlotId(), folder: 'ORIGINAL' },
    ));
    const names = imagesFor(productId).map((image) => image.file_name);
    expect(names).toContain(`${sku}-HERO.png`);
    expect(names).toContain(`${sku}-HERO-2.png`);
  });

  it('refuses to upload without the image.upload permission', async () => {
    const productId = newProduct();
    authState.permissions = ['product.view'];
    const result = await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(imagesFor(productId)).toHaveLength(0);
  });
});

describe('updateImageAction', () => {
  it('saves alt text, slot and folder', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const imageId = imagesFor(productId)[0].id;
    const slotId = heroSlotId();

    const result = await updateImageAction(null, plainForm({
      image_id: imageId,
      product_id: productId,
      alt_text: 'Maroon zari border detail',
      slot_id: slotId,
      folder: 'FINAL',
    }));
    expect(result.ok).toBe(true);

    const row = get<{ alt_text: string; slot_id: string; folder: string }>(
      'SELECT alt_text, slot_id, folder FROM product_image WHERE id = ?',
      [imageId],
    )!;
    expect(row.alt_text).toBe('Maroon zari border detail');
    expect(row.slot_id).toBe(slotId);
    expect(row.folder).toBe('FINAL');
  });
});

describe('reorderImagesAction', () => {
  it('applies the new order and makes the first image primary', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [
        { name: 'a.png', type: 'image/png', bytes: fakePng(2000, 2400) },
        { name: 'b.png', type: 'image/png', bytes: fakePng(2001, 2401) },
        { name: 'c.png', type: 'image/png', bytes: fakePng(2002, 2402) },
      ],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const before = imagesFor(productId);
    expect(before).toHaveLength(3);
    expect(before[0].is_primary).toBe(1);

    // Reverse the order: the last image should become primary.
    const reversed = [...before].reverse().map((image) => image.id);
    const result = await reorderImagesAction(null, plainForm({
      product_id: productId,
      order: reversed.join(','),
    }));
    expect(result.ok).toBe(true);

    const after = imagesFor(productId);
    expect(after.map((image) => image.id)).toEqual(reversed);
    expect(after[0].is_primary).toBe(1);
    expect(after[1].is_primary).toBe(0);
    expect(after[2].is_primary).toBe(0);
    // Sort order must be contiguous so Shopify positions come out 1..n.
    expect(after.map((image) => image.sort_order)).toEqual([0, 1, 2]);
  });
});

describe('setPrimaryImageAction', () => {
  it('moves the primary flag to the chosen image', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [
        { name: 'a.png', type: 'image/png', bytes: fakePng(2000, 2400) },
        { name: 'b.png', type: 'image/png', bytes: fakePng(2001, 2401) },
      ],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const [first, second] = imagesFor(productId);
    const result = await setPrimaryImageAction(null, plainForm({ image_id: second.id, product_id: productId }));
    expect(result.ok).toBe(true);

    const after = imagesFor(productId);
    expect(after.find((image) => image.id === second.id)!.is_primary).toBe(1);
    expect(after.find((image) => image.id === first.id)!.is_primary).toBe(0);
    // Exactly one primary at all times.
    expect(after.filter((image) => image.is_primary === 1)).toHaveLength(1);
  });
});

describe('reviewImageAction', () => {
  it('records an approval with reviewer and timestamp', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const imageId = imagesFor(productId)[0].id;
    const result = await reviewImageAction(null, plainForm({
      image_id: imageId,
      product_id: productId,
      review_status: 'APPROVED',
    }));
    expect(result.ok).toBe(true);

    const row = get<{ review_status: string; reviewed_by_id: string | null; reviewed_at: string | null }>(
      'SELECT review_status, reviewed_by_id, reviewed_at FROM product_image WHERE id = ?',
      [imageId],
    )!;
    expect(row.review_status).toBe('APPROVED');
    expect(row.reviewed_by_id).toBe(adminId);
    expect(row.reviewed_at).toBeTruthy();
  });
});

describe('promoteImageAction', () => {
  it('copies an Original asset into the Final folder', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const image = imagesFor(productId)[0];
    expect(image.folder).toBe('ORIGINAL');

    const result = await promoteImageAction(null, plainForm({ image_id: image.id, product_id: productId }));
    expect(result.ok).toBe(true);

    const after = get<{ folder: string; storage_key: string; path: string }>(
      'SELECT folder, storage_key, path FROM product_image WHERE id = ?',
      [image.id],
    )!;
    expect(after.folder).toBe('FINAL');
    expect(after.storage_key).toContain('final');
    expect(fs.existsSync(after.path)).toBe(true);
  });
});

describe('deleteImageAction', () => {
  it('removes the row and the file from disk', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: fakeJpeg() }],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const image = imagesFor(productId)[0];
    const pathOnDisk = get<{ path: string }>('SELECT path FROM product_image WHERE id = ?', [image.id])!.path;
    expect(fs.existsSync(pathOnDisk)).toBe(true);

    const result = await deleteImageAction(null, plainForm({
      image_id: image.id,
      product_id: productId,
      delete_remote: '1',
    }));
    expect(result.ok).toBe(true);
    expect(imagesFor(productId)).toHaveLength(0);
    expect(fs.existsSync(pathOnDisk)).toBe(false);
  });

  it('promotes another image to primary when the primary is deleted', async () => {
    const productId = newProduct();
    await uploadImagesAction(null, formWith(
      [
        { name: 'a.png', type: 'image/png', bytes: fakePng(2000, 2400) },
        { name: 'b.png', type: 'image/png', bytes: fakePng(2001, 2401) },
      ],
      { product_id: productId, folder: 'ORIGINAL' },
    ));
    const [first, second] = imagesFor(productId);
    expect(first.is_primary).toBe(1);

    await deleteImageAction(null, plainForm({ image_id: first.id, product_id: productId, delete_remote: '1' }));

    const remaining = imagesFor(productId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(second.id);
    expect(remaining[0].is_primary).toBe(1);
  });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
