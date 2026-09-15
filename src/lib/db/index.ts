/**
 * Database connection layer — now backed by `libsql` so the same code runs
 * locally (file:./data/hokk.db) and on Vercel (libsql://… via Turso).
 *
 * Performance optimizations for Turso remote (added for slow loading fix):
 * - Prepared statement cache (avoid re-preparing same SQL)
 * - Query result cache with TTL for read-heavy pages (dashboard, taxonomy)
 * - Cache invalidation on writes
 * - Reduced roundtrips via batch-friendly helpers
 */

import fs from 'node:fs';
import path from 'node:path';

type SqlValue = string | number | bigint | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

type DbHandle = {
  prepare(sql: string): { get(...params: SqlValue[]): unknown; all(...params: SqlValue[]): unknown[]; run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint; duration?: number } };
  exec(sql: string): void;
  close(): void;
};

let db: DbHandle | null = null;

const g = globalThis as unknown as {
  __hokkDb?: DbHandle;
  __hokkDbUrl?: string;
  __hokkDbPath?: string;
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

export function normalizeEnvValue(raw: string | undefined): string {
  let value = (raw || '').trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

export function resolveDbPath(): string {
  const raw = resolveDbUrl();
  if (isRemoteUrl(raw)) return raw;
  const file = raw.replace(/^file:/, '');
  if (!file || file === ':memory:') return file;
  if (path.isAbsolute(file)) return file;
  return path.resolve(process.cwd(), file);
}

export function resolveDbUrl(): string {
  return normalizeEnvValue(process.env.DATABASE_URL) || 'file:./data/hokk.db';
}

export function dbAuthToken(): string | undefined {
  return (
    normalizeEnvValue(process.env.TURSO_AUTH_TOKEN) ||
    normalizeEnvValue(process.env.LIBSQL_AUTH_TOKEN) ||
    normalizeEnvValue(process.env.DATABASE_AUTH_TOKEN) ||
    normalizeEnvValue(process.env.AUTH_TOKEN) ||
    undefined
  );
}

function createLibsqlDatabase(url: string, authToken?: string): DbHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('libsql') as unknown as new (url: string, opts?: Record<string, unknown>) => DbHandle;
  const opts: Record<string, unknown> = {};
  if (authToken) opts.authToken = authToken;
  if (!isRemoteUrl(url) && url !== ':memory:' && !url.startsWith('file::memory:')) {
    const filePart = url.replace(/^file:/, '');
    if (filePart && filePart !== ':memory:') {
      const abs = path.isAbsolute(filePart) ? filePart : path.resolve(process.cwd(), filePart);
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
      } catch {
        /* ignore */
      }
      const libsqlUrl = `file:${abs}`;
      return new Database(libsqlUrl, opts);
    }
  }
  return new Database(url, opts);
}

function createNodeSqliteDatabase(filePath: string): DbHandle {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
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
  const cacheKey = rawUrl + '::' + (dbAuthToken() || '');

  if (g.__hokkDb && g.__hokkDbUrl === cacheKey) return g.__hokkDb;

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

  const authToken = dbAuthToken();
  let next: DbHandle;

  if (isRemoteUrl(rawUrl)) {
    try {
      next = createLibsqlDatabase(rawUrl, authToken);
    } catch (e) {
      throw new Error(
        `Failed to connect to remote database ${rawUrl}: ${(e as Error).message}. ` +
          `Ensure libsql is installed and TURSO_AUTH_TOKEN is set.`,
      );
    }
  } else {
    const isMemory = rawUrl === ':memory:' || rawUrl === 'file::memory:' || rawUrl === 'file::memory:?cache=shared';
    if (isMemory) {
      try {
        next = createLibsqlDatabase(':memory:');
      } catch {
        next = createNodeSqliteDatabase(':memory:');
      }
    } else {
      try {
        next = createLibsqlDatabase(rawUrl, authToken);
      } catch (e) {
        const filePath = resolveDbPath();
        const fallbackPath = filePath.startsWith('libsql://') || filePath.startsWith('https://') ? ':memory:' : filePath;
        try {
          next = createNodeSqliteDatabase(fallbackPath as string);
        } catch (e2) {
          throw new Error(`Failed to open database with both libsql and node:sqlite: ${(e as Error).message} / ${(e2 as Error).message}`);
        }
      }
    }
  }

  try {
    next.exec('PRAGMA journal_mode = WAL;');
  } catch {
    /* ignore */
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
  // Performance pragmas for local SQLite
  try {
    next.exec('PRAGMA cache_size = -64000;'); // 64MB cache
    next.exec('PRAGMA temp_store = MEMORY;');
    next.exec('PRAGMA synchronous = NORMAL;');
  } catch {
    /* ignore — not supported on remote */
  }

  g.__hokkDb = next;
  g.__hokkDbUrl = cacheKey;
  (g as unknown as { __hokkDbPath?: string }).__hokkDbPath = rawUrl;
  db = next;
  return next;
}

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
  return JSON.stringify(value);
}

