/**
 * Shopify handle generation (spec §31).
 *
 * Rules: lowercase, spaces -> hyphens, invalid characters removed, duplicate
 * prevention, manual override supported via Product.handleLocked.
 */

const MAX_HANDLE_LENGTH = 200;

export function slugify(input: string): string {
  const base = (input ?? '')
    .normalize('NFKD')
    // Drop combining diacritics so "Amara — Zari Kota" survives intact while
    // accented latin letters collapse to ASCII.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Em/en dashes, slashes and ampersands become separators.
    .replace(/[—–]/g, '-')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[^a-zA-Z0-9\u0900-\u097F]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base.slice(0, MAX_HANDLE_LENGTH).replace(/-+$/g, '');
}

/**
 * Builds a unique handle. `existing` should contain every handle already used
 * in the system (lowercased).
 */
export function uniqueHandle(name: string, existing: Iterable<string>, fallbackSeed?: string): string {
  const taken = new Set(Array.from(existing).map((h) => String(h).toLowerCase()));
  let candidate = slugify(name);
  if (!candidate) candidate = slugify(fallbackSeed ?? 'product') || 'product';
  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const attempt = `${candidate}-${suffix}`.slice(0, MAX_HANDLE_LENGTH);
    if (!taken.has(attempt)) return attempt;
    suffix += 1;
    if (suffix > 10_000) throw new Error('Could not generate a unique handle — too many collisions.');
  }
}

export function isValidHandle(handle: string): boolean {
  if (!handle) return false;
  if (handle.length > 255) return false;
  return /^[a-z0-9\u0900-\u097F]+(?:-[a-z0-9\u0900-\u097F]+)*$/.test(handle);
}

export function handleIssues(handle: string): string[] {
  const problems: string[] = [];
  if (!handle) {
    problems.push('Handle is required.');
    return problems;
  }
  if (handle !== handle.toLowerCase()) problems.push('Handle must be lowercase.');
  if (handle.length > 255) problems.push('Handle must be 255 characters or fewer.');
  if (/\s/.test(handle)) problems.push('Handle cannot contain spaces.');
  if (!isValidHandle(handle)) problems.push('Handle may only contain lowercase letters, numbers and hyphens.');
  return problems;
}
