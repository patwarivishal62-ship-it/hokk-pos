import { createHash, createHmac } from 'node:crypto';
import type { PutInput, PutResult, ReadInput, RemoveInput, S3Config, StorageStatus } from './types';

/**
 * S3-compatible object storage adapter.
 *
 * Talks to any service that speaks the S3 REST API with AWS Signature
 * Version 4 — Cloudflare R2 (recommended: free tier, zero egress fees,
 * static access keys), Backblaze B2, AWS S3 itself or a self-hosted MinIO.
 * Signing is hand-rolled with node:crypto, exactly like the Drive adapter
 * hand-rolls its JWTs — no @aws-sdk dependency, transparent and mockable.
 *
 * Layout mirrors the local adapter:
 *   <bucket>/original/<SKU>/<file>   raw photographs
 *   <bucket>/final/<SKU>/<file>      approved, export-ready assets
 *
 * Public URLs for Shopify:
 *   - S3_PUBLIC_BASE_URL set (e.g. the bucket's r2.dev URL or a custom
 *     domain) → permanent, credential-free URLs: <base>/<key>.
 *   - Not set → presigned GET URLs minted on demand (default 7 days, the
 *     S3 maximum). Shopify fetches Image Src at import time, so a freshly
 *     exported CSV works as long as it is imported within the expiry.
 */

