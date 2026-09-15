import { describe, expect, it } from 'vitest';
import {
  buildSkuPrefix,
  formatSequence,
  generateSku,
  isValidSku,
  maxSequence,
  normalizeSegment,
  skuIssues,
} from '@/lib/sku';

describe('SKU segments', () => {
  it('uppercases, strips invalid characters and truncates', () => {
    expect(normalizeSegment('saree')).toBe('SARE');
    expect(normalizeSegment('Zari Kota')).toBe('ZARI');
    expect(normalizeSegment(null)).toBe('');
  });
});

describe('buildSkuPrefix', () => {
  it('substitutes TYPE and CULTURE placeholders', () => {
    expect(buildSkuPrefix('HOKK-{TYPE}-{CULTURE}-{SEQ}', { type: 'SAR', culture: 'ZK' })).toBe('HOKK-SAR-ZK');
    expect(buildSkuPrefix('HOKK-{TYPE}-{CULTURE}-{SEQ}', { type: 'APP', culture: 'TS' })).toBe('HOKK-APP-TS');
  });

  it('collapses the separator when a segment is missing', () => {
    expect(buildSkuPrefix('HOKK-{TYPE}-{CULTURE}-{SEQ}', { type: 'APP' })).toBe('HOKK-APP');
  });

  it('falls back to GEN when no type is configured', () => {
    expect(buildSkuPrefix('HOKK-{TYPE}-{CULTURE}-{SEQ}', {})).toBe('HOKK-GEN');
  });
});

describe('sequence generation', () => {
  it('starts at 001 for an empty scope', () => {
    expect(generateSku({ prefix: 'HOKK-SAR-ZK', existingSkus: [] })).toBe('HOKK-SAR-ZK-001');
  });

  it('continues from the highest existing suffix', () => {
    expect(generateSku({ prefix: 'HOKK-SAR-ZK', existingSkus: ['HOKK-SAR-ZK-001', 'HOKK-SAR-ZK-007'] })).toBe(
      'HOKK-SAR-ZK-008',
    );
  });

  it('never reuses a number after a deletion', () => {
    // 002 was deleted; the next SKU must be 004, not 002.
    expect(generateSku({ prefix: 'HOKK-SAR-BAL', existingSkus: ['HOKK-SAR-BAL-001', 'HOKK-SAR-BAL-003'] })).toBe(
      'HOKK-SAR-BAL-004',
    );
  });

  it('respects configurable padding', () => {
    expect(generateSku({ prefix: 'HOKK-APP-TS', existingSkus: [], padding: 4 })).toBe('HOKK-APP-TS-0001');
  });

  it('skips SKUs reserved earlier in the same batch', () => {
    expect(
      generateSku({
        prefix: 'HOKK-APP-TS',
        existingSkus: ['HOKK-APP-TS-001'],
        reserved: new Set(['HOKK-APP-TS-002']),
      }),
    ).toBe('HOKK-APP-TS-003');
  });

  it('ignores SKUs from other cultures when scoped', () => {
    expect(maxSequence('HOKK-SAR-ZK', ['HOKK-SAR-BAL-050', 'HOKK-SAR-ZK-002'])).toBe(2);
  });

  it('formats sequences with padding', () => {
    expect(formatSequence(14, 3)).toBe('014');
    expect(formatSequence(1400, 3)).toBe('1400');
  });
});

describe('SKU validation', () => {
  it('accepts canonical SKUs', () => {
    expect(isValidSku('HOKK-SAR-ZK-001')).toBe(true);
    expect(skuIssues('HOKK-SAR-ZK-001')).toEqual([]);
  });

  it('rejects lowercase, spaces and leading hyphens', () => {
    expect(isValidSku('hokk-sar')).toBe(false);
    expect(isValidSku('HOKK SAR')).toBe(false);
    expect(isValidSku('-HOKK')).toBe(false);
    expect(skuIssues('hokk').length).toBeGreaterThan(0);
  });
});
