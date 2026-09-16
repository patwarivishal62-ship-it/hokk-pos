/**
 * Storage types — two backends.
 *
 * - LOCAL: uploaded photographs are written to the server's own filesystem
 *   (`UPLOAD_DIR`, on Render the persistent disk at
 *   /var/data/storage/uploads) and served back through
 *   `GET /api/media/<key>`.
 * - CLOUDINARY: uploads go to Cloudinary over HTTPS and the row keeps the
 *   public id + secure_url, so every device, deployment and Shopify import
 *   sees the same online copy. Setup: `CLOUD_STORAGE.md`.
 *
 * Rows written by the retired Google Drive / S3 trials keep their stored
 * `public_url`, which is still honoured — see `resolvePublicUrl`.
 */
export type StorageBackend = 'LOCAL' | 'CLOUDINARY';

export type ImageFolder = 'ORIGINAL' | 'FINAL';

export interface PutInput {
  data: Buffer;
  fileName: string;
  mimeType: string;
  folder: ImageFolder;
  groupKey: string;
  /** Request-derived origin used to publish the image immediately. */
  publicBaseUrl?: string;
}

export interface PutResult {
  storageKey: string;
  path?: string;
  publicUrl?: string | null;
  driveFileId?: string | null;
  driveFolderId?: string | null;
  backend: StorageBackend;
  fileName: string;
  mimeType: string;
  bytes: number;
}

export interface ReadInput {
  storageKey: string;
  driveFileId?: string | null;
  path?: string;
}

export interface RemoveInput {
  storageKey: string;
  driveFileId?: string | null;
}

export interface StorageStatus {
  backend: StorageBackend;
  configured: boolean;
  problems: string[];
}

export interface StorageAdapter {
  readonly backend: StorageBackend;
  put(input: PutInput): Promise<PutResult>;
  read(input: ReadInput): Promise<Buffer>;
  remove(input: RemoveInput): Promise<void>;
  isConfigured(): boolean;
  status(): Promise<StorageStatus>;
}