export const DEFAULT_S3_PRESIGN_EXPIRES = 604_800; // 7 days — S3's maximum
export const S3_EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export class S3NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'S3NotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Pure SigV4 primitives — exported so tests can verify them against the
// worked examples in the AWS documentation.
// ---------------------------------------------------------------------------

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC 3986 strict encoding as required by SigV4. Slashes are data in query values. */
export function uriEncode(value: string, encodeSlashes = true): string {
  let out = '';
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === '/' && !encodeSlashes) {
      out += '/';
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Date → 20130524T000000Z (SigV4's x-amz-date / ISO 8601 basic format). */
export function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function deriveSigningKey(secretKey: string, dateStamp: string, region: string, service = 's3'): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

/**
 * Canonical request per the SigV4 spec. `headers` must contain exactly the
 * headers being signed (host is mandatory; every x-amz-* header sent must be
 * signed); key casing is irrelevant here — they are lowercased and sorted.
 */
export function buildCanonicalRequest(args: {
  method: string;
  canonicalUri: string;
  canonicalQuery?: string;
  headers: Record<string, string>;
  payloadHash: string;
}): string {
  const lowered: Array<[string, string]> = Object.entries(args.headers).map(([name, value]) => [
    name.toLowerCase(),
    String(value).trim(),
  ]);
  lowered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = lowered.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = lowered.map(([name]) => name).join(';');
  return [
    args.method.toUpperCase(),
    args.canonicalUri || '/',
    args.canonicalQuery ?? '',
    canonicalHeaders,
    signedHeaders,
    args.payloadHash,
  ].join('\n');
}

export function buildStringToSign(amzDate: string, scope: string, canonicalRequest: string): string {
  return ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
}

export function computeSignature(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
  stringToSign: string,
): string {
  return hmacSha256(deriveSigningKey(secretKey, dateStamp, region, service), stringToSign).toString('hex');
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export interface ResolvedS3Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint: string | null;
  publicBaseUrl: string | null;
  presignExpires: number;
  forcePathStyle: boolean;
}

/** Accepts `host`, `host:port`, `scheme://host` — returns a normalized origin. */
export function normalizeEndpoint(raw?: string): string | null {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(value)) return `http://${value}`;
  return `https://${value}`;
}

export function resolveS3Config(config: S3Config): ResolvedS3Config {
  const endpoint = normalizeEndpoint(config.endpoint);
  let presignExpires = Number(config.presignExpires ?? DEFAULT_S3_PRESIGN_EXPIRES);
  if (!Number.isFinite(presignExpires) || presignExpires <= 0) presignExpires = DEFAULT_S3_PRESIGN_EXPIRES;
  // 60 s … 7 days — the S3 presign window.
  presignExpires = Math.min(Math.max(Math.floor(presignExpires), 60), 604_800);
  return {
    accessKeyId: config.accessKeyId?.trim() ?? '',
    secretAccessKey: config.secretAccessKey?.trim() ?? '',
    bucket: config.bucket?.trim() ?? '',
    // R2 and most S3 clones sign with region "auto"; plain AWS needs the real one.
    region: config.region?.trim() || (endpoint ? 'auto' : 'us-east-1'),
    endpoint,
    publicBaseUrl: config.publicBaseUrl?.trim().replace(/\/+$/, '') || null,
    presignExpires,
    forcePathStyle: Boolean(config.forcePathStyle),
  };
}

export function encodeObjectKey(key: string): string {
  return key.split('/').map((segment) => uriEncode(segment)).join('/');
}

/** Signed request URL for an object. Custom endpoints use path-style (works on R2, B2 and MinIO). */
export function objectUrlFor(resolved: ResolvedS3Config, key: string): string {
  const encodedKey = encodeObjectKey(key.replace(/^\/+/, ''));
  const encodedBucket = uriEncode(resolved.bucket);
  if (resolved.endpoint) return `${resolved.endpoint}/${encodedBucket}/${encodedKey}`;
  if (resolved.forcePathStyle) return `https://s3.${resolved.region}.amazonaws.com/${encodedBucket}/${encodedKey}`;
  return `https://${resolved.bucket}.s3.${resolved.region}.amazonaws.com/${encodedKey}`;
}

/** Permanent public URL — only meaningful when the bucket is publicly readable. */
export function publicUrlFor(resolved: ResolvedS3Config, key: string): string | null {
  if (!resolved.publicBaseUrl) return null;
  return `${resolved.publicBaseUrl}/${encodeObjectKey(key.replace(/^\/+/, ''))}`;
}

/**
 * Presigned GET URL for a private object. Pure computation: the signature is
 * an HMAC over a canonical request built from the URL itself, so the same
 * inputs always yield the same URL until the clock moves.
 */
export function presignGetUrl(resolved: ResolvedS3Config, key: string): string {
  const url = new URL(objectUrlFor(resolved, key));
  const amzDate = toAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${resolved.region}/s3/aws4_request`;
  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${resolved.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(resolved.presignExpires)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const canonicalQuery = query
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .join('&');
  const canonicalRequest = buildCanonicalRequest({
    method: 'GET',
    canonicalUri: url.pathname,
    canonicalQuery,
    headers: { host: url.host },
    payloadHash: 'UNSIGNED-PAYLOAD',
  });
  const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
  const signature = computeSignature(resolved.secretAccessKey, dateStamp, resolved.region, 's3', stringToSign);
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class S3Storage {
  readonly backend = 'S3' as const;
  readonly resolved: ResolvedS3Config;

  constructor(config: S3Config = {}) {
    this.resolved = resolveS3Config(config);
  }

  /** Non-secret description of the resolved configuration (for settings + audit). */
  describe(): { bucket: string; region: string; endpoint: string | null; publicBaseUrl: string | null; presignExpires: number } {
    const { bucket, region, endpoint, publicBaseUrl, presignExpires } = this.resolved;
    return { bucket, region, endpoint, publicBaseUrl, presignExpires };
  }

  isConfigured(): boolean {
    const { accessKeyId, secretAccessKey, bucket } = this.resolved;
    return Boolean(accessKeyId && secretAccessKey && bucket);
  }

  private configProblems(): string[] {
    const problems: string[] = [];
    if (!this.resolved.accessKeyId) problems.push('S3_ACCESS_KEY_ID is not set');
    if (!this.resolved.secretAccessKey) problems.push('S3_SECRET_ACCESS_KEY is not set');
    if (!this.resolved.bucket) problems.push('S3_BUCKET is not set');
    return problems;
  }

  private assertConfigured(): void {
    if (this.isConfigured()) return;
    throw new S3NotConfiguredError(
      `S3-compatible storage is not configured: ${this.configProblems().join(', ')}.`,
    );
  }

  private async signedFetch(
    url: string,
    init: { method: string; body?: Buffer; contentType?: string },
  ): Promise<Response> {
    this.assertConfigured();
    const { accessKeyId, secretAccessKey, region } = this.resolved;
    const target = new URL(url);
    const amzDate = toAmzDate(new Date());
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = init.body ? sha256Hex(init.body) : S3_EMPTY_PAYLOAD_SHA256;
    const signedHeaders: Record<string, string> = {
      host: target.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const canonicalRequest = buildCanonicalRequest({
      method: init.method,
      canonicalUri: target.pathname,
      headers: signedHeaders,
      payloadHash,
    });
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
    const signature = computeSignature(secretAccessKey, dateStamp, region, 's3', stringToSign);
    const signedNames = Object.keys(signedHeaders).sort().join(';');
    const headers: Record<string, string> = {
      ...signedHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
    };
    // Content-Type and Cache-Control ride along unsigned (allowed — only
    // x-amz-* headers must be signed) and are stored with the object so
    // anonymous GETs serve the right MIME type.
    if (init.contentType) headers['content-type'] = init.contentType;
    headers['cache-control'] = 'public, max-age=31536000, immutable';
    return fetch(url, {
      method: init.method,
      headers,
      body: init.body as unknown as BodyInit | undefined,
    });
  }

  /** Extracts a human-readable message from an S3 XML error body. */
  private async describeError(res: Response, context: string): Promise<string> {
    const body = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
    const message = /<Message>([\s\S]*?)<\/Message>/.exec(body)?.[1]?.trim();
    const region =
      res.headers.get('x-amz-bucket-region') ?? /<Region>([^<]+)<\/Region>/.exec(body)?.[1] ?? undefined;
    let hint = '';
    if (code === 'NoSuchBucket') hint = ' The bucket does not exist (or these credentials cannot see it) — check S3_BUCKET.';
    else if (code === 'InvalidAccessKeyId') hint = ' The access key id is not recognised — check S3_ACCESS_KEY_ID.';
    else if (code === 'SignatureDoesNotMatch') hint = ' The secret does not match this access key — check S3_SECRET_ACCESS_KEY.';
    else if (code === 'AccessDenied') hint = ' The credentials lack permission on this bucket — grant read/write object access.';
    else if (code === 'AuthorizationHeaderMalformed' && region) hint = ` The bucket lives in region ${region} — set S3_REGION=${region}.`;
    else if (res.status === 301 && region) hint = ` The bucket lives in region ${region} — set S3_REGION=${region}.`;
    else if (code === 'InvalidRequest' && /virtual hosted/i.test(message ?? '')) {
      hint = ' The endpoint requires virtual-hosted-style addressing — clear S3_FORCE_PATH_STYLE.';
    }
    const parts = [`${context}: HTTP ${res.status}`];
    if (code) parts.push(code);
    if (message) parts.push(`— ${message}`);
    if (!code && !message && body.trim()) parts.push(`— ${body.trim().slice(0, 200)}`);
    // HEAD responses carry no body (the S3 API omits it), so there is no XML
    // to mine — fall back to status-code guidance.
    if (!code && !message && !body.trim()) {
      if (res.status === 403) {
        parts.push('— the request was rejected; check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and that the token can access this bucket');
      } else if (res.status === 404) {
        parts.push('— the bucket (or object) was not found; check S3_BUCKET');
      }
    }
    return `${parts.join(' ')}.${hint}`;
  }

  async put(input: PutInput): Promise<PutResult> {
    const storageKey = `${input.folder.toLowerCase()}/${input.groupKey}/${input.fileName}`;
    const res = await this.signedFetch(objectUrlFor(this.resolved, storageKey), {
      method: 'PUT',
      body: input.data,
      contentType: input.mimeType,
    });
    if (!res.ok) throw new Error(await this.describeError(res, `S3 upload failed for ${storageKey}`));
    return {
      storageKey,
      path: objectUrlFor(this.resolved, storageKey),
      publicUrl: publicUrlFor(this.resolved, storageKey),
      driveFileId: null,
      driveFolderId: null,
      backend: 'S3',
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.data.length,
    };
  }

  async read(input: ReadInput): Promise<Buffer> {
    // `path` and `driveFileId` are ignored — the object key is authoritative.
    const key = input.storageKey.replace(/^\/+/, '');
    const res = await this.signedFetch(objectUrlFor(this.resolved, key), { method: 'GET' });
    if (!res.ok) throw new Error(await this.describeError(res, `S3 read failed for ${key}`));
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(input: RemoveInput): Promise<void> {
    const key = input.storageKey.replace(/^\/+/, '');
    const res = await this.signedFetch(objectUrlFor(this.resolved, key), { method: 'DELETE' });
    // Deleting is idempotent — a missing object is success.
    if (res.ok || res.status === 404) return;
    throw new Error(await this.describeError(res, `S3 delete failed for ${key}`));
  }

  /** HEAD on the bucket — the cheapest authenticated "can we reach it" probe. */
  async headBucket(): Promise<{ ok: boolean; status: number; region?: string; error?: string }> {
    this.assertConfigured();
    const bucketUrl = this.resolved.endpoint
      ? `${this.resolved.endpoint}/${uriEncode(this.resolved.bucket)}`
      : this.resolved.forcePathStyle
        ? `https://s3.${this.resolved.region}.amazonaws.com/${uriEncode(this.resolved.bucket)}`
        : `https://${this.resolved.bucket}.s3.${this.resolved.region}.amazonaws.com`;
    const res = await this.signedFetch(bucketUrl, { method: 'HEAD' });
    if (res.ok) {
      return { ok: true, status: res.status, region: res.headers.get('x-amz-bucket-region') ?? undefined };
    }
    return { ok: false, status: res.status, error: await this.describeError(res, 'Bucket check failed') };
  }

  /**
   * Full round-trip probe: writes a tiny throwaway object, reads it back and
   * deletes it. Proves the credentials can do exactly what the app needs
   * (put + read + delete) before the backend is switched over.
   */
  async verifyAccess(): Promise<{ probeKey: string }> {
    this.assertConfigured();
    const fileName = `probe-${Date.now()}.txt`;
    await this.put({
      data: Buffer.from('hokk storage probe\n', 'utf8'),
      fileName,
      mimeType: 'text/plain',
      folder: 'ORIGINAL',
      groupKey: '_hokk-verify',
    });
    const probeKey = `original/_hokk-verify/${fileName}`;
    const bytes = await this.read({ storageKey: probeKey });
    if (bytes.toString('utf8') !== 'hokk storage probe\n') {
      throw new Error('S3 verification: the object read back did not match what was written.');
    }
    await this.remove({ storageKey: probeKey });
    return { probeKey };
  }

  async status(): Promise<StorageStatus> {
    const problems = this.configProblems();
    if (problems.length > 0) {
      return { backend: 'S3', configured: false, problems };
    }
    try {
      const head = await this.headBucket();
      if (!head.ok) problems.push(head.error ?? `Bucket check failed with HTTP ${head.status}.`);
    } catch (error) {
      problems.push(`Could not reach the S3 endpoint: ${(error as Error).message}`);
    }
    // A missing public base URL is NOT a failure — exports fall back to
    // presigned URLs — so it stays out of `problems` (which marks the
    // backend unconfigured). The settings page explains the trade-off.
    return { backend: 'S3', configured: problems.length === 0, problems };
  }
}
