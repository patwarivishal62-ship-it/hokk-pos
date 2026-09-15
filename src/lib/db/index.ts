/**
 * Database connection layer — now backed by `libsql` so the same code runs
 * locally (file:./data/hokk.db) and on Vercel (libsql://… via Turso).
 *
 * `libsql` is better-sqlite3-compatible and synchronous, so the ~303 call sites
 * in 47 files stay untouched. It handles both `file:` URLs and remote
 * `libsql://` / `https://` URLs with the same API. Native prebuild is verified
 * to install on Node 22 (see `npm install libsql` in this repo’s setup).
 *
 * Why not @libsql/client (async): that would require awaiting every query and
 * touching every helper, repository and action. We keep the SQLite dialect,
 * keep `transaction()` re-entrant via SAVEPOINT + depth counter, and keep
 * DATABASE_URL as the single switch.
 *
 * Vercel notes:
 * - The filesystem is read-only except /tmp. A `file:` DATABASE_URL on Vercel
 *   would fail at mkdirSync. Set DATABASE_URL to your Turso URL
 *   (e.g. libsql://hokk-prod-xxx.turso.io) and TURSO_AUTH_TOKEN in the Vercel
 *   environment. No shell is available, so schema/seed must run without
 *   `npm run db:init`. See the “Running on Vercel” section below and the
 *   `/api/admin/db-init` route (or the lazy `ensureSchema()` in `bootstrap.ts`
 *   which runs on first request).
 */

import fs from 'node:fs';
import path from 'node:path';

type SqlValue = string | number | bigint | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

// We keep the Database type broad — `libsql` returns a better-sqlite3-like instance
type DbHandle = {
  prepare(sql: string): { get(...params: SqlValue[]): unknown; all(...params: SqlValue[]): unknown[]; run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint; duration?: number } };
  exec(sql: string): void;
  close(): void;
};

let db: DbHandle | null = null;

const g = globalThis as unknown as {
  __hokkDb?: DbHandle;
  __hokkDbUrl?: string;
  __hokkDbPath?: string; // legacy
};

function isRemoteUrl(raw: string): boolean {
  return (
    raw.startsWith('libsql://') ||
    raw.startsWith('https://') ||
    raw.startsWith('http://') ||
    raw.startsWith('wss://') ||
    raw.startsWith('ws://')
  );
}

export function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL || 'file:./data/hokk.db';
  if (isRemoteUrl(raw)) return raw;
  const file = raw.replace(/^file:/, '');
  if (!file || file === ':memory:') return file;
  if (path.isAbsolute(file)) return file;
  return path.resolve(process.cwd(), file);
}

function resolveDbUrl(): string {
  return process.env.DATABASE_URL || 'file:./data/hokk.db';
}

function getAuthToken(): string | undefined {
  return (
    process.env.TURSO_AUTH_TOKEN ||
    process.env.LIBSQL_AUTH_TOKEN ||
    process.env.DATABASE_AUTH_TOKEN ||
    process.env.AUTH_TOKEN ||
    undefined
  );
}

function createLibsqlDatabase(url: string, authToken?: string): DbHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('libsql') as unknown as new (url: string, opts?: Record<string, unknown>) => DbHandle;
  const opts: Record<string, unknown> = {};
  if (authToken) opts.authToken = authToken;
  // For file URLs, ensure the directory exists before constructing
  if (!isRemoteUrl(url) && url !== ':memory:' && !url.startsWith('file::memory:')) {
    const filePart = url.replace(/^file:/, '');
    if (filePart && filePart !== ':memory:') {
      const abs = path.isAbsolute(filePart) ? filePart : path.resolve(process.cwd(), filePart);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
      } catch {
        /* ignore */
      }
      // Rebuild URL as file: + absolute path for libsql
      const libsqlUrl = `file:${abs}`;
      return new Database(libsqlUrl, opts);
    }
  }
  return new Database(url, opts);
}

function createNodeSqliteDatabase(filePath: string): DbHandle {
  // Fallback to node:sqlite for local files if libsql is unavailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  // Ensure directory exists
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    /* ignore */
  }
  const handle = new DatabaseSync(filePath) as unknown as DbHandle;
  return handle;
}

