import { describe, expect, it } from 'vitest';
import { handleIssues, isValidHandle, slugify, uniqueHandle } from '@/lib/handle';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Amara Zari Kota')).toBe('amara-zari-kota');
  });

  it('turns em dashes into a single hyphen', () => {
    expect(slugify('Amara — Zari Kota')).toBe('amara-zari-kota');
  });

  it('strips diacritics and invalid characters', () => {
    expect(slugify('Crème Brûlée & Co.')).toBe('creme-brulee-and-co');
    expect(slugify('Saree!! ##42')).toBe('saree-42');
  });

  it('collapses repeated separators and trims edges', () => {
    expect(slugify('  -- Multiple   spaces --  ')).toBe('multiple-spaces');
  });

  it('keeps Devanagari letters, including the nukta, rather than producing an empty handle', () => {
    // Latin accents are stripped; Devanagari is preserved so Hindi names stay
    // spelled correctly in the URL.
    expect(slugify('अमरा ज़री कोटा')).toBe('अमरा-ज़री-कोटा');
    expect(slugify('Crème')).toBe('creme');
  });

  it('caps length at 200 characters', () => {
    expect(slugify('a'.repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe('uniqueHandle', () => {
  it('returns the base handle when free', () => {
    expect(uniqueHandle('Amara Zari Kota', [])).toBe('amara-zari-kota');
  });

  it('appends a numeric suffix on collision', () => {
    expect(uniqueHandle('Amara Zari Kota', ['amara-zari-kota'])).toBe('amara-zari-kota-2');
    expect(uniqueHandle('Amara Zari Kota', ['amara-zari-kota', 'amara-zari-kota-2'])).toBe('amara-zari-kota-3');
  });

  it('falls back to the seed when the name slugifies to nothing', () => {
    expect(uniqueHandle('!!!', [], 'HOKK-SAR-ZK-001')).toBe('hokk-sar-zk-001');
  });
});

describe('handle validation', () => {
  it('accepts a well-formed handle', () => {
    expect(isValidHandle('amara-zari-kota')).toBe(true);
    expect(handleIssues('amara-zari-kota')).toEqual([]);
  });

  it('rejects uppercase, spaces and underscores', () => {
    expect(handleIssues('Amara Zari').length).toBeGreaterThan(0);
    expect(handleIssues('amara_zari').length).toBeGreaterThan(0);
  });

  it('requires a handle at all', () => {
    expect(handleIssues('')).toContain('Handle is required.');
  });
});
