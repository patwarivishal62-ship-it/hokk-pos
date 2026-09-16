export type StorageBackend = 'LOCAL' | 'GDRIVE' | 'S3';

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

export interface DriveConfig {
  serviceAccountJson?: string;
  serviceAccountFile?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  parentFolderId?: string;
  originalFolderId?: string;
  finalFolderId?: string;
  publicUrlTemplate?: string;
  apiBase?: string;
  oauthBase?: string;
}

/**
 * S3-compatible object storage (Cloudflare R2, Backblaze B2, AWS S3, MinIO).
 * Credentials stay in the environment; the non-secret values may also come
 * from the `s3.*` settings keys.
 */
export interface S3Config {
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  /** Custom S3-compatible origin, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
  /** Publicly reachable base for permanent object URLs, e.g. https://pub-<hash>.r2.dev */
  publicBaseUrl?: string;
  /** Presigned-URL lifetime in seconds (used when publicBaseUrl is empty). */
  presignExpires?: number;
  /** Force path-style addressing (bucket in the path) on the default AWS endpoint. */
  forcePathStyle?: boolean;
}

export interface StorageAdapter {
  readonly backend: StorageBackend;
  put(input: PutInput): Promise<PutResult>;
  read(input: ReadInput): Promise<Buffer>;
  remove(input: RemoveInput): Promise<void>;
  isConfigured(): boolean;
  status(): Promise<StorageStatus>;
}
