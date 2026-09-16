'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth';
import { all, run } from '@/lib/db';
import { nowIso } from '@/lib/id';
import { logAudit } from '@/lib/audit';
import { CloudinaryStorage, getStorageFor } from '@/lib/storage';
import type { ImageFolder } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** A real 1×1 transparent PNG (~70 bytes) — Cloudinary validates image uploads. */
const HEALTHCHECK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** How many rows one migration run moves (server actions have time limits). */
const MIGRATE_BATCH_SIZE = 100;

/**
 * Proves the Cloudinary credentials work end to end: uploads a tiny image,
 * reads it back over the public delivery URL, then deletes it. Nothing is
 * left behind.
 */
export async function testCloudStorageAction(): Promise<ActionResult> {
  try {
    const user = await requirePermission('settings.manage');
    const storage = new CloudinaryStorage();
    const status = await storage.status();
    if (!status.configured) {
      return {
        ok: false,
        error: `Cloudinary is not configured. ${status.problems.join(' ')} See CLOUD_STORAGE.md.`,
      };
    }
    const png = Buffer.from(HEALTHCHECK_PNG_BASE64, 'base64');
    const stored = await storage.put({
      data: png,
      fileName: `hokk-connection-test-${Date.now()}.png`,
      mimeType: 'image/png',
      folder: 'ORIGINAL',
      groupKey: '_healthcheck',
      publicBaseUrl: '',
    });
    const back = await storage.read({ storageKey: stored.storageKey });
    await storage.remove({ storageKey: stored.storageKey });
    logAudit({
      entityType: 'SETTING',
      entityId: 'storage.backend',
      entityLabel: 'Cloud storage',
      action: 'TEST',
      changes: [
        { field: 'cloudinary', label: 'Connection test', oldValue: null, newValue: `OK (${back.length} bytes round-tripped)` },
      ],
      userId: user.id,
    });
    return {
      ok: true,
      message: `Cloudinary is working — uploaded, read back (${back.length} bytes) and deleted a test image. New uploads are viewable online the moment they finish.`,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

interface LocalRow {
  id: string;
  file_name: string;
  storage_key: string;
  path: string;
  mime_type: string;
  folder: ImageFolder;
  sku: string;
}

/**
 * Moves LOCAL rows to Cloudinary in batches. Each row is read from disk,
 * uploaded to the same folder/SKU layout fresh uploads use, then repointed.
 * Local files are deliberately kept as a backup — delete them from
 * `storage/uploads` only after verifying the cloud copies.
 */
export async function migrateImagesToCloudAction(): Promise<ActionResult> {
  try {
    const user = await requirePermission('settings.manage');
    const cloud = new CloudinaryStorage();
    const status = await cloud.status();
    if (!status.configured) {
      return {
        ok: false,
        error: `Cloudinary is not configured. ${status.problems.join(' ')} See CLOUD_STORAGE.md.`,
      };
    }
    const remaining =
      all<{ c: number }>(`SELECT COUNT(*) AS c FROM product_image WHERE storage_backend = 'LOCAL'`)[0]?.c ?? 0;
    if (remaining === 0) {
      return { ok: true, message: 'Nothing to migrate — every image is already in cloud storage.' };
    }
    const rows = all<LocalRow>(
      `SELECT i.id, i.file_name, i.storage_key, i.path, i.mime_type, i.folder, p.sku
       FROM product_image i JOIN product p ON p.id = i.product_id
       WHERE i.storage_backend = 'LOCAL'
       ORDER BY i.created_at
       LIMIT ?`,
      [MIGRATE_BATCH_SIZE],
    );
    const local = getStorageFor('LOCAL');
    let moved = 0;
    const failures: string[] = [];
    const stamp = nowIso();
    for (const row of rows) {
      try {
        const data = await local.read({ storageKey: row.storage_key, path: row.path });
        const stored = await cloud.put({
          data,
          fileName: row.file_name,
          mimeType: row.mime_type,
          folder: row.folder,
          groupKey: row.sku,
          publicBaseUrl: '',
        });
        run(
          `UPDATE product_image
           SET storage_key = ?, path = ?, public_url = ?, storage_backend = 'CLOUDINARY',
               drive_file_id = NULL, drive_folder_id = NULL, updated_at = ?
           WHERE id = ?`,
          [stored.storageKey, stored.path || stored.publicUrl || stored.storageKey, stored.publicUrl ?? null, stamp, row.id],
        );
        moved += 1;
      } catch (error) {
        failures.push(`${row.file_name}: ${(error as Error).message}`);
      }
    }

    logAudit({
      entityType: 'SETTING',
      entityId: 'storage.backend',
      entityLabel: 'Cloud storage',
      action: 'MIGRATE',
      changes: [
        { field: 'images', label: 'Images moved to Cloudinary', oldValue: null, newValue: `${moved} moved, ${failures.length} failed` },
      ],
      userId: user.id,
    });
    revalidatePath('/settings');
    revalidatePath('/photography');
    revalidatePath('/dashboard');

    const left = remaining - moved;
    const parts = [`Moved ${moved} of ${remaining} local image(s) to Cloudinary.`];
    if (left > 0 && failures.length === 0) {
      parts.push(`${left} remaining — run the migration again to continue.`);
    }
    if (failures.length > 0) {
      parts.push(`${failures.length} failed (usually a missing local file on this device): ${failures.slice(0, 3).join(' · ')}${failures.length > 3 ? ' …' : ''}`);
    }
    parts.push('Local files were kept as backup.');
    return { ok: moved > 0, message: parts.join(' '), error: moved > 0 ? undefined : parts.join(' ') };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
