/**
 * cuid-style identifier generator (dependency free).
 * Format: c + 8-char base36 timestamp + 4-char counter + 8-char random.
 * Collision-resistant enough for an internal tool; uniqueness is still
 * enforced by database UNIQUE constraints.
 */
let counter = Math.floor(Math.random() * 1_679_615);

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBlock(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function cuid(): string {
  const time = Date.now().toString(36).padStart(8, '0').slice(-8);
  counter = (counter + 1) % 1_679_616;
  const count = counter.toString(36).padStart(4, '0').slice(-4);
  return `c${time}${count}${randomBlock(8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
