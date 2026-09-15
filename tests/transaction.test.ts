/**
 * `transaction()` must be re-entrant. Several code paths compose — `applyImport`
 * wraps each row and `createProduct` wraps its own writes — and SQLite rejects a
 * second BEGIN with "cannot start a transaction within a transaction".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-db-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;

const { get, run, transaction } = await import('@/lib/db');
const { ensureSchema } = await import('@/lib/bootstrap');

ensureSchema();

function settingCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM setting')!.n;
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('transaction', () => {
  it('commits on success', () => {
    const before = settingCount();
    transaction(() => {
      run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.a', '1', '2026-01-01']);
    });
    expect(settingCount()).toBe(before + 1);
  });

  it('rolls back on failure', () => {
    const before = settingCount();
    expect(() =>
      transaction(() => {
        run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.b', '1', '2026-01-01']);
        throw new Error('deliberate failure');
      }),
    ).toThrow('deliberate failure');
    expect(settingCount()).toBe(before);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM setting WHERE key = 'txn.b'")!.n).toBe(0);
  });

  it('allows a nested transaction to join the outer one', () => {
    const before = settingCount();
    transaction(() => {
      run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.outer', '1', '2026-01-01']);
      transaction(() => {
        run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.inner', '1', '2026-01-01']);
      });
    });
    // Three rows now carry the txn. prefix: txn.a from earlier, plus the two
    // inserted here. The outer transaction only added two settings.
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM setting WHERE key LIKE 'txn.%'")!.n).toBe(3);
    expect(settingCount()).toBe(before + 2);
  });

  it('undoes only the inner work when a nested transaction fails', () => {
    transaction(() => {
      run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.kept', '1', '2026-01-01']);
      expect(() =>
        transaction(() => {
          run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.discarded', '1', '2026-01-01']);
          throw new Error('inner failure');
        }),
      ).toThrow('inner failure');
    });
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM setting WHERE key = 'txn.kept'")!.n).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM setting WHERE key = 'txn.discarded'")!.n).toBe(0);
  });

  it('restores a usable connection after a failed nested transaction', () => {
    expect(() =>
      transaction(() => {
        transaction(() => {
          throw new Error('boom');
        });
      }),
    ).toThrow('boom');

    // The connection must not be left inside an open transaction.
    const before = settingCount();
    transaction(() => {
      run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.after', '1', '2026-01-01']);
    });
    expect(settingCount()).toBe(before + 1);
  });

  it('supports three levels of nesting', () => {
    const before = settingCount();
    transaction(() => {
      run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.l1', '1', '2026-01-01']);
      transaction(() => {
        run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.l2', '1', '2026-01-01']);
        transaction(() => {
          run('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['txn.l3', '1', '2026-01-01']);
        });
      });
    });
    expect(settingCount()).toBe(before + 3);
  });
});
