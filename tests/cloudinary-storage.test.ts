/**
 * Cloudinary (shared online) storage backend.
 *
 * Covers the adapter's signed upload/read/delete round trips (with `fetch`
 * stubbed — no network), backend selection precedence
 * (`STORAGE_BACKEND` env wins over the `storage.backend` setting), public-URL
 * resolution for cloud rows, and the prune/seed logic that must accept
 * CLOUDINARY while still repairing legacy GDRIVE/S3 values.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-cloud-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

const { ensureSchema, seedSystemDefaults } = await import('@/lib/bootstrap');
const { clearSettingsCache, getSetting, pruneRetiredStorageSettings, setSetting } = await import('@/lib/settings');
const { run } = await import('@/lib/db');
const {
  CloudinaryStorage,
  _internal,
  backendFromRow,
  cloudinaryConfig,
  cloudinaryDeliveryUrl,
  currentBackend,
  getStorage,
  getStorageFor,
  isCloudPublicId,
  isCloudinaryConfigured,
  missingCloudinaryVars,
  resolvePublicUrl,
  signCloudinaryParams,
  storageBackendControlledBy,
} = await import('@/lib/storage');

ensureSchema();
seedSystemDefaults();

const ENV_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_FOLDER', 'STORAGE_BACKEND'] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((k) => [k, process.env[k]]));

function setCloudEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
  process.env.CLOUDINARY_API_KEY = '123456789012345';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  delete process.env.CLOUDINARY_FOLDER;
  delete process.env.STORAGE_BACKEND;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _internal.clearCache();
  clearSettingsCache();
}

beforeEach(() => {
  setCloudEnv();
  setSetting('storage.backend', 'LOCAL');
  clearSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _internal.clearCache();
  clearSettingsCache();
});

type FetchCall = [string, { method: string; body: FormData }];

function stubFetchOnce(response: unknown) {
  const mock = vi.fn(async (..._args: unknown[]) => response);
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

function firstCall(mock: ReturnType<typeof stubFetchOnce>): FetchCall {
  return mock.mock.calls[0] as unknown as FetchCall;
}

describe('cloudinary config', () => {
  it('reads credentials from the environment with a default folder prefix', () => {
    expect(cloudinaryConfig()).toMatchObject({
      cloudName: 'demo-cloud',
      apiKey: '123456789012345',
      apiSecret: 'test-secret',
      folderPrefix: 'hokk-pos',
    });
    expect(isCloudinaryConfigured()).toBe(true);
    expect(missingCloudinaryVars()).toEqual([]);
  });

  it('reports each missing variable', () => {
    setCloudEnv({ CLOUDINARY_API_SECRET: undefined });
    expect(isCloudinaryConfigured()).toBe(false);
    expect(missingCloudinaryVars()).toEqual(['CLOUDINARY_API_SECRET']);
  });

  it('honours a custom folder prefix', () => {
    setCloudEnv({ CLOUDINARY_FOLDER: '/my-shop/' });
    expect(cloudinaryConfig().folderPrefix).toBe('my-shop');
  });

  it('builds encoded delivery URLs without needing a file extension', () => {
    expect(cloudinaryDeliveryUrl('demo-cloud', 'hokk-pos/original/HOKK-SAR-ZK-001/HERO IMAGE')).toBe(
      'https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/original/HOKK-SAR-ZK-001/HERO%20IMAGE',
    );
  });

  it('recognises cloud public ids for the /api/media redirect', () => {
    expect(isCloudPublicId('hokk-pos/original/SKU/file', 'hokk-pos')).toBe(true);
    expect(isCloudPublicId('original/SKU/file.jpg', 'hokk-pos')).toBe(false);
  });

  it('signs params deterministically regardless of key order', () => {
    const a = signCloudinaryParams({ timestamp: '1', public_id: 'x', overwrite: 'true' }, 's3cr3t');
    const b = signCloudinaryParams({ overwrite: 'true', timestamp: '1', public_id: 'x' }, 's3cr3t');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(signCloudinaryParams({ timestamp: '1', public_id: 'x', overwrite: 'true' }, 'other')).not.toBe(a);
  });
});

describe('CloudinaryStorage.put', () => {
  it('uploads to the signed endpoint and stores the public id + secure_url', async () => {
    const mock = stubFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        public_id: 'hokk-pos/original/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO',
        secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/original/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg',
        bytes: 4242,
      }),
    });
    const result = await new CloudinaryStorage().put({
      data: Buffer.from('fake-image'),
      fileName: 'HOKK-SAR-ZK-001-HERO.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });

    expect(result.backend).toBe('CLOUDINARY');
    expect(result.storageKey).toBe('hokk-pos/original/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO');
    expect(result.publicUrl).toContain('https://res.cloudinary.com/demo-cloud/');
    expect(result.path).toBe(result.publicUrl);
    expect(result.bytes).toBe(4242);

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = firstCall(mock);
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(init.method).toBe('POST');
    expect(init.body.get('api_key')).toBe('123456789012345');
    expect(init.body.get('public_id')).toBe('hokk-pos/original/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO');
    expect(init.body.get('overwrite')).toBe('true');
    expect(init.body.get('signature')).toMatch(/^[0-9a-f]{40}$/);
    expect(init.body.get('file')).toBeInstanceOf(Blob);
  });

  it('surfaces Cloudinary error messages instead of a bare status', async () => {
    stubFetchOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid Signature' } }),
    });
    await expect(
      new CloudinaryStorage().put({
        data: Buffer.from('x'),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        folder: 'FINAL',
        groupKey: 'SKU',
      }),
    ).rejects.toThrow('Invalid Signature');
  });

  it('refuses to upload before credentials exist, naming the fix', async () => {
    setCloudEnv({ CLOUDINARY_CLOUD_NAME: undefined, CLOUDINARY_API_KEY: undefined, CLOUDINARY_API_SECRET: undefined });
    await expect(
      new CloudinaryStorage().put({
        data: Buffer.from('x'),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        folder: 'ORIGINAL',
        groupKey: 'SKU',
      }),
    ).rejects.toThrow('CLOUDINARY_CLOUD_NAME');
  });
});

describe('CloudinaryStorage.read/remove', () => {
  it('reads via the stored secure_url first', async () => {
    const mock = stubFetchOnce({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('bytes') });
    const data = await new CloudinaryStorage().read({
      storageKey: 'hokk-pos/original/SKU/file',
      path: 'https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/original/SKU/file.jpg',
    });
    expect(Buffer.from(data).toString()).toBe('bytes');
    expect(mock.mock.calls[0][0]).toBe('https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/original/SKU/file.jpg');
  });

  it('falls back to the delivery URL rebuilt from the public id', async () => {
    const mock = stubFetchOnce({ ok: true, status: 200, arrayBuffer: async () => Buffer.from('bytes') });
    await new CloudinaryStorage().read({ storageKey: 'hokk-pos/final/SKU/file' });
    expect(mock.mock.calls[0][0]).toBe('https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/final/SKU/file');
  });

  it('throws a clear error when the file is gone', async () => {
    stubFetchOnce({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) });
    await expect(new CloudinaryStorage().read({ storageKey: 'hokk-pos/original/SKU/missing' })).rejects.toThrow(
      'not found',
    );
  });

  it('destroys by public id and treats "not found" as success', async () => {
    const mock = stubFetchOnce({ ok: true, status: 200, json: async () => ({ result: 'ok' }) });
    await new CloudinaryStorage().remove({ storageKey: 'hokk-pos/original/SKU/file' });
    const [url, init] = firstCall(mock);
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/destroy');
    expect(init.body.get('public_id')).toBe('hokk-pos/original/SKU/file');

    stubFetchOnce({ ok: true, status: 200, json: async () => ({ result: 'not found' }) });
    await expect(new CloudinaryStorage().remove({ storageKey: 'hokk-pos/original/SKU/gone' })).resolves.toBeUndefined();
  });

  it('reports configuration problems via status()', async () => {
    expect(await new CloudinaryStorage().status()).toMatchObject({ backend: 'CLOUDINARY', configured: true, problems: [] });
    setCloudEnv({ CLOUDINARY_API_KEY: undefined });
    const status = await new CloudinaryStorage().status();
    expect(status.configured).toBe(false);
    expect(status.problems.join(' ')).toContain('CLOUDINARY_API_KEY');
  });
});

describe('backend selection', () => {
  it('prefers STORAGE_BACKEND env over the setting', () => {
    setSetting('storage.backend', 'LOCAL');
    process.env.STORAGE_BACKEND = 'CLOUDINARY';
    clearSettingsCache();
    expect(currentBackend()).toBe('CLOUDINARY');
    expect(storageBackendControlledBy()).toBe('env');
    expect(getStorage()).toBeInstanceOf(CloudinaryStorage);
  });

  it('falls back to the setting when the env var is unset', () => {
    setSetting('storage.backend', 'CLOUDINARY');
    clearSettingsCache();
    expect(currentBackend()).toBe('CLOUDINARY');
    expect(storageBackendControlledBy()).toBe('settings');
  });

  it('treats unknown/legacy values as LOCAL so stale config never breaks uploads', () => {
    process.env.STORAGE_BACKEND = 'GDRIVE';
    clearSettingsCache();
    _internal.clearCache();
    expect(currentBackend()).toBe('LOCAL');
    expect(backendFromRow('S3')).toBe('LOCAL');
    expect(backendFromRow(null)).toBe('LOCAL');
    expect(backendFromRow('cloudinary')).toBe('CLOUDINARY');
  });

  it('returns the matching adapter per backend', () => {
    expect(getStorageFor('LOCAL').backend).toBe('LOCAL');
    expect(getStorageFor('CLOUDINARY').backend).toBe('CLOUDINARY');
  });
});

describe('resolvePublicUrl', () => {
  it('keeps stored URLs untouched', () => {
    expect(
      resolvePublicUrl({
        storageBackend: 'CLOUDINARY',
        storageKey: 'hokk-pos/original/SKU/file',
        driveFileId: null,
        publicUrl: 'https://example.com/kept.jpg',
      }),
    ).toBe('https://example.com/kept.jpg');
  });

  it('rebuilds cloud URLs from the public id when none was stored', () => {
    expect(
      resolvePublicUrl({
        storageBackend: 'CLOUDINARY',
        storageKey: 'hokk-pos/final/SKU/file',
        driveFileId: null,
      }),
    ).toBe('https://res.cloudinary.com/demo-cloud/image/upload/hokk-pos/final/SKU/file');
  });

  it('returns empty for cloud rows when the cloud name is unknown', () => {
    setCloudEnv({ CLOUDINARY_CLOUD_NAME: undefined });
    expect(
      resolvePublicUrl({ storageBackend: 'CLOUDINARY', storageKey: 'hokk-pos/final/SKU/file', driveFileId: null }),
    ).toBe('');
  });
});

describe('retired-settings pruning', () => {
  it('keeps CLOUDINARY, repairs unknown backends, drops drive/s3 keys', () => {
    setSetting('storage.backend', 'CLOUDINARY');
    pruneRetiredStorageSettings();
    clearSettingsCache();
    expect(getSetting('storage.backend')).toBe('CLOUDINARY');

    run(`INSERT INTO setting (key, value, updated_at) VALUES ('drive.folder', 'x', 't'), ('s3.bucket', 'y', 't')`);
    setSetting('storage.backend', 'GDRIVE');
    pruneRetiredStorageSettings();
    clearSettingsCache();
    expect(getSetting('storage.backend')).toBe('LOCAL');
    expect(getSetting('drive.folder')).toBe('');
    expect(getSetting('s3.bucket')).toBe('');
  });
});
