import 'server-only';
import { getStorage } from '@/lib/storage';

/**
 * Streams locally-stored images. Public URLs handed to Shopify are built from
 * PUBLIC_BASE_URL + this route, so a self-hosted deployment can serve its own
 * originals without exposing the filesystem layout.
 */
export function resolveLocalImage(key: string): { buffer: Promise<Buffer>; mimeType: string } | null {
  const storage = getStorage();
  if (storage.backend !== 'LOCAL') return null;
  const ext = key.split('.').pop()?.toLowerCase();
  const mime =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { buffer: storage.read({ storageKey: key }), mimeType: mime };
}
