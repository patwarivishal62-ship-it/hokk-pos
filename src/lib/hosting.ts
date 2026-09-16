/**
 * Hosting-environment detection + filesystem defaults (Render.com).
 *
 * Render gives every service an **ephemeral** filesystem: anything written
 * outside a mounted *persistent disk* is erased on the next deploy, restart or
 * instance replacement. This app stores uploaded photographs and the SQLite
 * database on disk, so on Render both must live under the disk mount.
 *
 * Rather than making the operator remember that, every default in this module
 * bends towards the disk when the process detects Render, and the public base
 * URL falls back to the URL Render injects automatically:
 *
 * | Value | Render default | Anywhere else |
 * | --- | --- | --- |
 * | upload dir | `<disk>/storage/uploads` | `storage/uploads` (Vercel: `/tmp/…`) |
 * | export dir | `<disk>/storage/exports` | `storage/exports` (Vercel: `/tmp/…`) |
 * | database | `file:<disk>/hokk.db` | `file:./data/hokk.db` |
 * | `PUBLIC_BASE_URL` | `RENDER_EXTERNAL_URL` | — |
 *
 * Render injects `RENDER=true`, `RENDER_SERVICE_ID` and `RENDER_EXTERNAL_URL`
 * (e.g. `https://hokk-pos.onrender.com`) into every service at runtime.
 *
 * `render.yaml` in the repository root wires all of this up; see `RENDER.md`.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Where the Blueprint mounts the persistent disk. */
export const DEFAULT_RENDER_DISK_MOUNT = '/var/data';

/**
 * Files written to this directory survive deploys. Override only when the disk
 * is mounted elsewhere (`RENDER_DISK_MOUNT=/mnt/hokk`).
 */
export function renderDiskMount(): string {
  const raw = (process.env.RENDER_DISK_MOUNT || '').trim();
  if (!raw) return DEFAULT_RENDER_DISK_MOUNT;
  return raw.replace(/\/+$/, '') || DEFAULT_RENDER_DISK_MOUNT;
}

/** True when this process runs inside a Render service. */
export function isRender(): boolean {
  return Boolean(
    (process.env.RENDER || '').trim() ||
      (process.env.RENDER_SERVICE_ID || '').trim() ||
      (process.env.RENDER_EXTERNAL_URL || '').trim(),
  );
}

/** `https://<service>.onrender.com`, without a trailing slash. Empty if unset. */
export function renderExternalUrl(): string {
  const raw = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

/**
 * Base URL the outside world can reach this deployment on — what Shopify
 * fetches during a CSV import. Set `PUBLIC_BASE_URL` when using a custom
 * domain; on Render the service's own URL is a working default, which removes
 * the most common cause of blank `Product image URL` columns.
 */
export function hostingPublicBaseUrl(): string {
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return renderExternalUrl();
}

/** `storage/uploads` by default, on the Render disk when running on Render. */
export function defaultUploadDir(): string {
  if (isRender()) return path.join(renderDiskMount(), 'storage', 'uploads');
  if (process.env.VERCEL) return '/tmp/storage/uploads';
  return 'storage/uploads';
}

/** `storage/exports` by default, on the Render disk when running on Render. */
export function defaultExportDir(): string {
  if (isRender()) return path.join(renderDiskMount(), 'storage', 'exports');
  if (process.env.VERCEL) return '/tmp/storage/exports';
  return 'storage/exports';
}

/** `EXPORT_DIR` wins, then the host-aware default. Always absolute. */
export function exportDir(): string {
  const raw = (process.env.EXPORT_DIR || '').trim();
  const dir = raw || defaultExportDir();
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

/** `file:./data/hokk.db` locally, `file:<disk>/hokk.db` on Render. */
export function defaultDatabaseUrl(): string {
  if (isRender()) return `file:${path.join(renderDiskMount(), 'hokk.db')}`;
  return 'file:./data/hokk.db';
}

/** Device id of a path, or `null` when it does not exist / cannot be stat'ed. */
export function deviceId(target: string): number | null {
  try {
    return fs.statSync(target).dev;
  } catch {
    return null;
  }
}

export interface DiskStatus {
  /** Configured mount path (default `/var/data`). */
  mountPath: string;
  /** A filesystem is attached at the mount path. */
  exists: boolean;
  /**
   * That filesystem is separate from the project directory, i.e. a real Render
   * disk rather than a plain directory on the container's ephemeral root.
   */
  persistent: boolean;
  /**
   * True when the app writes data under the mount path, which makes correctness
   * depend on the disk. A deployment on R2/S3 + a remote database does not.
   */
  required: boolean;
}

/**
 * Is a persistent disk actually attached, or is `/var/data` just a directory on
 * the ephemeral container filesystem? Comparing the filesystem device id of the
 * mount against the project directory answers that without any Render API call
 * (a real disk is a separate mount, so its `dev` differs).
 */
export function isPersistentMount(mountPath: string, referencePath: string = process.cwd()): boolean {
  const mountDev = deviceId(mountPath);
  if (mountDev === null) return false;
  const refDev = deviceId(referencePath);
  if (refDev === null) return true; // nothing to compare against — assume mounted
  return mountDev !== refDev;
}

/**
 * Everything the boot check and the health endpoint need to say about the disk.
 *
 * `required` is true whenever the app keeps state on the filesystem — a local
 * `file:` database or the `LOCAL` storage backend. A deployment that runs with
 * an S3-compatible bucket *and* a remote (Turso/libSQL) database needs no disk
 * at all, which is the escape hatch when the catalog outgrows one instance.
 */
export function diskStatus(): DiskStatus {
  const mountPath = renderDiskMount();
  const exists = deviceId(mountPath) !== null;
  const persistent = exists && isPersistentMount(mountPath);
  const dbUrl = (process.env.DATABASE_URL || '').trim() || defaultDatabaseUrl();
  const dbIsRemote = /^(libsql|https?|wss?):/i.test(dbUrl);
  const backend = (process.env.STORAGE_BACKEND || 'LOCAL').trim().toUpperCase();
  return {
    mountPath,
    exists,
    persistent,
    required: !dbIsRemote || backend === 'LOCAL',
  };
}
