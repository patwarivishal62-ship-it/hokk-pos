/**
 * Auth server-action tests.
 *
 * `loginAction` is the entry point every user goes through, but it is only
 * reachable over HTTP through Next's server-action protocol, which makes it easy
 * to leave unexercised: a broken action still compiles, still builds, and still
 * leaves every page returning 200 for an already-valid session.
 *
 * These tests drive the real actions against a real SQLite file with
 * `next/headers`, `next/cache` and `next/navigation` stubbed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokk-auth-'));
process.env.DATABASE_URL = `file:${path.join(tmpDir, 'auth.db')}`;
process.env.SESSION_SECRET = 'test-secret-value-for-hokk-pos-0123456789';

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
const nav = vi.hoisted(() => ({ redirects: [] as string[] }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'hokk_session' && jar.value ? { name, value: jar.value } : undefined),
    set: (_name: string, value: string) => {
      jar.value = value;
    },
    delete: () => {
      jar.value = undefined;
    },
  }),
  headers: async () => ({
    get: (name: string) => (name === 'user-agent' ? 'vitest' : null),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    nav.redirects.push(target);
    throw new Error(`NEXT_REDIRECT:${target}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { get, run } = await import('@/lib/db');
const { ensureSchema, seedSystemDefaults, createSuperAdmin } = await import('@/lib/bootstrap');
const { getSessionUser } = await import('@/lib/session');
const { loginAction, logoutAction, changePasswordAction, setupAction } = await import(
  '@/app/actions/auth'
);

const EMAIL = 'founder@test.local';
const PASSWORD = 'correct-horse-battery';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeAll(() => {
  ensureSchema();
  seedSystemDefaults();
  createSuperAdmin({ email: EMAIL, name: 'Test Founder', password: PASSWORD });
});

beforeEach(() => {
  jar.value = undefined;
  nav.redirects = [];
  run('DELETE FROM session');
});

describe('loginAction', () => {
  it('signs in and redirects to the dashboard', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(nav.redirects).toEqual(['/dashboard']);
    expect(jar.value).toBeDefined();
    expect((await getSessionUser())?.email).toBe(EMAIL);
  });

  it('accepts an email that differs only by case and surrounding space', async () => {
    await expect(
      loginAction(null, form({ email: `  ${EMAIL.toUpperCase()}  `, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect((await getSessionUser())?.email).toBe(EMAIL);
  });

  it('returns an error for a wrong password without redirecting', async () => {
    const result = await loginAction(null, form({ email: EMAIL, password: 'wrong-password' }));
    expect(result).toEqual({ error: 'Invalid email or password.' });
    expect(nav.redirects).toEqual([]);
    expect(jar.value).toBeUndefined();
  });

  it('returns an error when a field is missing', async () => {
    expect(await loginAction(null, form({ email: EMAIL }))).toEqual({
      error: 'Enter your email and password.',
    });
    expect(await loginAction(null, form({ password: PASSWORD }))).toEqual({
      error: 'Enter your email and password.',
    });
    expect(jar.value).toBeUndefined();
  });

  it('records user agent metadata on the session', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    const row = get<{ user_agent: string | null }>('SELECT user_agent FROM session LIMIT 1');
    expect(row?.user_agent).toBe('vitest');
  });
});

describe('logoutAction', () => {
  it('clears the session and redirects to login', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(await getSessionUser()).not.toBeNull();

    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(nav.redirects).toEqual(['/dashboard', '/login']);
    expect(await getSessionUser()).toBeNull();
  });

  it('does not throw when called with no session at all', async () => {
    await expect(logoutAction()).rejects.toThrow('NEXT_REDIRECT:/login');
  });
});

describe('changePasswordAction', () => {
  it('refuses when signed out', async () => {
    const result = await changePasswordAction(null, form({ current: PASSWORD, next: 'x', confirm: 'x' }));
    expect(result).toEqual({ error: 'You must be signed in.' });
  });

  it('rejects a wrong current password', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    const result = await changePasswordAction(
      null,
      form({ current: 'not-my-password', next: 'Brand-New-Password-1', confirm: 'Brand-New-Password-1' }),
    );
    expect(result).toEqual({ error: 'Your current password is incorrect.' });
  });

  it('rejects a mismatched confirmation', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    const result = await changePasswordAction(
      null,
      form({ current: PASSWORD, next: 'Brand-New-Password-1', confirm: 'Something-Else-Entirely' }),
    );
    expect(result?.error).toBe('Passwords do not match.');
  });

  it('changes the password, revokes sessions and redirects to login', async () => {
    await expect(
      loginAction(null, form({ email: EMAIL, password: PASSWORD })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    const NEXT = 'Brand-New-Password-1';
    await expect(
      changePasswordAction(null, form({ current: PASSWORD, next: NEXT, confirm: NEXT })),
    ).rejects.toThrow('NEXT_REDIRECT:/login?reason=password-changed');

    // The old session is gone, and the new password is the one that works.
    expect(await getSessionUser()).toBeNull();
    await expect(
      loginAction(null, form({ email: EMAIL, password: NEXT })),
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    const row = get<{ must_change_password: number }>('SELECT must_change_password FROM "user" WHERE email = ?', [
      EMAIL,
    ]);
    expect(row?.must_change_password).toBe(0);

    // restore for any later test in this file
    run('DELETE FROM session');
  });
});

describe('setupAction', () => {
  it('refuses to re-run once the system is initialised', async () => {
    const result = await setupAction(
      null,
      form({ email: 'second@test.local', name: 'Second', password: 'Another-Password-1' }),
    );
    expect(result?.error).toMatch(/already/i);
    const second = get<{ c: number }>('SELECT COUNT(*) AS c FROM "user" WHERE email = ?', ['second@test.local']);
    expect(second?.c).toBe(0);
  });
});
