import 'server-only';
import { getStorage } from '@/lib/storage';

/**
 * Streams images stored on local disk. Public URLs handed to Shopify are built
 * from the public base URL + this route, so the deployment serves its own
 * originals without exposing the filesystem layout.
 */
export function resolveLocalImage(key: string): { buffer: Promise<Buffer>; mimeType: string } | null {
  const storage = getStorage();
  const ext = key.split('.').pop()?.toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { buffer: storage.read({ storageKey: key }), mimeType: mime };
}
