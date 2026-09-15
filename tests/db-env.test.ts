import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dbAuthToken, normalizeEnvValue, resolveDbUrl } from '@/lib/db';

const ENV_KEYS = ['DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN', 'DATABASE_AUTH_TOKEN', 'AUTH_TOKEN'];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
});

describe('db env normalization', () => {
  it('trims whitespace', () => {
    expect(normalizeEnvValue('  libsql://x.turso.io\n')).toBe('libsql://x.turso.io');
    expect(normalizeEnvValue(undefined)).toBe('');
  });

  it('strips one layer of surrounding quotes', () => {
    expect(normalizeEnvValue('"libsql://x.turso.io"')).toBe('libsql://x.turso.io');
    expect(normalizeEnvValue("'tok123'")).toBe('tok123');
    expect(normalizeEnvValue('  "tok123"  ')).toBe('tok123');
  });

  it('leaves inner quotes alone', () => {
    expect(normalizeEnvValue('ab"cd')).toBe('ab"cd');
  });

  it('resolveDbUrl defaults to the local file when unset', () => {
    expect(resolveDbUrl()).toBe('file:./data/hokk.db');
  });

  it('resolveDbUrl normalizes a quoted, padded URL', () => {
    process.env.DATABASE_URL = '  "libsql://hokk-prod.turso.io" \n';
    expect(resolveDbUrl()).toBe('libsql://hokk-prod.turso.io');
  });

  it('dbAuthToken prefers TURSO_AUTH_TOKEN and normalizes', () => {
    process.env.TURSO_AUTH_TOKEN = '  "tok-turso" ';
    process.env.LIBSQL_AUTH_TOKEN = 'tok-libsql';
    expect(dbAuthToken()).toBe('tok-turso');
  });

  it('dbAuthToken falls through the accepted names', () => {
    process.env.AUTH_TOKEN = '\ntok-auth\n';
    expect(dbAuthToken()).toBe('tok-auth');
  });

  it('dbAuthToken is undefined when nothing usable is set', () => {
    process.env.TURSO_AUTH_TOKEN = '   ';
    expect(dbAuthToken()).toBeUndefined();
  });
});
