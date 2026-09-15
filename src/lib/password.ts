/**
 * Password hashing with Node's built-in scrypt. No native addon, no network.
 * Stored format: scrypt$N$r$p$saltHex$hashHex
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('hex'), derived.toString('hex')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [algo, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (algo !== 'scrypt') return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  let derived: Buffer;
  try {
    derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function passwordIssues(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Password must be at least 10 characters.');
  if (!/[A-Za-z]/.test(password)) problems.push('Password must contain at least one letter.');
  if (!/[0-9]/.test(password)) problems.push('Password must contain at least one number.');
  if (password.length >= 10 && !/[^A-Za-z0-9]/.test(password)) {
    problems.push('Password must contain at least one symbol or punctuation mark.');
  }
  return problems;
}