function stripMetadata<T>(row: T): T {
  if (row && typeof row === 'object' && '_metadata' in (row as Record<string, unknown>)) {
    const { _metadata: _m, ...rest } = row as unknown as Record<string, unknown> & { _metadata: unknown };
    return rest as T;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Performance: Prepared statement cache + query result cache
// ---------------------------------------------------------------------------

type Stmt = ReturnType<DbHandle['prepare']>;
const stmtCache = new Map<string, Stmt>();
const MAX_STMT_CACHE = 300;

function prepare(sql: string): Stmt {
  const cached = stmtCache.get(sql);
  if (cached) return cached;
  const stmt = getDb().prepare(sql);
  if (stmtCache.size >= MAX_STMT_CACHE) {
    const firstKey = stmtCache.keys().next().value;
    if (firstKey) stmtCache.delete(firstKey);
  }
  stmtCache.set(sql, stmt);
  return stmt;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}
const queryCache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 20_000; // 20s default

function cacheKey(sql: string, params: unknown[]): string {
  return `${sql}::${JSON.stringify(params.map(bind))}`;
}

function getCached<T>(key: string): T | undefined {
  const entry = queryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    queryCache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function setCached(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS): void {
  queryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function clearQueryCache(): void {
  queryCache.clear();
}

function shouldCache(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) return false;
  // Skip cache for queries with LIKE %search% (product search) — they are highly variable
  if (trimmed.includes('LIKE ?') && trimmed.includes('COALESCE')) {
    // Heuristic: if it looks like product search (9 LIKEs), don't cache
    const likeCount = (trimmed.match(/LIKE \?/g) || []).length;
    if (likeCount >= 5) return false;
  }
  return true;
}

export interface QueryOpts {
  ttlMs?: number;
  noCache?: boolean;
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = [], opts: QueryOpts = {}): T[] {
  const useCache = !opts.noCache && shouldCache(sql);
  const key = useCache ? cacheKey(sql, params) : null;
  if (key) {
    const cached = getCached<T[]>(key);
    if (cached) return cached;
  }
  const stmt = prepare(sql);
  const rows = (stmt.all as (...args: unknown[]) => unknown[])(...params.map(bind)) as unknown as T[];
  const cleaned = rows.map((r) => {
    const clean = stripMetadata(r as T);
    return { ...(clean as object) } as T;
  });
  if (key) setCached(key, cleaned, opts.ttlMs ?? DEFAULT_TTL_MS);
  return cleaned;
}

export function allUncached<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  return all<T>(sql, params, { noCache: true });
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = [], opts: QueryOpts = {}): T | undefined {
  const useCache = !opts.noCache && shouldCache(sql);
  const key = useCache ? cacheKey(sql, params) : null;
  if (key && queryCache.has(key)) {
    const entry = queryCache.get(key)!;
    if (Date.now() <= entry.expiresAt) {
      return entry.data as T | undefined;
    }
    queryCache.delete(key);
  }
  const stmt = prepare(sql);
  const row = (stmt.get as (...args: unknown[]) => unknown)(...params.map(bind)) as unknown;
  if (row === undefined || row === null) {
    if (key) setCached(key, undefined, opts.ttlMs ?? DEFAULT_TTL_MS);
    return undefined;
  }
  const clean = stripMetadata(row as T);
  const result = { ...(clean as object) } as T;
  if (key) setCached(key, result, opts.ttlMs ?? DEFAULT_TTL_MS);
  return result;
}

export function getUncached<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  return get<T>(sql, params, { noCache: true });
}

export function run(sql: string, params: unknown[] = []): RunResult {
  clearQueryCache();
  const stmt = prepare(sql);
  const result = (stmt.run as (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint; duration?: number })(...params.map(bind)) as unknown as RunResult;
  return {
    changes: Number((result as { changes: number }).changes) || 0,
    lastInsertRowid: (result as { lastInsertRowid: number | bigint }).lastInsertRowid ?? 0,
  };
}

export function exec(sql: string): void {
  clearQueryCache();
  getDb().exec(sql);
}

export function scalar<T = number>(sql: string, params: unknown[] = [], opts: QueryOpts = {}): T | undefined {
  const row = get<Record<string, unknown>>(sql, params, opts);
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0] as T;
}

let transactionDepth = 0;

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
    // Commit invalidates cache
    if (depth === 0) clearQueryCache();
    return result;
  } catch (error) {
    try {
      if (depth === 0) handle.exec('ROLLBACK');
      else handle.exec(`ROLLBACK TO ${savepoint}`);
    } catch {
      /* ignore */
    }
    transactionDepth = depth;
    throw error;
  }
}

export function migrate(schemaSql: string, version = 1): void {
  const handle = getDb();
  handle.exec(schemaSql);
  try {
    handle.exec(`PRAGMA user_version = ${version};`);
  } catch {
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
    const raw = values[0];
    return raw ? Number(raw) ?? 0 : 0;
  } catch {
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
  stmtCache.clear();
  clearQueryCache();
  // Also clear bootstrap cache so next isInitialized re-checks DB
  try {
    const maybeClear = (globalThis as unknown as { __hokkClearBootstrapCache?: () => void }).__hokkClearBootstrapCache;
    if (maybeClear) maybeClear();
  } catch {
    /* ignore */
  }
}

export function tableExists(name: string): boolean {
  const row = get<{ c: number }>(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name = ?`, [name]);
  return (row?.c ?? 0) > 0;
}

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

export const _internal = {
  get db() {
    return db;
  },
  get cacheSize() {
    return queryCache.size;
  },
  clearCache: clearQueryCache,
};
