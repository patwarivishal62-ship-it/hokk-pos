import 'server-only';
import { createHash } from 'node:crypto';
import type { PutInput, PutResult, ReadInput, RemoveInput, StorageStatus } from './types';

/**
 * Cloudinary image storage (the shared online backend).
 *
 * Why this exists: the LOCAL backend writes to the server's own disk folder
 * (`storage/uploads`). When the app runs on a laptop, that means *that
 * laptop's* disk — uploads from device A are invisible on device B, and a
 * reinstall wipes them. Cloudinary keeps one online copy every device,
 * deployment and Shopify import can fetch over plain HTTPS.
 *
 * No SDK dependency: uploads use Cloudinary's signed Upload API over `fetch`,
 * reads use the public delivery URL, deletes use the signed destroy API.
 * Free tier, no credit card — setup walkthrough in `CLOUD_STORAGE.md`.
 *
 * Layout: `<prefix>/<original|final>/<SKU>/<basename>` where `prefix`
 * defaults to `hokk-pos` (override with `CLOUDINARY_FOLDER`). The row's
 * `storage_key` is the Cloudinary public id and both `path` and `public_url`
 * carry the `secure_url`, so rows stay viewable even if delivery-URL rules
 * ever change.
 */

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folderPrefix: string;
}

export function cloudinaryConfig(): CloudinaryConfig {
  const prefix =
    (process.env.CLOUDINARY_FOLDER || 'hokk-pos').trim().replace(/^\/+|\/+$/g, '') || 'hokk-pos';
  return {
    cloudName: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: (process.env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: (process.env.CLOUDINARY_API_SECRET || '').trim(),
    folderPrefix: prefix,
  };
}

export function isCloudinaryConfigured(): boolean {
  const cfg = cloudinaryConfig();
  return Boolean(cfg.cloudName && cfg.apiKey && cfg.apiSecret);
}

/** Names of the env vars that are still missing (empty when configured). */
export function missingCloudinaryVars(): string[] {
  const cfg = cloudinaryConfig();
  const missing: string[] = [];
  if (!cfg.cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!cfg.apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!cfg.apiSecret) missing.push('CLOUDINARY_API_SECRET');
  return missing;
}

/** Public delivery URL for a stored public id. No extension needed. */
export function cloudinaryDeliveryUrl(cloudName: string, publicId: string): string {
  const encoded = publicId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://res.cloudinary.com/${cloudName}/image/upload/${encoded}`;
}

/** True when a `/api/media/<key>` path is really a Cloudinary public id. */
export function isCloudPublicId(key: string, folderPrefix: string): boolean {
  return key === folderPrefix || key.startsWith(`${folderPrefix}/`);
}

function sanitizeSegment(value: string): string {
  // Cloudinary public ids may not contain URL-reserved characters; the SKU
  // and canonical filenames are already safe, this only guards edge cases.
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_.\-=+]/g, '-');
  return cleaned || 'file';
}

/**
 * Request signature for the Upload/Destroy APIs: SHA-1 of the `key=value`
 * pairs in alphabetical order concatenated with the API secret.
 * @see https://cloudinary.com/documentation/signatures
 */
export function signCloudinaryParams(params: Record<string, string>, apiSecret: string): string {
  const payload =
    Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&') + apiSecret;
  return createHash('sha1').update(payload).digest('hex');
}

async function cloudinaryErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    if (typeof body?.error === 'string') return body.error;
    if (body?.error?.message) return body.error.message;
  } catch {
    /* fall through to the status line */
  }
  return `${fallback} (HTTP ${response.status})`;
}

export class CloudinaryStorage {
  readonly backend = 'CLOUDINARY' as const;

  private config(): CloudinaryConfig {
    const cfg = cloudinaryConfig();
    const missing = missingCloudinaryVars();
    if (missing.length > 0) {
      throw new Error(
        `Cloudinary is not configured — set ${missing.join(', ')} in the environment. ` +
          `See CLOUD_STORAGE.md for the free setup.`,
      );
    }
    return cfg;
  }

