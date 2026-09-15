/**
 * Exercises the real Google Drive adapter against a local mock of the Drive
 * REST API. This covers the code paths that matter for the HOKK workflow:
 * service-account auth, creating the "Original" and "Final" folders, routing
 * uploads to the right folder, and producing a public URL for Shopify.
 */
import { createServer, type Server } from 'node:http';
import { generateKeyPairSync, createPublicKey, createVerify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_URL_TEMPLATE,
  GoogleDriveStorage,
  DriveNotConfiguredError,
  createJwtAssertion,
  parseServiceAccount,
} from '@/lib/storage/gdrive';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  client_email: 'hokk-pos@hokk.iam.gserviceaccount.com',
  private_key: PRIVATE_PEM,
});

interface Uploaded {
  id: string;
  name: string;
  folder: string;
  bytes: number;
  shared: boolean;
}

const uploads: Uploaded[] = [];
const folders: Array<{ id: string; name: string; parent: string | null }> = [];
let tokenRequests = 0;
let lastAssertion: string | null = null;

function verifyAssertion(assertion: string): boolean {
  const [headerB64, claimsB64, signatureB64] = assertion.split('.');
  if (!headerB64 || !claimsB64 || !signatureB64) return false;
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${claimsB64}`);
  const signature = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return verifier.verify(createPublicKey(PUBLIC_PEM), signature);
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (url.pathname === '/token' && req.method === 'POST') {
        tokenRequests += 1;
        const form = new URLSearchParams(body.toString('utf8'));
        if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
          lastAssertion = form.get('assertion');
          if (!lastAssertion || !verifyAssertion(lastAssertion)) {
            send(401, { error: 'invalid_grant', error_description: 'bad signature' });
            return;
          }
        } else if (form.get('grant_type') !== 'refresh_token' || !form.get('refresh_token')) {
          send(400, { error: 'invalid_request' });
          return;
        }
        send(200, { access_token: 'test-token', expires_in: 3600, token_type: 'Bearer' });
        return;
      }

      if (!req.headers.authorization?.startsWith('Bearer ')) {
        send(401, { error: 'unauthorized' });
        return;
      }

      if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
        const query = url.searchParams.get('q') ?? '';
        const nameMatch = /name = '([^']+)'/.exec(query);
        const parentMatch = /'([^']+)' in parents/.exec(query);
        const wantedName = nameMatch?.[1];
        const wantedParent = parentMatch?.[1] ?? null;
        const found = folders.filter(
          (folder) => folder.name === wantedName && (wantedParent ? folder.parent === wantedParent : true),
        );
        send(200, { files: found });
        return;
      }

      if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
        const metadata = JSON.parse(body.toString('utf8')) as { name: string; parents?: string[] };
        const id = `folder-${folders.length + 1}`;
        folders.push({ id, name: metadata.name, parent: metadata.parents?.[0] ?? null });
        send(200, { id, name: metadata.name });
        return;
      }

      if (url.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
        const contentType = req.headers['content-type'] ?? '';
        const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
        if (!boundary) {
          send(400, { error: 'missing boundary' });
          return;
        }
        const raw = body.toString('binary');
        const parts = raw.split(`--${boundary}`);
        const metaPart = parts.find((part) => part.includes('application/json'));
        const metadata = JSON.parse(metaPart?.split('\r\n\r\n')[1] ?? '{}') as { name: string; parents: string[] };
        const id = `file-${uploads.length + 1}`;
        uploads.push({
          id,
          name: metadata.name,
          folder: metadata.parents[0],
          bytes: body.length,
          shared: false,
        });
        send(200, { id, name: metadata.name });
        return;
      }

      const permissionMatch = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(url.pathname);
      if (permissionMatch && req.method === 'POST') {
        const target = uploads.find((u) => u.id === permissionMatch[1]);
        if (target) target.shared = true;
        const permission = JSON.parse(body.toString('utf8')) as { role: string; type: string };
        send(200, { id: 'perm-1', ...permission });
        return;
      }

      const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (fileMatch) {
        const id = fileMatch[1];
        if (req.method === 'DELETE') {
          const index = uploads.findIndex((u) => u.id === id);
          if (index >= 0) uploads.splice(index, 1);
          res.writeHead(204).end();
          return;
        }
        if (url.searchParams.get('alt') === 'media') {
          res.writeHead(200, { 'content-type': 'image/jpeg' });
          res.end(Buffer.from('fake-image-bytes'));
          return;
        }
        send(200, { id });
        return;
      }

      send(404, { error: 'not found', path: url.pathname });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeDrive(overrides: Record<string, unknown> = {}) {
  return new GoogleDriveStorage({
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    apiBase: base,
    oauthBase: base,
    ...overrides,
  });
}

describe('service account authentication', () => {
  it('signs a valid RS256 JWT assertion', () => {
    const account = parseServiceAccount(SERVICE_ACCOUNT_JSON);
    const assertion = createJwtAssertion(account, { audience: `${base}/token`, scope: 'https://www.googleapis.com/auth/drive' });
    expect(verifyAssertion(assertion)).toBe(true);
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64').toString('utf8')) as Record<string, unknown>;
    expect(claims.iss).toBe('hokk-pos@hokk.iam.gserviceaccount.com');
    expect(claims.aud).toBe(`${base}/token`);
    expect(Number(claims.exp)).toBeGreaterThan(Number(claims.iat));
  });

  it('rejects malformed service account JSON', () => {
    expect(() => parseServiceAccount('not json')).toThrow(DriveNotConfiguredError);
    expect(() => parseServiceAccount('{"client_email":"a@b.c"}')).toThrow(DriveNotConfiguredError);
  });

  it('obtains and caches an access token', async () => {
    const drive = makeDrive();
    const first = await drive.getAccessToken();
    const before = tokenRequests;
    const second = await drive.getAccessToken();
    expect(first).toBe('test-token');
    expect(second).toBe('test-token');
    expect(tokenRequests).toBe(before);
  });

  it('throws a helpful error when no credentials are configured', async () => {
    const drive = new GoogleDriveStorage({ apiBase: base, oauthBase: base });
    await expect(drive.getAccessToken()).rejects.toThrow(/no credentials are configured/i);
  });

  it('supports the OAuth refresh-token flow', async () => {
    const drive = new GoogleDriveStorage({
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      apiBase: base,
      oauthBase: base,
    });
    expect(await drive.getAccessToken()).toBe('test-token');
  });
});

describe('folder structure (Original + Final)', () => {
  it('creates the HOKK root with Original and Final children', async () => {
    const drive = makeDrive();
    const result = await drive.ensureFolders();
    expect(result.originalFolderId).toBeTruthy();
    expect(result.finalFolderId).toBeTruthy();
    expect(result.originalFolderId).not.toBe(result.finalFolderId);

    const names = folders.map((f) => f.name);
    expect(names).toContain('House of Kala Katha');
    expect(names).toContain('Original');
    expect(names).toContain('Final');

    const original = folders.find((f) => f.name === 'Original')!;
    const final = folders.find((f) => f.name === 'Final')!;
    const root = folders.find((f) => f.name === 'House of Kala Katha')!;
    expect(original.parent).toBe(root.id);
    expect(final.parent).toBe(root.id);
  });

  it('reuses folders instead of creating duplicates', async () => {
    const drive = makeDrive();
    const first = await drive.ensureFolders();
    const countAfterFirst = folders.length;
    const second = await drive.ensureFolders();
    expect(second).toEqual(first);
    expect(folders.length).toBe(countAfterFirst);
  });

  it('reports configuration problems when folders are not linked', async () => {
    const drive = makeDrive();
    const status = await drive.status();
    expect(status.backend).toBe('GDRIVE');
    expect(status.problems.some((p) => p.includes('Original'))).toBe(true);
    await drive.ensureFolders();
    const after = await drive.status();
    expect(after.configured).toBe(true);
    expect(after.problems).toEqual([]);
  });
});

describe('uploads', () => {
  it('routes raw photographs to Original and approved assets to Final', async () => {
    const drive = makeDrive();
    const { originalFolderId, finalFolderId } = await drive.ensureFolders();

    const original = await drive.put({
      data: Buffer.from('raw-photograph'),
      fileName: 'HOKK-SAR-ZK-001-HERO.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });
    const final = await drive.put({
      data: Buffer.from('final-asset'),
      fileName: 'HOKK-SAR-ZK-001-HERO.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });

    expect(original.driveFolderId).toBe(originalFolderId);
    expect(final.driveFolderId).toBe(finalFolderId);
    expect(original.backend).toBe('GDRIVE');
    expect(uploads.find((u) => u.id === original.driveFileId)?.folder).toBe(originalFolderId);
    expect(uploads.find((u) => u.id === final.driveFileId)?.folder).toBe(finalFolderId);
  });

  it('keeps the canonical filename', async () => {
    const drive = makeDrive();
    const stored = await drive.put({
      data: Buffer.from('x'),
      fileName: 'HOKK-SAR-ZK-001-PALLU.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });
    expect(stored.fileName).toBe('HOKK-SAR-ZK-001-PALLU.jpg');
    expect(uploads.find((u) => u.id === stored.driveFileId)?.name).toBe('HOKK-SAR-ZK-001-PALLU.jpg');
  });

  it('shares the file publicly so Shopify can fetch it, and returns a public URL', async () => {
    const drive = makeDrive();
    const stored = await drive.put({
      data: Buffer.from('x'),
      fileName: 'HOKK-SAR-ZK-001-BORDER.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });
    expect(stored.publicUrl).toBe(DEFAULT_PUBLIC_URL_TEMPLATE.replace('{fileId}', stored.driveFileId as string));
    expect(uploads.find((u) => u.id === stored.driveFileId)?.shared).toBe(true);
  });

  it('respects a custom public URL template', async () => {
    const drive = makeDrive({ publicUrlTemplate: 'https://drive.example.com/view?id={fileId}' });
    const stored = await drive.put({
      data: Buffer.from('x'),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'p',
    });
    expect(stored.publicUrl).toBe(`https://drive.example.com/view?id=${stored.driveFileId}`);
  });

  it('reads bytes back through the media endpoint', async () => {
    const drive = makeDrive();
    const stored = await drive.put({
      data: Buffer.from('payload'),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'p',
    });
    const bytes = await drive.read({ storageKey: stored.storageKey, driveFileId: stored.driveFileId });
    expect(bytes.toString('utf8')).toBe('fake-image-bytes');
  });

  it('deletes files', async () => {
    const drive = makeDrive();
    const stored = await drive.put({
      data: Buffer.from('payload'),
      fileName: 'delete-me.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'p',
    });
    const before = uploads.length;
    await drive.remove({ storageKey: stored.storageKey, driveFileId: stored.driveFileId });
    expect(uploads.length).toBe(before - 1);
  });
});
