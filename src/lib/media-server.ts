import 'server-only';
import { getStorageFor } from '@/lib/storage';

/**
 * Streams images stored on local disk. Public URLs handed to Shopify are built
 * from the public base URL + this route, so the deployment serves its own
 * originals without exposing the filesystem layout.
 *
 * Always uses the LOCAL adapter explicitly: rows uploaded before a switch to
 * cloud storage still live on disk and must keep serving even after
 * `currentBackend()` moves on.
 */
export function resolveLocalImage(key: string): { buffer: Promise<Buffer>; mimeType: string } | null {
  const storage = getStorageFor('LOCAL');
  const ext = key.split('.').pop()?.toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { buffer: storage.read({ storageKey: key }), mimeType: mime };
}