  async put(input: PutInput): Promise<PutResult> {
    const cfg = this.config();
    const folderLower = input.folder.toLowerCase(); // original | final
    const base = sanitizeSegment(input.fileName.replace(/\.[^.]+$/, '') || input.fileName);
    const publicId = `${cfg.folderPrefix}/${folderLower}/${sanitizeSegment(input.groupKey)}/${base}`;

    const timestamp = String(Math.floor(Date.now() / 1000));
    const params: Record<string, string> = {
      overwrite: 'true',
      public_id: publicId,
      timestamp,
      unique_filename: 'false',
    };
    const form = new FormData();
    // BlobPart typing: Buffer is a Uint8Array, accepted at runtime and typed
    // via a narrow cast so DOM + Node lib combinations all compile.
    form.set('file', new Blob([input.data as unknown as ArrayBuffer], { type: input.mimeType }), input.fileName);
    form.set('api_key', cfg.apiKey);
    form.set('timestamp', timestamp);
    form.set('public_id', publicId);
    form.set('overwrite', 'true');
    form.set('unique_filename', 'false');
    form.set('signature', signCloudinaryParams(params, cfg.apiSecret));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      throw new Error(await cloudinaryErrorMessage(response, 'Cloudinary upload failed'));
    }
    const uploaded = (await response.json()) as {
      public_id?: string;
      secure_url?: string;
      bytes?: number;
    };
    if (!uploaded.public_id || !uploaded.secure_url) {
      throw new Error('Cloudinary upload failed: unexpected response (missing public_id/secure_url).');
    }
    return {
      storageKey: uploaded.public_id,
      path: uploaded.secure_url,
      publicUrl: uploaded.secure_url,
      driveFileId: null,
      driveFolderId: null,
      backend: 'CLOUDINARY',
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: typeof uploaded.bytes === 'number' ? uploaded.bytes : input.data.length,
    };
  }

  async read(input: ReadInput): Promise<Buffer> {
    // Cloud rows store the secure_url in `path`, which is always
    // format-correct; the delivery URL rebuilt from the public id is the
    // fallback for rows written before that convention.
    const candidates: string[] = [];
    if (input.path && /^https?:\/\//i.test(input.path)) candidates.push(input.path);
    const { cloudName } = cloudinaryConfig();
    if (cloudName && input.storageKey) candidates.push(cloudinaryDeliveryUrl(cloudName, input.storageKey));
    if (candidates.length === 0) {
      throw new Error(
        `Cannot read ${input.storageKey || 'image'}: no URL stored and CLOUDINARY_CLOUD_NAME is not set.`,
      );
    }
    let lastStatus = 0;
    for (const url of candidates) {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastStatus = response.status;
    }
    throw new Error(`Cloudinary file not found: ${input.storageKey} (HTTP ${lastStatus})`);
  }

  async remove(input: RemoveInput): Promise<void> {
    const cfg = this.config();
    const publicId = input.storageKey;
    if (!publicId) return; // idempotent: nothing stored, nothing to delete
    const timestamp = String(Math.floor(Date.now() / 1000));
    const form = new FormData();
    form.set('api_key', cfg.apiKey);
    form.set('timestamp', timestamp);
    form.set('public_id', publicId);
    form.set('signature', signCloudinaryParams({ public_id: publicId, timestamp }, cfg.apiSecret));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(await cloudinaryErrorMessage(response, 'Cloudinary delete failed'));
    }
    const body = (await response.json()) as { result?: string };
    // 'not found' is fine — deletion is idempotent.
    if (body.result !== 'ok' && body.result !== 'not found') {
      throw new Error(`Cloudinary delete failed: ${body.result || 'unexpected response'}.`);
    }
  }

  isConfigured(): boolean {
    return isCloudinaryConfigured();
  }

  async status(): Promise<StorageStatus> {
    const missing = missingCloudinaryVars();
    return {
      backend: 'CLOUDINARY',
      configured: missing.length === 0,
      problems:
        missing.length === 0
          ? []
          : [`Missing environment variables: ${missing.join(', ')}. See CLOUD_STORAGE.md.`],
    };
  }
}
