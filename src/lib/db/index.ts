/**
 * SQLite connection layer built on Node's built-in `node:sqlite`
 * (DatabaseSync). Zero native dependencies, no engine downloads.
 *
 * Why not an ORM: the sandbox/production environments we target must be able
 * to install this app with `npm install` alone. `node:sqlite` ships with Node
 * >= 22.5. All SQL is plain and portable — see docs/ARCHITECTURE.md for the
 * Postgres migration path.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

type SqlValue = string | number | bigint | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

let db: DatabaseSync | null = null;
let dbPath = '';

const g = globalThis as unknown as {
  __hokkDb?: DatabaseSync;
  __hokkDbPath?: string;
};

export function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL || 'file:./data/hokk.db';
  const file = raw.replace(/^file:/, '');
  if (path.isAbsolute(file)) return file;
  return path.resolve(process.cwd(), file);
}

export function getDb(): DatabaseSync {
  const target = resolveDbPath();
  if (g.__hokkDb && g.__hokkDbPath === target) return g.__hokkDb;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const next = new DatabaseSync(target);
  next.exec('PRAGMA journal_mode = WAL;');
  next.exec('PRAGMA foreign_keys = ON;');
  next.exec('PRAGMA busy_timeout = 5000;');
  g.__hokkDb = next;
  g.__hokkDbPath = target;
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

function prepare(sql: string) {
  return getDb().prepare(sql);
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const rows = prepare(sql).all(...params.map(bind)) as unknown as T[];
  // node:sqlite returns null-prototype objects; normalise them.
  return rows.map((r) => ({ ...(r as object) }) as T);
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const row = prepare(sql).get(...params.map(bind)) as unknown;
  if (row === undefined || row === null) return undefined;
  return { ...(row as object) } as T;
}

export function run(sql: string, params: unknown[] = []): RunResult {
  return prepare(sql).run(...params.map(bind)) as unknown as RunResult;
}

export function exec(sql: string): void {
  getDb().exec(sql);
}

export function scalar<T = number>(sql: string, params: unknown[] = []): T | undefined {
  const row = prepare(sql).get(...params.map(bind)) as unknown;
  if (!row) return undefined;
  const values = Object.values(row as object);
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
  handle.exec(`PRAGMA user_version = ${version};`);
}

export function schemaVersion(): number {
  const row = getDb().prepare('PRAGMA user_version').get() as unknown as Record<string, number> | undefined;
  return row ? Number(Object.values(row)[0] ?? 0) : 0;
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
  g.__hokkDbPath = undefined;
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