export function getDb(): DbHandle {
  const rawUrl = resolveDbUrl();
  const cacheKey = rawUrl + '::' + (getAuthToken() || '');

  if (g.__hokkDb && g.__hokkDbUrl === cacheKey) return g.__hokkDb;

  // If URL changed, close previous
  if (g.__hokkDb && g.__hokkDbUrl !== cacheKey) {
    try {
      g.__hokkDb.close();
    } catch {
      /* ignore */
    }
    g.__hokkDb = undefined;
    g.__hokkDbUrl = undefined;
    db = null;
  }

  const authToken = getAuthToken();
  let next: DbHandle;

  if (isRemoteUrl(rawUrl)) {
    // Remote Turso/libSQL — must use libsql
    try {
      next = createLibsqlDatabase(rawUrl, authToken);
    } catch (e) {
      throw new Error(
        `Failed to connect to remote database ${rawUrl}: ${(e as Error).message}. ` +
          `Ensure libsql is installed and TURSO_AUTH_TOKEN is set.`,
      );
    }
  } else {
    // Local file or :memory: — prefer libsql, fallback to node:sqlite
    const isMemory = rawUrl === ':memory:' || rawUrl === 'file::memory:' || rawUrl === 'file::memory:?cache=shared';
    if (isMemory) {
      try {
        next = createLibsqlDatabase(':memory:');
      } catch {
        next = createNodeSqliteDatabase(':memory:');
      }
    } else {
      // Try libsql first
      try {
        next = createLibsqlDatabase(rawUrl, authToken);
      } catch (e) {
        // Fallback to node:sqlite if libsql fails (e.g. native binding missing)
        const filePath = resolveDbPath();
        // filePath here is absolute for file: URLs, or raw for remote (but we are in local branch)
        const fallbackPath = filePath.startsWith('libsql://') || filePath.startsWith('https://') ? ':memory:' : filePath;
        try {
          next = createNodeSqliteDatabase(fallbackPath as string);
        } catch (e2) {
          throw new Error(`Failed to open database with both libsql and node:sqlite: ${(e as Error).message} / ${(e2 as Error).message}`);
        }
      }
    }
  }

  // Pragmas — best effort, ignore failures on remote
  try {
    next.exec('PRAGMA journal_mode = WAL;');
  } catch {
    /* ignore — not supported on all remotes */
  }
  try {
    next.exec('PRAGMA foreign_keys = ON;');
  } catch {
    /* ignore */
  }
  try {
    next.exec('PRAGMA busy_timeout = 5000;');
  } catch {
    /* ignore */
  }

  g.__hokkDb = next;
  g.__hokkDbUrl = cacheKey;
  // Legacy path for older code that checks __hokkDbPath
  (g as unknown as { __hokkDbPath?: string }).__hokkDbPath = rawUrl;
  db = next;
  return next;
}

/** Bind-value sanitisation: SQLite has no boolean/undefined/Date affinity. */
export function bind(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return value;
  // Objects/arrays are stored as JSON text by callers via json()
  return JSON.stringify(value);
}

function stripMetadata<T>(row: T): T {
  if (row && typeof row === 'object' && '_metadata' in (row as Record<string, unknown>)) {
    const { _metadata: _m, ...rest } = row as unknown as Record<string, unknown> & { _metadata: unknown };
    return rest as T;
  }
  return row;
}

function prepare(sql: string) {
  return getDb().prepare(sql);
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = prepare(sql);
  const rows = (stmt.all as (...args: unknown[]) => unknown[])(...params.map(bind)) as unknown as T[];
  // libsql's `all` returns clean objects, but `get` includes _metadata — for consistency, strip in case
  return rows.map((r) => {
    const clean = stripMetadata(r as T);
    // node:sqlite returns null-prototype objects; normalise them.
    return { ...(clean as object) } as T;
  });
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = prepare(sql);
  const row = (stmt.get as (...args: unknown[]) => unknown)(...params.map(bind)) as unknown;
  if (row === undefined || row === null) return undefined;
  const clean = stripMetadata(row as T);
  return { ...(clean as object) } as T;
}

