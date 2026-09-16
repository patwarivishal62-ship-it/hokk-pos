import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { LocalStorage } from './local';
import { defaultUploadDir, hostingPublicBaseUrl } from '@/lib/hosting';
import { GoogleDriveStorage, DEFAULT_PUBLIC_URL_TEMPLATE, DriveNotConfiguredError } from './gdrive';
import { S3Storage, S3NotConfiguredError, normalizeEndpoint, presignGetUrl, publicUrlFor, resolveS3Config } from './s3';
import { normalizeCredential, parseOAuthCredentialBlob } from './oauth';
import type {
  StorageBackend,
  PutInput,
  PutResult,
  ReadInput,
  RemoveInput,
  StorageStatus,
  DriveConfig,
  S3Config,
} from './types';

export {
  LocalStorage,
  GoogleDriveStorage,
  DriveNotConfiguredError,
  DEFAULT_PUBLIC_URL_TEMPLATE,
  S3Storage,
  S3NotConfiguredError,
};
export type { StorageBackend, PutInput, PutResult, ReadInput, RemoveInput, StorageStatus, DriveConfig, S3Config };

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

export function buildDriveConfig(): DriveConfig {
  // Service account JSON: raw JSON, base64, or file path
  let serviceAccountJson: string | undefined;
  const rawJson = process.env.GDRIVE_SERVICE_ACCOUNT_JSON?.trim();
  const filePathEnv = process.env.GDRIVE_SERVICE_ACCOUNT_FILE?.trim();

  if (rawJson) {
    if (rawJson.startsWith('{')) {
      serviceAccountJson = rawJson;
    } else {
      // Try base64 decode
      try {
        const decoded = Buffer.from(rawJson, 'base64').toString('utf8').trim();
        if (decoded.startsWith('{')) serviceAccountJson = decoded;
        else serviceAccountJson = rawJson;
      } catch {
        serviceAccountJson = rawJson;
      }
    }
  } else if (filePathEnv) {
    try {
      const resolved = path.isAbsolute(filePathEnv) ? filePathEnv : path.resolve(process.cwd(), filePathEnv);
      if (fs.existsSync(resolved)) {
        const content = fs.readFileSync(resolved, 'utf8').trim();
        if (content.startsWith('{')) serviceAccountJson = content;
        else {
          try {
            const decoded = Buffer.from(content, 'base64').toString('utf8').trim();
            if (decoded.startsWith('{')) serviceAccountJson = decoded;
            else serviceAccountJson = content;
          } catch {
            serviceAccountJson = content;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Also allow direct file content via _FILE pointing to a JSON file that may be base64
  // The above already handles GDRIVE_SERVICE_ACCOUNT_FILE

  // OAuth credentials. Values are normalised (a pasted value often keeps its
  // wrapping quotes) and GDRIVE_REFRESH_TOKEN may hold a whole Google JSON blob
  // — the consent-flow token JSON or a downloaded credentials.json — in which
  // case its client_id/client_secret fill in for the separate env vars.
  const oauthBlob = parseOAuthCredentialBlob(process.env.GDRIVE_REFRESH_TOKEN);
  const rawRefreshToken = normalizeCredential(process.env.GDRIVE_REFRESH_TOKEN);

  const config: DriveConfig = {
    serviceAccountJson,
    serviceAccountFile: filePathEnv,
    clientId: normalizeCredential(process.env.GDRIVE_CLIENT_ID) || oauthBlob?.clientId || undefined,
    clientSecret: normalizeCredential(process.env.GDRIVE_CLIENT_SECRET) || oauthBlob?.clientSecret || undefined,
    refreshToken: oauthBlob ? oauthBlob.refreshToken : rawRefreshToken,
    parentFolderId:
      process.env.GDRIVE_PARENT_FOLDER_ID?.trim() || readSetting('drive.parent_folder_id') || undefined,
    originalFolderId:
      process.env.GDRIVE_ORIGINAL_FOLDER_ID?.trim() ||
      readSetting('drive.original_folder_id') ||
      undefined,
    finalFolderId:
      process.env.GDRIVE_FINAL_FOLDER_ID?.trim() || readSetting('drive.final_folder_id') || undefined,
    publicUrlTemplate:
      process.env.GDRIVE_PUBLIC_URL_TEMPLATE?.trim() ||
      readSetting('drive.public_url_template') ||
      undefined,
    apiBase: process.env.GDRIVE_API_BASE?.trim() || undefined,
    oauthBase: process.env.GDRIVE_OAUTH_BASE?.trim() || undefined,
  };

  // Trim empty strings to undefined
  for (const k of Object.keys(config) as Array<keyof DriveConfig>) {
    const v = config[k];
    if (typeof v === 'string' && v.trim() === '') config[k] = undefined as never;
  }

  return config;
}

export function buildLocalConfig(): { uploadDir: string } {
  // Defaults are host-aware: on Render uploads land on the persistent disk
  // (/var/data/storage/uploads) instead of the ephemeral container filesystem.
  // See src/lib/hosting.ts.
  const dir =
    process.env.UPLOAD_DIR?.trim() || readSetting('storage.upload_dir') || defaultUploadDir();
  return { uploadDir: dir };
}

/**
 * S3-compatible configuration (Cloudflare R2, Backblaze B2, AWS S3, MinIO).
 * Credentials only ever come from the environment; bucket/region/endpoint and
 * the public base URL may also be managed from Settings → Storage.
 */
export function buildS3Config(): S3Config {
  const expiresRaw = process.env.S3_PRESIGN_EXPIRES?.trim() || readSetting('s3.presign_expires');
  const parsedExpires = expiresRaw ? Number(expiresRaw) : NaN;
  return {
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() || undefined,
    bucket: process.env.S3_BUCKET?.trim() || readSetting('s3.bucket') || undefined,
    region: process.env.S3_REGION?.trim() || readSetting('s3.region') || undefined,
    endpoint: normalizeEndpoint(process.env.S3_ENDPOINT?.trim() || readSetting('s3.endpoint')) ?? undefined,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim() || readSetting('s3.public_base_url') || undefined,
    presignExpires: Number.isFinite(parsedExpires) ? parsedExpires : undefined,
    forcePathStyle: /^(1|true|yes)$/i.test(process.env.S3_FORCE_PATH_STYLE?.trim() ?? ''),
  };
}

// Simple factory with caching per backend — but respect env changes in tests
let cached: { backend: StorageBackend; instance: LocalStorage | GoogleDriveStorage | S3Storage } | null = null;

export function getStorage(): LocalStorage | GoogleDriveStorage | S3Storage {
  let backend: StorageBackend = 'LOCAL';
  const envBackend = process.env.STORAGE_BACKEND?.trim().toUpperCase();
  if (envBackend === 'GDRIVE' || envBackend === 'LOCAL' || envBackend === 'S3') {
    backend = envBackend as StorageBackend;
  } else {
    const settingBackend = readSetting('storage.backend').toUpperCase();
    if (settingBackend === 'GDRIVE' || settingBackend === 'LOCAL' || settingBackend === 'S3') {
      backend = settingBackend as StorageBackend;
    }
  }

  // In tests, env may change between calls — invalidate cache if backend differs
  if (cached && cached.backend === backend) return cached.instance;

  let instance: LocalStorage | GoogleDriveStorage | S3Storage;
  if (backend === 'GDRIVE') {
    const cfg = buildDriveConfig();
    instance = new GoogleDriveStorage(cfg);
    // Ensure the instance reports correct backend even if config is empty
    (instance as unknown as { backend: StorageBackend }).backend = 'GDRIVE';
  } else if (backend === 'S3') {
    instance = new S3Storage(buildS3Config());
    (instance as unknown as { backend: StorageBackend }).backend = 'S3';
  } else {
    const cfg = buildLocalConfig();
    instance = new LocalStorage(cfg);
    (instance as unknown as { backend: StorageBackend }).backend = 'LOCAL';
  }
  cached = { backend, instance };
  return instance;
}

/**
 * Resolves the publicly reachable URL for an image.
 *
 * - S3 is handled first: with a public base URL the link is regenerated
 *   deterministically from the key; without one a FRESH presigned URL is
 *   minted — a stored presigned URL would silently expire, so it is never
 *   trusted.
 * - If the row already has a publicUrl, return it (GDRIVE files are already shared).
 * - For GDRIVE, synthesize from the template + driveFileId.
 * - For LOCAL, build from PUBLIC_BASE_URL + /api/media/<key> if a base is configured.
 * - Otherwise return empty string — the caller will treat it as "not publicly accessible".
 */
export function resolvePublicUrl(opts: {
  storageBackend: string;
  storageKey: string;
  driveFileId: string | null;
  publicUrl?: string | null;
}): string {
  if (opts.storageBackend === 'S3') {
    const resolved = resolveS3Config(buildS3Config());
    if (resolved.publicBaseUrl) {
      return publicUrlFor(resolved, opts.storageKey) ?? opts.publicUrl ?? '';
    }
    if (resolved.accessKeyId && resolved.secretAccessKey && resolved.bucket) {
      try {
        return presignGetUrl(resolved, opts.storageKey.replace(/^\/+/, ''));
      } catch {
        return opts.publicUrl || '';
      }
    }
    // Unconfigured — honour a stored permanent link, but never a stale presigned one.
    if (opts.publicUrl && !opts.publicUrl.includes('X-Amz-Signature=')) return opts.publicUrl;
    return '';
  }
  if (opts.publicUrl && opts.publicUrl.trim() !== '') return opts.publicUrl;
  if (opts.storageBackend === 'GDRIVE' && opts.driveFileId) {
    const template = readSetting('drive.public_url_template') || process.env.GDRIVE_PUBLIC_URL_TEMPLATE || DEFAULT_PUBLIC_URL_TEMPLATE;
    return template.replace('{fileId}', opts.driveFileId);
  }
  if (opts.storageBackend === 'LOCAL') {
    // PUBLIC_BASE_URL — or, on Render, the service's own https://…onrender.com
    // URL, which Render injects as RENDER_EXTERNAL_URL.
    const base = readSetting('storage.public_base_url') || hostingPublicBaseUrl();
    const trimmed = base.replace(/\/$/, '');
    if (!trimmed) return '';
    const encoded = opts.storageKey.split('/').map(encodeURIComponent).join('/');
    return `${trimmed}/api/media/${encoded}`;
  }
  return opts.publicUrl || '';
}

// For testing: allow clearing cache
export const _internal = {
  clearCache() {
    cached = null;
  },
};
