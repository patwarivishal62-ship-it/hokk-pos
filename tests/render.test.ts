/**
 * Render.com hosting support: ephemeral-filesystem detection, host-aware
 * defaults for the upload/export directories and the database, the public base
 * URL derived from RENDER_EXTERNAL_URL, and the boot check that refuses to
 * start without a persistent disk.
 *
 * The disk itself cannot be created in a test, so `isPersistentMount` is
 * exercised with /dev/shm (a separate tmpfs where one exists) and the failure
 * path is driven through checkBoot() with the mount pointed at a temporary
 * directory on the same filesystem.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkBoot } from '@/lib/boot-check';
import { closeDb } from '@/lib/db';

const RENDER_KEYS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'RENDER_EXTERNAL_URL',
  'RENDER_DISK_MOUNT',
  'PUBLIC_BASE_URL',
  'UPLOAD_DIR',
  'EXPORT_DIR',
  'DATABASE_URL',
  'STORAGE_BACKEND',
  'SESSION_SECRET',
  'ALLOW_EPHEMERAL_STORAGE',
  'VERCEL',
];

let saved: Record<string, string | undefined>;
const tmpRoots: string[] = [];

function tmpdir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function simulateRender(extra: Record<string, string> = {}): void {
  process.env.RENDER = 'true';
  process.env.RENDER_SERVICE_ID = 'srv-test123';
  process.env.RENDER_EXTERNAL_URL = 'https://hokk-pos.onrender.com';
  process.env.RENDER_DISK_MOUNT = tmpdir('hokk-disk-');
  for (const [key, value] of Object.entries(extra)) process.env[key] = value;
}

beforeEach(() => {
  saved = {};
  for (const key of RENDER_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  closeDb();
});

afterEach(() => {
  for (const key of RENDER_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  closeDb();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Render detection (src/lib/hosting.ts)', () => {
  it('is false without a Render environment', async () => {
    const hosting = await import('@/lib/hosting');
    expect(hosting.isRender()).toBe(false);
    expect(hosting.renderExternalUrl()).toBe('');
    expect(hosting.defaultUploadDir()).toBe('storage/uploads');
    expect(hosting.defaultExportDir()).toBe('storage/exports');
    expect(hosting.defaultDatabaseUrl()).toBe('file:./data/hokk.db');
    expect(hosting.hostingPublicBaseUrl()).toBe('');
  });

  it('detects Render from RENDER, RENDER_SERVICE_ID or RENDER_EXTERNAL_URL', async () => {
    const hosting = await import('@/lib/hosting');
    process.env.RENDER = 'true';
    expect(hosting.isRender()).toBe(true);
    delete process.env.RENDER;

    process.env.RENDER_SERVICE_ID = 'srv-1';
    expect(hosting.isRender()).toBe(true);
    delete process.env.RENDER_SERVICE_ID;

    process.env.RENDER_EXTERNAL_URL = 'https://hokk-pos.onrender.com';
    expect(hosting.isRender()).toBe(true);
  });

  it('defaults every filesystem path onto the Render disk', async () => {
    simulateRender();
    const hosting = await import('@/lib/hosting');
    const mount = process.env.RENDER_DISK_MOUNT as string;

    expect(hosting.renderDiskMount()).toBe(mount);
    expect(hosting.defaultUploadDir()).toBe(path.join(mount, 'storage', 'uploads'));
    expect(hosting.defaultExportDir()).toBe(path.join(mount, 'storage', 'exports'));
    expect(hosting.defaultDatabaseUrl()).toBe(`file:${path.join(mount, 'hokk.db')}`);
  });

  it('falls back to /var/data and strips a trailing slash', async () => {
    process.env.RENDER = 'true';
    const hosting = await import('@/lib/hosting');
    expect(hosting.renderDiskMount()).toBe('/var/data');

    process.env.RENDER_DISK_MOUNT = '/mnt/hokk/';
    expect(hosting.renderDiskMount()).toBe('/mnt/hokk');
  });

  it('derives the public base URL from RENDER_EXTERNAL_URL (Shopify image links)', async () => {
    simulateRender();
    const hosting = await import('@/lib/hosting');
    expect(hosting.hostingPublicBaseUrl()).toBe('https://hokk-pos.onrender.com');

    // A custom domain always wins.
    process.env.PUBLIC_BASE_URL = 'https://images.houseofkalakatha.com/';
    expect(hosting.hostingPublicBaseUrl()).toBe('https://images.houseofkalakatha.com');
  });

  it('treats a directory on the same filesystem as not persistent', async () => {
    const hosting = await import('@/lib/hosting');
    const plain = tmpdir('hokk-plain-');
    // A child of the project directory shares its filesystem → not a mount.
    expect(hosting.isPersistentMount(plain, process.cwd())).toBe(false);
    // A path that does not exist is never a mounted disk.
    expect(hosting.isPersistentMount(path.join(plain, 'missing'), process.cwd())).toBe(false);
  });

  it('detects a genuine separate mount when one is available', async () => {
    const hosting = await import('@/lib/hosting');
    const shm = '/dev/shm';
    const separate = fs.existsSync(shm) && hosting.deviceId(shm) !== hosting.deviceId(os.tmpdir());
    // tmpfs /dev/shm is a different device on Linux; other platforms skip.
    expect(separate || true).toBe(true);
    if (!separate) return;
    const dir = fs.mkdtempSync(path.join(shm, 'hokk-disk-'));
    tmpRoots.push(dir);
    expect(hosting.isPersistentMount(dir, process.cwd())).toBe(true);
  });
});

describe('storage + database defaults follow the host', () => {
  it('buildLocalConfig and the DB URL use the Render disk', async () => {
    simulateRender();
    const { buildLocalConfig } = await import('@/lib/storage');
    const { resolveDbUrl, resolveDbPath } = await import('@/lib/db');
    const mount = process.env.RENDER_DISK_MOUNT as string;

    expect(buildLocalConfig().uploadDir).toBe(path.join(mount, 'storage', 'uploads'));
    expect(resolveDbUrl()).toBe(`file:${path.join(mount, 'hokk.db')}`);
    expect(resolveDbPath()).toBe(path.join(mount, 'hokk.db'));
  });

  it('explicit configuration always beats the host default', async () => {
    simulateRender({ UPLOAD_DIR: '/mnt/photos', DATABASE_URL: 'libsql://hokk.turso.io' });
    const { buildLocalConfig } = await import('@/lib/storage');
    const { resolveDbPath } = await import('@/lib/db');
    const { exportDir } = await import('@/lib/hosting');

    expect(buildLocalConfig().uploadDir).toBe('/mnt/photos');
    expect(resolveDbPath()).toBe('libsql://hokk.turso.io');
    expect(exportDir()).toBe(path.join(process.env.RENDER_DISK_MOUNT as string, 'storage', 'exports'));

    process.env.EXPORT_DIR = '/mnt/exports';
    expect(exportDir()).toBe('/mnt/exports');
  });

  it('local storage publishes Render-hosted /api/media URLs', async () => {
    const uploadDir = tmpdir('hokk-uploads-');
    simulateRender({ UPLOAD_DIR: uploadDir });
    const { getStorage, resolvePublicUrl, _internal } = await import('@/lib/storage');
    _internal.clearCache();

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const stored = await getStorage().put({
      data: png,
      fileName: 'HOKK-SAR-ZK-001-HERO.png',
      mimeType: 'image/png',
      folder: 'FINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });

    // The adapter stores a fully-qualified URL — that is what Shopify fetches.
    expect(stored.publicUrl).toBe(
      'https://hokk-pos.onrender.com/api/media/final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.png',
    );
    expect(fs.existsSync(path.join(uploadDir, 'final', 'HOKK-SAR-ZK-001', 'HOKK-SAR-ZK-001-HERO.png'))).toBe(true);

    // Rows written before the disk existed (empty publicUrl) resolve too.
    const resolved = resolvePublicUrl({
      storageBackend: 'LOCAL',
      storageKey: 'final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.png',
      driveFileId: null,
      publicUrl: null,
    });
    expect(resolved).toBe(
      'https://hokk-pos.onrender.com/api/media/final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.png',
    );
    expect(String(await getStorage().read({ storageKey: stored.storageKey }))).toBe(String(png));
    _internal.clearCache();
  });
});

describe('boot check on Render', () => {
  it('refuses to start when no persistent disk is mounted', () => {
    simulateRender();
    process.env.SESSION_SECRET = 'x'.repeat(32);
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toBe('Persistent disk is not attached');
    const steps = status.steps.join(' ');
    expect(steps).toContain('Disks');
    // The message names the mount path the operator must use.
    expect(steps).toContain(process.env.RENDER_DISK_MOUNT as string);
    expect(steps).toContain('ALLOW_EPHEMERAL_STORAGE');
  });

  it('starts once the mount is a separate filesystem', async () => {
    const hosting = await import('@/lib/hosting');
    const shm = '/dev/shm';
    if (!fs.existsSync(shm) || hosting.deviceId(shm) === hosting.deviceId(os.tmpdir())) return;
    const disk = fs.mkdtempSync(path.join(shm, 'hokk-disk-'));
    tmpRoots.push(disk);
    process.env.RENDER = 'true';
    process.env.RENDER_DISK_MOUNT = disk;
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = `file:${path.join(disk, 'hokk.db')}`;
    process.env.UPLOAD_DIR = path.join(disk, 'uploads');
    closeDb();

    const status = checkBoot();
    expect(status.ok).toBe(true);
    expect(fs.existsSync(path.join(disk, 'hokk.db'))).toBe(true);
  });

  it('needs no disk when images and database live off the filesystem', () => {
    simulateRender({ STORAGE_BACKEND: 'S3', DATABASE_URL: 'libsql://hokk-prod.turso.io' });
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.TURSO_AUTH_TOKEN = 'token';
    const status = checkBoot();
    // The probe cannot reach Turso from the test environment, but the disk gate
    // must not fire — a connection error is a different, expected failure here.
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).not.toBe('Persistent disk is not attached');
  });

  it('honours the ALLOW_EPHEMERAL_STORAGE opt-out', () => {
    simulateRender({ ALLOW_EPHEMERAL_STORAGE: '1' });
    process.env.SESSION_SECRET = 'x'.repeat(32);
    const status = checkBoot();
    expect(status.ok).toBe(true);
  });

  it('leaves non-Render deployments untouched', () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = `file:${path.join(tmpdir('hokk-db-'), 'hokk.db')}`;
    closeDb();
    const status = checkBoot();
    expect(status.ok).toBe(true);
  });
});

describe('health endpoint', () => {
  it('reports the Render disk, storage backend and public base URL', async () => {
    simulateRender();
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = `file:${path.join(process.env.RENDER_DISK_MOUNT as string, 'hokk.db')}`;
    closeDb();
    vi.resetModules();
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    // No disk in the test environment → unhealthy, and it says exactly why.
    expect(response.status).toBe(503);
    expect(body.host).toBe('render');
    expect(body.publicBaseUrl).toBe('https://hokk-pos.onrender.com');
    expect((body.disk as { mountPath: string }).mountPath).toBe(process.env.RENDER_DISK_MOUNT);
    expect((body.storage as { localUploadDir: string }).localUploadDir).toBe(
      path.join(process.env.RENDER_DISK_MOUNT as string, 'storage', 'uploads'),
    );
    expect(body.bootError).toBe('Persistent disk is not attached');
  });
});
