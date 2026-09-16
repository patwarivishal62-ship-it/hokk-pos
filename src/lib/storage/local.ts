import fs from 'node:fs';
import path from 'node:path';
import { defaultUploadDir, hostingPublicBaseUrl } from '@/lib/hosting';
import { getSetting } from '@/lib/settings';
import type { PutInput, PutResult, ReadInput, RemoveInput, StorageStatus } from './types';

export class LocalStorage {
  readonly backend = 'LOCAL' as const;
  private uploadDir: string;

  constructor(opts: { uploadDir?: string } = {}) {
    let raw = opts.uploadDir || process.env.UPLOAD_DIR;
    if (!raw) {
      // Host-aware default: on Render the persistent disk, on Vercel /tmp
      // (read-only filesystem), otherwise ./storage/uploads.
      raw = defaultUploadDir();
    }
    // If absolute, keep as is; otherwise resolve against cwd
    this.uploadDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }

  private resolvePublicBase(requestBase = ''): string {
    // Try to read from settings if available; fall back to the explicitly
    // configured environment, current request host, then provider metadata.
    let base = '';
    try {
      base = getSetting('storage.public_base_url') || '';
    } catch {
      // settings may not be ready (e.g. in tests before DB init) — ignore
    }
    if (!base) base = hostingPublicBaseUrl(requestBase);
    return base.replace(/\/$/, '');
  }

  private buildPublicUrl(storageKey: string, requestBase = ''): string | null {
    const base = this.resolvePublicBase(requestBase);
    if (!base) return null;
    const encoded = storageKey.split('/').map(encodeURIComponent).join('/');
    return `${base}/api/media/${encoded}`;
  }

  async put(input: PutInput): Promise<PutResult> {
    const folderLower = input.folder.toLowerCase(); // original | final
    // groupKey is the SKU, already sanitized
    const storageKey = `${folderLower}/${input.groupKey}/${input.fileName}`;
    const fullPath = path.join(this.uploadDir, storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, input.data);

    const publicUrl = this.buildPublicUrl(storageKey, input.publicBaseUrl);

    return {
      storageKey,
      path: fullPath,
      publicUrl,
      driveFileId: null,
      driveFolderId: null,
      backend: 'LOCAL',
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.data.length,
    };
  }

  async read(input: ReadInput): Promise<Buffer> {
    // Prefer explicit path if it points to an existing file (used by promote flow)
    if (input.path) {
      const candidate = path.isAbsolute(input.path) ? input.path : path.resolve(process.cwd(), input.path);
      if (fs.existsSync(candidate)) {
        return fs.promises.readFile(candidate);
      }
      // Fall through to storageKey if path not found
    }
    // storageKey should be like original/<sku>/<file>
    const fullPath = path.join(this.uploadDir, input.storageKey);
    if (fs.existsSync(fullPath)) {
      return fs.promises.readFile(fullPath);
    }
    // Try resolving storageKey as absolute path (in case it already is)
    if (path.isAbsolute(input.storageKey) && fs.existsSync(input.storageKey)) {
      return fs.promises.readFile(input.storageKey);
    }
    throw new Error(`File not found: ${input.storageKey}`);
  }

  async remove(input: RemoveInput): Promise<void> {
    // For local, driveFileId is ignored
    const candidates: string[] = [];
    if (input.storageKey) {
      candidates.push(path.join(this.uploadDir, input.storageKey));
      if (path.isAbsolute(input.storageKey)) candidates.push(input.storageKey);
    }
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          await fs.promises.unlink(p);
          // Try to clean up empty parent directory (group folder) but ignore errors
          try {
            const dir = path.dirname(p);
            const remaining = await fs.promises.readdir(dir);
            if (remaining.length === 0) await fs.promises.rmdir(dir);
          } catch {
            /* ignore */
          }
          return;
        }
      } catch {
        /* ignore and try next candidate */
      }
    }
    // If file not found, don't throw — deletion is idempotent
  }

  isConfigured(): boolean {
    return true;
  }

  async status(): Promise<StorageStatus> {
    return { backend: 'LOCAL', configured: true, problems: [] };
  }
}
