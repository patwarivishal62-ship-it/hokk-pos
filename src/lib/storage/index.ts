import 'server-only';
import { LocalStorage } from './local';
import { defaultUploadDir, hostingPublicBaseUrl } from '@/lib/hosting';
import type {
  StorageBackend,
  PutInput,
  PutResult,
  ReadInput,
  RemoveInput,
  StorageStatus,
} from './types';

export { LocalStorage };
export type { StorageBackend, PutInput, PutResult, ReadInput, RemoveInput, StorageStatus };

function readSetting(key: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSetting } = require('@/lib/settings') as typeof import('@/lib/settings');
    const val = getSetting(key);
    return typeof val === 'string' ? val : '';
  } catch {
    return '';
  }
}

export function buildLocalConfig(): { uploadDir: string } {
  // Defaults are host-aware: on Render uploads land on the persistent disk
  // (/var/data/storage/uploads) instead of the ephemeral container filesystem.
  // See src/lib/hosting.ts.
  const dir =
    process.env.UPLOAD_DIR?.trim() || readSetting('storage.upload_dir') || defaultUploadDir();
  return { uploadDir: dir };
}

// Single cached instance — the upload dir is fixed per deployment, but tests
// may point it elsewhere between cases, so the cache key includes the dir.
let cached: { uploadDir: string; instance: LocalStorage } | null = null;

/**
 * The storage adapter. Local disk is the only backend: uploads go to
 * `UPLOAD_DIR` (`/var/data/storage/uploads` on Render's persistent disk) and
 * are served publicly via `/api/media/<key>`. Any legacy `STORAGE_BACKEND`
 * value left in the environment (GDRIVE / S3 trials) is deliberately ignored
 * so a stale variable can never break uploads again.
 */
export function getStorage(): LocalStorage {
  const { uploadDir } = buildLocalConfig();
  if (cached && cached.uploadDir === uploadDir) return cached.instance;
  const instance = new LocalStorage({ uploadDir });
  cached = { uploadDir, instance };
  return instance;
}

/**
 * Resolves the publicly reachable URL for an image.
 *
 * - Rows that already carry a `publicUrl` keep it (this also preserves links
 *   written by earlier Drive/S3 trials).
 * - Otherwise the URL is built from the public base URL: an explicit setting,
 *   the current request host supplied by the caller, or hosting metadata.
 *   `/api/media/<key>` is appended to that base.
 * - Empty string when no base is configured — the caller treats the image as
 *   "not publicly accessible" and warns instead of exporting a dead link.
 */
export function resolvePublicUrl(opts: {
  storageBackend: string;
  storageKey: string;
  driveFileId: string | null;
  publicUrl?: string | null;
  /** Current request origin, used when no URL was stored with the image. */
  publicBaseUrl?: string;
}): string {
  void opts.storageBackend;
  void opts.driveFileId;
  if (opts.publicUrl && opts.publicUrl.trim() !== '') return opts.publicUrl;
  const base = (
    readSetting('storage.public_base_url') ||
    hostingPublicBaseUrl(opts.publicBaseUrl?.trim())
  ).replace(/\/$/, '');
  if (!base) return '';
  const encoded = opts.storageKey.split('/').map(encodeURIComponent).join('/');
  return `${base}/api/media/${encoded}`;
}

// For testing: allow clearing cache
export const _internal = {
  clearCache() {
    cached = null;
  },
};
