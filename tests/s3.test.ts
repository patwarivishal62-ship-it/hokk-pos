/**
 * Exercises the real S3-compatible adapter (Cloudflare R2 / Backblaze B2 /
 * AWS S3 / MinIO) against a local mock of the S3 REST API.
 *
 * Two levels of confidence:
 *   1. The SigV4 primitives reproduce the worked example from the AWS
 *      documentation ("GET /test.txt", examplebucket, 20130524T000000Z) —
 *      so the signing bytes are provably AWS-correct, not just self-consistent.
 *   2. A mock S3 server re-derives the signature of every incoming request
 *      from the raw request line + headers, exactly as a real S3 service
 *      does, and rejects anything that does not match — covering put/read/
 *      remove/headBucket round-trips and anonymous presigned GETs.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  S3Storage,
  buildCanonicalRequest,
  buildStringToSign,
  computeSignature,
  deriveSigningKey,
  hmacSha256,
  normalizeEndpoint,
  objectUrlFor,
  presignGetUrl,
  publicUrlFor,
  resolveS3Config,
  sha256Hex,
  toAmzDate,
  uriEncode,
} from '@/lib/storage/s3';
import { _internal, buildS3Config, getStorage, resolvePublicUrl } from '@/lib/storage';

const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const REGION = 'auto';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// ---------------------------------------------------------------------------
// 1. AWS documentation vectors
// ---------------------------------------------------------------------------

describe('sigv4 primitives (AWS documentation vectors)', () => {
  it('sha256Hex hashes the empty payload to the well-known constant', () => {
    expect(sha256Hex('')).toBe(EMPTY_SHA);
    expect(sha256Hex(Buffer.alloc(0))).toBe(EMPTY_SHA);
  });

  it('uriEncode follows RFC 3986 with optional slash preservation', () => {
    expect(uriEncode('a b/c+d')).toBe('a%20b%2Fc%2Bd');
    expect(uriEncode('a b/c+d', false)).toBe('a%20b/c%2Bd');
    expect(uriEncode('HOKK-SAR-ZK-001/hero.jpg')).toBe('HOKK-SAR-ZK-001%2Fhero.jpg');
    expect(uriEncode('é')).toBe('%C3%A9');
    expect(uriEncode('AKID/scope/with/slashes', false)).toBe('AKID/scope/with/slashes');
  });

  it('toAmzDate formats ISO 8601 basic', () => {
    expect(toAmzDate(new Date('2013-05-24T00:00:00.000Z'))).toBe('20130524T000000Z');
  });

  it('deriveSigningKey chains the HMACs the way AWS specifies', () => {
    // AWS docs: kSigning = HMAC(HMAC(HMAC(HMAC("AWS4"+kSecret, date), region), service), "aws4_request")
    const key = deriveSigningKey(SECRET, '20130524', 'us-east-1', 's3');
    expect(key).toEqual(hmacSha256(hmacSha256(hmacSha256(hmacSha256(`AWS4${SECRET}`, '20130524'), 'us-east-1'), 's3'), 'aws4_request'));
  });

  it('reproduces the documented signature for GET /test.txt (examplebucket, 20130524T000000Z)', () => {
    const canonicalRequest = buildCanonicalRequest({
      method: 'GET',
      canonicalUri: '/test.txt',
      canonicalQuery: '',
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': EMPTY_SHA,
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: EMPTY_SHA,
    });
    const stringToSign = buildStringToSign('20130524T000000Z', '20130524/us-east-1/s3/aws4_request', canonicalRequest);
    // The signature published in the AWS S3 SigV4 documentation for this exact request.
    expect(computeSignature(SECRET, '20130524', 'us-east-1', 's3', stringToSign)).toBe(
      'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Config + URL building
// ---------------------------------------------------------------------------

describe('s3 config resolution', () => {
  it('defaults region to auto with an endpoint, us-east-1 without', () => {
    expect(resolveS3Config({ endpoint: 'https://acct.r2.cloudflarestorage.com' }).region).toBe('auto');
    expect(resolveS3Config({}).region).toBe('us-east-1');
    expect(resolveS3Config({ endpoint: 'https://example.com', region: 'us-west-2' }).region).toBe('us-west-2');
  });

  it('normalises endpoints: adds scheme, strips trailing slashes, http for localhost', () => {
    expect(normalizeEndpoint('https://a.example.com/')).toBe('https://a.example.com');
    expect(normalizeEndpoint('a.example.com')).toBe('https://a.example.com');
    expect(normalizeEndpoint('localhost:9000')).toBe('http://localhost:9000');
    expect(normalizeEndpoint('')).toBeNull();
  });

  it('clamps presign expiry to the S3 window (60 s … 7 days)', () => {
    expect(resolveS3Config({ presignExpires: 1 }).presignExpires).toBe(60);
    expect(resolveS3Config({ presignExpires: 999_999_999 }).presignExpires).toBe(604_800);
    expect(resolveS3Config({ presignExpires: NaN }).presignExpires).toBe(604_800);
    expect(resolveS3Config({}).presignExpires).toBe(604_800);
  });

  it('builds path-style URLs for custom endpoints and virtual-hosted for AWS', () => {
    const r2 = resolveS3Config({ endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'hokk', region: 'auto' });
    expect(objectUrlFor(r2, 'original/SKU/a.jpg')).toBe(
      'https://acct.r2.cloudflarestorage.com/hokk/original/SKU/a.jpg',
    );
    const aws = resolveS3Config({ bucket: 'hokk', region: 'us-east-1' });
    expect(objectUrlFor(aws, 'original/SKU/a.jpg')).toBe(
      'https://hokk.s3.us-east-1.amazonaws.com/original/SKU/a.jpg',
    );
    const awsPath = resolveS3Config({ bucket: 'hokk', region: 'us-east-1', forcePathStyle: true });
    expect(objectUrlFor(awsPath, 'a.jpg')).toBe('https://s3.us-east-1.amazonaws.com/hokk/a.jpg');
  });

  it('percent-encodes unsafe key characters in URLs', () => {
    const cfg = resolveS3Config({ endpoint: 'https://e.example.com', bucket: 'b', region: 'auto' });
    expect(objectUrlFor(cfg, 'original/SKU/with space+plus.jpg')).toBe(
      'https://e.example.com/b/original/SKU/with%20space%2Bplus.jpg',
    );
  });

  it('builds permanent public URLs only when a base is configured', () => {
    const withBase = resolveS3Config({ endpoint: 'https://e.example.com', bucket: 'b', publicBaseUrl: 'https://pub-x.r2.dev/' });
    expect(publicUrlFor(withBase, 'original/SKU/a.jpg')).toBe('https://pub-x.r2.dev/original/SKU/a.jpg');
    const noBase = resolveS3Config({ endpoint: 'https://e.example.com', bucket: 'b' });
    expect(publicUrlFor(noBase, 'original/SKU/a.jpg')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Mock S3 server — verifies every signature like the real service
// ---------------------------------------------------------------------------

const objects = new Map<string, { body: Buffer; contentType: string }>();
let signatureChecks = 0;
let signatureFailures = 0;
let intentionalFailures = 0;
let lastRequest: { method: string; url: string; contentType?: string } | null = null;

/** Re-derives the SigV4 signature from a raw incoming request. */
function verifyHeaderSignature(req: IncomingMessage): boolean {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') return false;
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([^,]+), ?Signature=([0-9a-f]{64})$/.exec(
    authorization,
  );
  if (!match) return false;
  const [, accessKey, dateStamp, region, service, signedHeaders, signature] = match;
  if (accessKey !== ACCESS_KEY) return false;

  const header = (name: string): string => String(req.headers[name] ?? '');
  const canonicalHeaders = signedHeaders
    .split(';')
    .map((name) => `${name}:${header(name).trim()}\n`)
    .join('');
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query = [...url.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [
    req.method ?? 'GET',
    url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    header('x-amz-content-sha256'),
  ].join('\n');
  const amzDate = header('x-amz-date');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${region}/${service}/aws4_request`, sha256Hex(canonicalRequest)].join('\n');
  const expected = computeSignature(SECRET, dateStamp, region, service, stringToSign);
  return expected === signature;
}

/** Verifies a presigned query-string signature on an anonymous request. */
function verifyPresignedSignature(url: URL): boolean {
  const signature = url.searchParams.get('X-Amz-Signature');
  const credential = url.searchParams.get('X-Amz-Credential');
  if (!signature || !credential) return false;
  const [accessKey, dateStamp, region, service] = credential.split('/');
  if (accessKey !== ACCESS_KEY) return false;
  const params = [...url.searchParams.entries()]
    .filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .sort()
    .join('&');
  const canonicalRequest = ['GET', url.pathname, params, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    url.searchParams.get('X-Amz-Date') ?? '',
    `${dateStamp}/${region}/${service}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join('\n');
  return computeSignature(SECRET, dateStamp, region, service, stringToSign) === signature;
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      const send = (status: number, payload: Buffer | string, extra: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/xml', ...extra });
        res.end(payload);
      };
      const s3Error = (status: number, code: string, message: string) =>
        send(status, `<?xml version="1.0"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);

      // Presigned GETs arrive with the auth in the query string, not headers.
      // The URL base must reflect the ACTUAL Host header — the signature covers it.
      const hostBase = `http://${req.headers.host ?? 'localhost'}`;
      const presignedUrl = new URL(req.url ?? '/', hostBase);
      if (presignedUrl.searchParams.has('X-Amz-Signature')) {
        signatureChecks += 1;
        if (!verifyPresignedSignature(presignedUrl)) {
          signatureFailures += 1;
          s3Error(403, 'SignatureDoesNotMatch', 'presigned signature rejected');
          return;
        }
        const pKey = pathname.split('/').slice(2).join('/'); // strip /<bucket>/
        const object = objects.get(pKey);
        if (!object) {
          s3Error(404, 'NoSuchKey', 'The specified key does not exist.');
          return;
        }
        res.writeHead(200, { 'content-type': object.contentType });
        res.end(object.body);
        return;
      }

      signatureChecks += 1;
      if (!verifyHeaderSignature(req)) {
        signatureFailures += 1;
        s3Error(403, 'SignatureDoesNotMatch', 'header signature rejected');
        return;
      }

      const key = pathname.split('/').slice(2).join('/'); // strip /<bucket>/
      lastRequest = { method: req.method ?? '', url: req.url ?? '', contentType: req.headers['content-type'] as string | undefined };

      if (req.method === 'PUT') {
        objects.set(key, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
        send(200, '', { etag: '"mock-etag"' });
        return;
      }
      if (req.method === 'GET') {
        const object = objects.get(key);
        if (!object) {
          s3Error(404, 'NoSuchKey', 'The specified key does not exist.');
          return;
        }
        res.writeHead(200, { 'content-type': object.contentType });
        res.end(object.body);
        return;
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        send(204, '');
        return;
      }
      if (req.method === 'HEAD') {
        // HEAD on the bucket itself (path is /<bucket>)
        if (pathname.split('/').filter(Boolean).length === 1) {
          send(200, '', { 'x-amz-bucket-region': REGION });
          return;
        }
        const object = objects.get(key);
        if (!object) {
          s3Error(404, 'NoSuchKey', 'The specified key does not exist.');
          return;
        }
        send(200, '', { 'content-length': String(object.body.length) });
        return;
      }
      s3Error(400, 'NotImplemented', 'method not handled by mock');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server did not start');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(
    signatureFailures - intentionalFailures,
    'every request the adapter sent must carry a valid SigV4 signature',
  ).toBe(0);
  expect(signatureChecks, 'the suite must actually have exercised signed requests').toBeGreaterThan(0);
});

function mockStorage(overrides: Record<string, unknown> = {}): S3Storage {
  return new S3Storage({
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET,
    bucket: 'hokk-test',
    region: REGION,
    endpoint: base,
    ...overrides,
  });
}

describe('S3Storage against a verifying mock server', () => {
  it('isConfigured requires credentials and bucket', () => {
    expect(mockStorage().isConfigured()).toBe(true);
    expect(new S3Storage({ accessKeyId: 'a' }).isConfigured()).toBe(false);
  });

  it('put routes ORIGINAL and FINAL into the same key layout as the other backends', async () => {
    const storage = mockStorage();
    const original = await storage.put({
      data: Buffer.from('original-bytes'),
      fileName: 'HOKK-SAR-ZK-001-HERO.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });
    const final = await storage.put({
      data: Buffer.from('final-bytes'),
      fileName: 'HOKK-SAR-ZK-001-HERO.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'HOKK-SAR-ZK-001',
    });
    expect(original.storageKey).toBe('original/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg');
    expect(final.storageKey).toBe('final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg');
    expect(original.backend).toBe('S3');
    expect(original.bytes).toBe(14);
    expect(original.driveFileId).toBeNull();
    // The content type we send is what the object is stored with.
    expect(lastRequest?.contentType).toBe('image/jpeg');
  });

  it('put returns a permanent public URL when a base is configured, null otherwise', async () => {
    const withBase = mockStorage({ publicBaseUrl: 'https://pub-abc.r2.dev' });
    const stored = await withBase.put({
      data: Buffer.from('x'),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'SKU',
    });
    expect(stored.publicUrl).toBe('https://pub-abc.r2.dev/original/SKU/a.jpg');

    const withoutBase = mockStorage();
    const plain = await withoutBase.put({
      data: Buffer.from('x'),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'SKU',
    });
    expect(plain.publicUrl).toBeNull();
  });

  it('handles keys with unsafe characters end to end', async () => {
    const storage = mockStorage();
    await storage.put({
      data: Buffer.from('encoded'),
      fileName: 'with space+plus.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'SKU',
    });
    const bytes = await storage.read({ storageKey: 'original/SKU/with space+plus.jpg' });
    expect(bytes.toString()).toBe('encoded');
  });

  it('read returns exactly the bytes that were written', async () => {
    const storage = mockStorage();
    await storage.put({
      data: Buffer.from('hello-s3'),
      fileName: 'r.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'SKU',
    });
    const bytes = await storage.read({ storageKey: 'final/SKU/r.jpg' });
    expect(bytes.toString()).toBe('hello-s3');
  });

  it('read of a missing key raises the S3 error code', async () => {
    const storage = mockStorage();
    await expect(storage.read({ storageKey: 'final/SKU/nope.jpg' })).rejects.toThrow(/404.*NoSuchKey/);
  });

  it('remove is idempotent — a missing object is success', async () => {
    const storage = mockStorage();
    await storage.put({
      data: Buffer.from('gone'),
      fileName: 'd.jpg',
      mimeType: 'image/jpeg',
      folder: 'ORIGINAL',
      groupKey: 'SKU',
    });
    await expect(storage.remove({ storageKey: 'original/SKU/d.jpg' })).resolves.toBeUndefined();
    await expect(storage.remove({ storageKey: 'original/SKU/d.jpg' })).resolves.toBeUndefined();
  });

  it('headBucket succeeds against a reachable bucket', async () => {
    const head = await mockStorage().headBucket();
    expect(head.ok).toBe(true);
  });

  it('headBucket surfaces credential problems with a helpful message', async () => {
    const storage = mockStorage({ secretAccessKey: 'wrong-secret' });
    // This request is INTENTIONALLY badly signed — the mock must reject it,
    // and the failure must not trip the afterAll "all signatures valid" guard.
    intentionalFailures += 1;
    const head = await storage.headBucket();
    expect(head.ok).toBe(false);
    // HEAD error responses have no body, so the adapter falls back to status guidance.
    expect(head.error).toMatch(/HTTP 403.*S3_SECRET_ACCESS_KEY/);
  });

  it('verifyAccess writes, reads back and deletes a probe object', async () => {
    const storage = mockStorage();
    const { probeKey } = await storage.verifyAccess();
    expect(probeKey).toMatch(/^original\/_hokk-verify\/probe-\d+\.txt$/);
    await expect(storage.read({ storageKey: probeKey })).rejects.toThrow(/NoSuchKey/);
  });

  it('presigned URLs are accepted by the server when fetched anonymously', async () => {
    const storage = mockStorage();
    await storage.put({
      data: Buffer.from('presigned-payload'),
      fileName: 'p.jpg',
      mimeType: 'image/jpeg',
      folder: 'FINAL',
      groupKey: 'SKU',
    });
    const url = presignGetUrl(storage.resolved, 'final/SKU/p.jpg');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain(`X-Amz-Expires=${storage.resolved.presignExpires}`);
    const res = await fetch(url); // no Authorization header — anonymous
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('presigned-payload');
  });

  it('status reports unconfigured credentials as problems', async () => {
    const status = await new S3Storage({ accessKeyId: 'only-this' }).status();
    expect(status.configured).toBe(false);
    expect(status.problems.join(' ')).toContain('S3_SECRET_ACCESS_KEY');
  });

  it('status is configured when the bucket answers HEAD', async () => {
    const status = await mockStorage().status();
    expect(status.configured).toBe(true);
    expect(status.problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Factory + public URL resolution
// ---------------------------------------------------------------------------

describe('storage factory and resolvePublicUrl for S3', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'STORAGE_BACKEND',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ENDPOINT',
      'S3_PUBLIC_BASE_URL',
    ]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    _internal.clearCache();
  });

  it('getStorage returns the S3 adapter when STORAGE_BACKEND=S3', () => {
    process.env.STORAGE_BACKEND = 'S3';
    process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_BUCKET = 'hokk-test';
    process.env.S3_ENDPOINT = base;
    _internal.clearCache();
    const storage = getStorage();
    expect(storage).toBeInstanceOf(S3Storage);
    expect(storage.backend).toBe('S3');
    expect(storage.isConfigured()).toBe(true);
  });

  it('buildS3Config reads the environment', () => {
    process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_BUCKET = 'bucket-from-env';
    process.env.S3_REGION = 'us-west-2';
    process.env.S3_ENDPOINT = 'https://s3.us-west-2.amazonaws.com/';
    const config = buildS3Config();
    expect(config).toMatchObject({
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET,
      bucket: 'bucket-from-env',
      region: 'us-west-2',
      endpoint: 'https://s3.us-west-2.amazonaws.com',
    });
  });

  it('resolvePublicUrl builds permanent URLs from the public base', () => {
    process.env.STORAGE_BACKEND = 'S3';
    process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_BUCKET = 'hokk-test';
    process.env.S3_ENDPOINT = base;
    process.env.S3_PUBLIC_BASE_URL = 'https://pub-abc.r2.dev';
    const url = resolvePublicUrl({
      storageBackend: 'S3',
      storageKey: 'final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg',
      driveFileId: null,
      publicUrl: null,
    });
    expect(url).toBe('https://pub-abc.r2.dev/final/HOKK-SAR-ZK-001/HOKK-SAR-ZK-001-HERO.jpg');
  });

  it('resolvePublicUrl mints a fresh presigned URL when no public base exists', () => {
    process.env.STORAGE_BACKEND = 'S3';
    process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_BUCKET = 'hokk-test';
    process.env.S3_ENDPOINT = base;
    delete process.env.S3_PUBLIC_BASE_URL;
    const url = resolvePublicUrl({
      storageBackend: 'S3',
      storageKey: 'final/SKU/a.jpg',
      driveFileId: null,
      publicUrl: null,
    });
    expect(url).toContain(`${base}/hokk-test/final/SKU/a.jpg?`);
    expect(url).toContain('X-Amz-Signature=');
  });

  it('resolvePublicUrl never trusts a stale stored presigned URL', () => {
    process.env.STORAGE_BACKEND = 'S3';
    process.env.S3_ACCESS_KEY_ID = ACCESS_KEY;
    process.env.S3_SECRET_ACCESS_KEY = SECRET;
    process.env.S3_BUCKET = 'hokk-test';
    process.env.S3_ENDPOINT = base;
    delete process.env.S3_PUBLIC_BASE_URL;
    const url = resolvePublicUrl({
      storageBackend: 'S3',
      storageKey: 'final/SKU/a.jpg',
      driveFileId: null,
      publicUrl: 'https://old.example.com/final/SKU/a.jpg?X-Amz-Signature=expired',
    });
    expect(url).toContain(`${base}/hokk-test/final/SKU/a.jpg?`);
    expect(url).not.toContain('old.example.com');
  });

  it('resolvePublicUrl returns empty when S3 is unconfigured and nothing permanent is stored', () => {
    process.env.STORAGE_BACKEND = 'S3';
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
    delete process.env.S3_PUBLIC_BASE_URL;
    expect(
      resolvePublicUrl({ storageBackend: 'S3', storageKey: 'final/SKU/a.jpg', driveFileId: null, publicUrl: null }),
    ).toBe('');
    // A stored permanent URL still counts — only expiring ones are ignored.
    expect(
      resolvePublicUrl({
        storageBackend: 'S3',
        storageKey: 'final/SKU/a.jpg',
        driveFileId: null,
        publicUrl: 'https://cdn.example.com/final/SKU/a.jpg',
      }),
    ).toBe('https://cdn.example.com/final/SKU/a.jpg');
  });
});
