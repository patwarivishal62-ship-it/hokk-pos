import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkBoot } from '@/lib/boot-check';
import { closeDb } from '@/lib/db';

const ENV_KEYS = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'VERCEL',
  'TURSO_AUTH_TOKEN',
  'LIBSQL_AUTH_TOKEN',
  'DATABASE_AUTH_TOKEN',
  'AUTH_TOKEN',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  closeDb();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  closeDb();
});

describe('boot-check (deployment pre-flight)', () => {
  it('fails open with SESSION_SECRET guidance when the secret is missing', () => {
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toContain('SESSION_SECRET');
    expect(status.steps.join(' ')).toContain('.env');
  });

  it('gives Vercel-specific secret steps on Vercel', () => {
    process.env.VERCEL = '1';
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toContain('SESSION_SECRET');
    expect(status.steps.join(' ')).toContain('Environment Variables');
  });

  it('reports a missing database when Vercel has a file: URL', () => {
    process.env.VERCEL = '1';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = 'file:./data/hokk.db';
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toBe('Database is not connected');
    expect(status.steps.join(' ')).toContain('turso.tech');
  });

  it('reports a missing database when Vercel has no DATABASE_URL at all', () => {
    process.env.VERCEL = '1';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toBe('Database is not connected');
  });

  it('treats a quoted, padded remote URL as remote (normalization)', () => {
    process.env.VERCEL = '1';
    process.env.SESSION_SECRET = 'x'.repeat(32);
    // Quoted + padded, like a dashboard paste. 127.0.0.1:9 refuses instantly
    // without DNS or internet, so this must reach the connection probe — i.e.
    // "Could not connect", never "Database is not connected".
    process.env.DATABASE_URL = '  "http://127.0.0.1:9"  ';
    process.env.TURSO_AUTH_TOKEN = '  tok  ';
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toBe('Could not connect to the database');
    expect(status.detail).toBeTruthy();
  });

  it('reports a missing auth token for a remote URL without one', () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = 'libsql://hokk-prod-abc.turso.io';
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toContain('TURSO_AUTH_TOKEN');
  });

  it('passes for a working local file database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-boot-'));
    process.env.SESSION_SECRET = 'x'.repeat(32);
    process.env.DATABASE_URL = `file:${path.join(dir, 'boot.db')}`;
    const status = checkBoot();
    expect(status).toEqual({ ok: true, initialized: false });
  });

  it('turns an unreachable database into a friendly error with detail', () => {
    process.env.SESSION_SECRET = 'x'.repeat(32);
    // /proc is never writable, even for root: open must fail instantly.
    process.env.DATABASE_URL = 'file:/proc/1/hokk-cant-open.db';
    const status = checkBoot();
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.title).toBe('Could not connect to the database');
    expect(status.detail).toBeTruthy();
  });
});
