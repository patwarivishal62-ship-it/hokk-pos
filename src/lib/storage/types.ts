/**
 * Storage types — local disk is the only backend.
 *
 * Uploaded photographs are written to the filesystem (`UPLOAD_DIR`, on Render
 * the persistent disk at /var/data/storage/uploads) and served back through
 * `GET /api/media/<key>`. Rows written by earlier Google Drive / S3 trials
 * keep their stored `public_url`, which is still honoured — see
 * `resolvePublicUrl`.
 */
export type StorageBackend = 'LOCAL';

export type ImageFolder = 'ORIGINAL' | 'FINAL';

export interface PutInput {
  data: Buffer;
  fileName: string;
  mimeType: string;
  folder: ImageFolder;
  groupKey: string;
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
