/**
 * Hosting-environment detection + filesystem defaults (Render.com).
 *
 * Render gives every service an **ephemeral** filesystem: anything written
 * outside a mounted *persistent disk* is erased on the next deploy, restart or
 * instance replacement. This app stores uploaded photographs and the SQLite
 * database on disk, so on Render both must live under the disk mount.
 *
 * Rather than making the operator remember that, every default in this module
 * bends towards the disk when the process detects Render, while public image
 * URLs use the incoming request host with provider metadata as a fallback:
 *
 * | Value | Render default | Anywhere else |
 * | --- | --- | --- |
 * | upload dir | `<disk>/storage/uploads` | `storage/uploads` (Vercel: `/tmp/…`) |
 * | export dir | `<disk>/storage/exports` | `storage/exports` (Vercel: `/tmp/…`) |
 * | database | `file:<disk>/hokk.db` | `file:./data/hokk.db` |
 * | public image base | current request host / Render hostname | current request host |
 *
 * Render injects `RENDER=true`, `RENDER_SERVICE_ID` and
 * `RENDER_EXTERNAL_HOSTNAME` (e.g. `hokk-pos.onrender.com`) at runtime. The app
 * also accepts the older URL-shaped `RENDER_EXTERNAL_URL` variable.
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
      (process.env.RENDER_EXTERNAL_HOSTNAME || '').trim() ||
      (process.env.RENDER_EXTERNAL_URL || '').trim(),
  );
}

/** `https://<service>.onrender.com`, without a trailing slash. Empty if unset. */
export function renderExternalUrl(): string {
  const raw = (process.env.RENDER_EXTERNAL_URL || '').trim();
  if (raw) return raw.replace(/\/+$/, '');
  return hostnameUrl(process.env.RENDER_EXTERNAL_HOSTNAME);
}

/** A minimal header interface, shared by `Headers`, `NextRequest.headers` and tests. */
export interface HeaderReader {
  get(name: string): string | null;
}

function firstForwardedValue(value: string | null): string {
  return (value ?? '').split(',')[0]?.trim() ?? '';
}

/**
 * Derives the origin through which the current request reached the app.
 *
 * Hosting proxies (Render, Vercel, Arena, Cloudflare, etc.) forward the public
 * host in `x-forwarded-host` and the browser protocol in `x-forwarded-proto`.
 * Falling back to `host` also covers a direct Node deployment. The host is
 * deliberately parsed and validated before it is ever written into a Shopify
 * CSV, rather than reflecting an arbitrary Host header verbatim.
 */
export function requestOriginFromHeaders(headers: HeaderReader): string {
  const rawHost = firstForwardedValue(headers.get('x-forwarded-host')) || firstForwardedValue(headers.get('host'));
  if (!rawHost || /[\\/@?#\s]/.test(rawHost)) return '';

  let host = '';
  try {
    const parsed = new URL(`http://${rawHost}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    host = parsed.host;
  } catch {
    return '';
  }
  if (!host) return '';

  const forwardedProto = firstForwardedValue(headers.get('x-forwarded-proto')).toLowerCase();
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : localHost ? 'http' : 'https';
  return `${protocol}://${host}`;
}

function hostnameUrl(value: string | undefined): string {
  const hostname = (value || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return hostname ? `https://${hostname}` : '';
}

/**
 * Base URL the outside world can reach this deployment on — what Shopify
 * fetches during a CSV import.
 *
 * Precedence is intentional:
 * 1. `PUBLIC_BASE_URL` (operator-selected custom domain)
 * 2. the current request's forwarded host (the URL the operator is using)
 * 3. hosting-provider metadata for code paths without a request
 *
 * Request-host detection matters because providers do not consistently expose
 * a service URL environment variable. In particular, Render documents
 * `RENDER_EXTERNAL_HOSTNAME` while older deployments may set
 * `RENDER_EXTERNAL_URL`; Vercel supplies hostname-only variables.
 */
export function hostingPublicBaseUrl(requestOrigin = ''): string {
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const fromRequest = requestOrigin.trim();
  if (fromRequest) return fromRequest.replace(/\/+$/, '');

  return (
    renderExternalUrl() ||
    hostnameUrl(process.env.RENDER_EXTERNAL_HOSTNAME) ||
    hostnameUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    hostnameUrl(process.env.VERCEL_URL)
  );
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
   * depend on the disk. Storage is always on local disk, so on Render this is
   * always true: without the disk, uploads and (file-based) catalog edits are
   * erased on every deploy.
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
 * Uploaded photographs always live on the filesystem (`UPLOAD_DIR`), so the
 * disk is always required on Render — without it every image is erased on the
 * next deploy. (`ALLOW_EPHEMERAL_STORAGE=1` is the deliberate opt-out.)
 */
export function diskStatus(): DiskStatus {
  const mountPath = renderDiskMount();
  const exists = deviceId(mountPath) !== null;
  const persistent = exists && isPersistentMount(mountPath);
  return {
    mountPath,
    exists,
    persistent,
    required: true,
  };
}
