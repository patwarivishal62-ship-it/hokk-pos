export type StorageBackend = 'LOCAL' | 'GDRIVE';

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

export interface StorageAdapter {
  readonly backend: StorageBackend;
  put(input: PutInput): Promise<PutResult>;
  read(input: ReadInput): Promise<Buffer>;
  remove(input: RemoveInput): Promise<void>;
  isConfigured(): boolean;
  status(): Promise<StorageStatus>;
}
