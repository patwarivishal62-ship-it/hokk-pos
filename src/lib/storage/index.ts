import 'server-only';
import { LocalStorage } from './local';
import {
  CloudinaryStorage,
  cloudinaryConfig,
  cloudinaryDeliveryUrl,
  isCloudPublicId,
  isCloudinaryConfigured,
  missingCloudinaryVars,
  signCloudinaryParams,
} from './cloudinary';
import { defaultUploadDir, hostingPublicBaseUrl } from '@/lib/hosting';
import { getSetting } from '@/lib/settings';
import type {
  StorageBackend,
  PutInput,
  PutResult,
  ReadInput,
  RemoveInput,
  StorageStatus,
} from './types';

export { LocalStorage, CloudinaryStorage };
export {
  cloudinaryConfig,
  cloudinaryDeliveryUrl,
  isCloudPublicId,
  isCloudinaryConfigured,
  missingCloudinaryVars,
  signCloudinaryParams,
};
export type { StorageBackend, PutInput, PutResult, ReadInput, RemoveInput, StorageStatus };

export type StorageAdapter = LocalStorage | CloudinaryStorage;

function readSetting(key: string): string {
  try {
    const val = getSetting(key);
    return typeof val === 'string' ? val : '';
  } catch {
    // Settings may not be readable yet (e.g. before `db:init` creates the
    // table) — callers treat blank as "not configured".
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

function normalizeBackend(raw: string | null | undefined): StorageBackend | null {
  const value = (raw || '').trim().toUpperCase();
  if (value === 'LOCAL' || value === 'CLOUDINARY') return value;
  return null;
}

/**
 * Where new uploads go. `STORAGE_BACKEND` in the environment wins when set
 * (deployments pin infrastructure in env); otherwise the `storage.backend`
 * setting from Settings → Storage applies. Unknown/legacy values
 * (GDRIVE / S3 trials) safely fall back to LOCAL.
 */
export function currentBackend(): StorageBackend {
  return (
    normalizeBackend(process.env.STORAGE_BACKEND) ??
    normalizeBackend(readSetting('storage.backend')) ??
    'LOCAL'
  );
}

/** Whether the active backend is pinned by env or controlled from Settings. */
export function storageBackendControlledBy(): 'env' | 'settings' {
  return normalizeBackend(process.env.STORAGE_BACKEND) ? 'env' : 'settings';
}

// Single cached instance — the upload dir is fixed per deployment, but tests
// may point it elsewhere between cases, so the cache key includes the dir.
let cached: { key: string; instance: StorageAdapter } | null = null;

/** Adapter for an explicit backend — used for per-row reads/deletes so old
 * LOCAL rows keep working after the deployment switches to the cloud. */
export function getStorageFor(backend: StorageBackend): StorageAdapter {
  if (backend === 'CLOUDINARY') {
    const key = `cloudinary:${cloudinaryConfig().cloudName}`;
    if (cached && cached.key === key) return cached.instance;
    const instance = new CloudinaryStorage();
    cached = { key, instance };
    return instance;
  }
  const { uploadDir } = buildLocalConfig();
  const key = `local:${uploadDir}`;
  if (cached && cached.key === key) return cached.instance;
  const instance = new LocalStorage({ uploadDir });
  cached = { key, instance };
  return instance;
}

/** The storage adapter for new uploads. */
export function getStorage(): StorageAdapter {
  return getStorageFor(currentBackend());
}

/** Lenient parse of the `storage_backend` column (legacy rows vary). */
export function backendFromRow(value: string | null | undefined): StorageBackend {
  return normalizeBackend(value) ?? 'LOCAL';
}

export interface StorageOverview {
  backend: StorageBackend;
  controlledBy: 'env' | 'settings';
  localUploadDir: string;
  cloudName: string;
  cloudConfigured: boolean;
  cloudFolderPrefix: string;
  cloudProblems: string[];
}

/** Everything Settings → Storage needs to render, without secrets. */
export function describeStorage(): StorageOverview {
  const cfg = cloudinaryConfig();
  const missing = missingCloudinaryVars();
  return {
    backend: currentBackend(),
    controlledBy: storageBackendControlledBy(),
    localUploadDir: buildLocalConfig().uploadDir,
    cloudName: cfg.cloudName,
    cloudConfigured: isCloudinaryConfigured(),
    cloudFolderPrefix: cfg.folderPrefix,
    cloudProblems:
      missing.length === 0 ? [] : [`Missing environment variables: ${missing.join(', ')}.`],
  };
}

/**
 * Resolves the publicly reachable URL for an image.
 *
 * - Rows that already carry a `publicUrl` keep it (this also preserves links
 *   written by earlier Drive/S3 trials).
 * - CLOUDINARY rows without one are rebuilt from the cloud name + public id.
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
  void opts.driveFileId;
  if (opts.publicUrl && opts.publicUrl.trim() !== '') return opts.publicUrl;
  if (normalizeBackend(opts.storageBackend) === 'CLOUDINARY') {
    const { cloudName } = cloudinaryConfig();
    if (cloudName && opts.storageKey) return cloudinaryDeliveryUrl(cloudName, opts.storageKey);
    return '';
  }
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