export function run(sql: string, params: unknown[] = []): RunResult {
  const stmt = prepare(sql);
  const result = (stmt.run as (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint; duration?: number })(...params.map(bind)) as unknown as RunResult;
  // libsql includes duration; strip it and ensure shape
  return {
    changes: Number((result as { changes: number }).changes) || 0,
    lastInsertRowid: (result as { lastInsertRowid: number | bigint }).lastInsertRowid ?? 0,
  };
}

export function exec(sql: string): void {
  getDb().exec(sql);
}

export function scalar<T = number>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = prepare(sql);
  const row = (stmt.get as (...args: unknown[]) => unknown)(...params.map(bind)) as unknown;
  if (!row) return undefined;
  const clean = stripMetadata(row as Record<string, unknown>);
  const values = Object.values(clean as object);
  // Filter out possible _metadata leftover if not stripped properly
  // Values[0] should be the scalar
  return values[0] as T;
}

/** Nesting depth. SQLite rejects a second BEGIN, so nested calls use savepoints. */
let transactionDepth = 0;

/**
 * Runs `fn` atomically.
 *
 * Re-entrant: several of these compose (for example `applyImport` wraps each row
 * and `createProduct` wraps its own writes), so a nested call joins the outer
 * transaction through a SAVEPOINT instead of issuing a second BEGIN. Rolling the
 * savepoint back undoes only the inner work, which is what callers expect when
 * they catch and continue.
 */
export function transaction<T>(fn: () => T): T {
  const handle = getDb();
  const depth = transactionDepth;
  const savepoint = `sp_${depth}`;

  if (depth === 0) handle.exec('BEGIN');
  else handle.exec(`SAVEPOINT ${savepoint}`);
  transactionDepth = depth + 1;

  try {
    const result = fn();
    if (depth === 0) handle.exec('COMMIT');
    else handle.exec(`RELEASE ${savepoint}`);
    transactionDepth = depth;
    return result;
  } catch (error) {
    try {
      if (depth === 0) handle.exec('ROLLBACK');
      else handle.exec(`ROLLBACK TO ${savepoint}`);
    } catch {
      /* ignore rollback failure */
    }
    transactionDepth = depth;
    throw error;
  }
}

/** Applies db/schema.sql (idempotent) and records the schema version. */
export function migrate(schemaSql: string, version = 1): void {
  const handle = getDb();
  handle.exec(schemaSql);
  try {
    handle.exec(`PRAGMA user_version = ${version};`);
  } catch {
    // On some remotes PRAGMA user_version may not be supported — store in a table instead?
    // Fall back to storing version in setting table if available
    try {
      run(`INSERT INTO setting (key, value, updated_at) VALUES ('schema.version', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(version)]);
    } catch {
      /* ignore */
    }
  }
}

export function schemaVersion(): number {
  try {
    const row = getDb().prepare('PRAGMA user_version').get() as unknown as Record<string, number> | undefined;
    if (!row) return 0;
    const clean = stripMetadata(row as Record<string, unknown>);
    const values = Object.values(clean as object);
    // First value is user_version, but libsql includes _metadata so we already stripped
    const raw = values[0];
    return raw ? Number(raw) ?? 0 : 0;
  } catch {
    // Fallback to setting table if PRAGMA not supported
    try {
      const row = get<{ value: string }>('SELECT value FROM setting WHERE key = ?', ['schema.version']);
      return row ? Number(row.value) || 0 : 0;
    } catch {
      return 0;
    }
  }
}

export function closeDb(): void {
  if (g.__hokkDb) {
    try {
      g.__hokkDb.close();
    } catch {
      /* ignore */
    }
  }
  g.__hokkDb = undefined;
  g.__hokkDbUrl = undefined;
  (g as unknown as { __hokkDbPath?: string }).__hokkDbPath = undefined;
  db = null;
}

export function tableExists(name: string): boolean {
  const row = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name = ?`,
    [name],
  );
  return (row?.c ?? 0) > 0;
}

/** JSON text helper — keeps call sites readable. */
export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const _internal = { get db() { return db; } };
