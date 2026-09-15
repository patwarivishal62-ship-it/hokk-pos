import { describe, expect, it } from 'vitest';
import { assessReadiness, detectCatalogDuplicates } from '@/lib/readiness';
import { makeBundle, makeImage, makeProduct, makeVariant } from './helpers/product';

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe('Shopify readiness (spec §30/§36)', () => {
  it('reports READY for a complete product', () => {
    const result = assessReadiness(makeBundle());
    expect(result.state).toBe('READY');
    expect(result.errors).toEqual([]);
  });

  it('blocks when the product name is missing', () => {
    const result = assessReadiness(makeBundle({ product: makeProduct({ name: null }) }));
    expect(result.state).toBe('BLOCKED');
    expect(codes(result.errors)).toContain('MISSING_NAME');
  });

  it('blocks when the product never entered the naming workflow', () => {
    const result = assessReadiness(makeBundle({ product: makeProduct({ name_status: 'NAMING_REQUIRED' }) }));
    expect(result.state).toBe('BLOCKED');
    expect(codes(result.errors)).toContain('NAME_NOT_APPROVED');
  });

  it('warns (not blocks) while a name is proposed', () => {
    const result = assessReadiness(
      makeBundle({ product: makeProduct({ name_status: 'NAME_PROPOSED', name: 'Amara' }) }),
    );
    expect(codes(result.warnings)).toContain('NAME_PENDING');
  });

  it('blocks when there is no price on the product or its variants', () => {
    const result = assessReadiness(
      makeBundle({ product: makeProduct({ price: null }), variants: [makeVariant({ price: null })] }),
    );
    expect(codes(result.errors)).toContain('MISSING_PRICE');
  });

  it('accepts a variant price in place of a product price', () => {
    const result = assessReadiness(
      makeBundle({ product: makeProduct({ price: null }), variants: [makeVariant({ price: 9000 })] }),
    );
    expect(codes(result.errors)).not.toContain('MISSING_PRICE');
  });

  it('blocks on a negative price', () => {
    const result = assessReadiness(makeBundle({ product: makeProduct({ price: -500 }) }));
    expect(codes(result.errors)).toContain('NEGATIVE_PRICE');
  });

  it('blocks when the required pallu image is missing', () => {
    const bundle = makeBundle();
    const result = assessReadiness({ ...bundle, images: bundle.images.filter((i) => i.slot_key !== 'PALLU') });
    expect(result.state).toBe('BLOCKED');
    expect(codes(result.errors)).toContain('MISSING_IMAGE_PALLU');
  });

  it('blocks when no hero / primary image is marked', () => {
    const bundle = makeBundle();
    const result = assessReadiness({
      ...bundle,
      images: bundle.images.map((img) => makeImage({ ...img, is_primary: 0, slot_key: img.slot_key === 'HERO' ? 'OTHER' : img.slot_key })),
    });
    expect(codes(result.errors)).toContain('MISSING_HERO');
  });

  it('warns when images have no alt text', () => {
    const bundle = makeBundle();
    const result = assessReadiness({ ...bundle, images: bundle.images.map((img) => ({ ...img, alt_text: null })) });
    expect(codes(result.warnings)).toContain('MISSING_ALT');
  });

  it('warns when images are not publicly reachable', () => {
    const result = assessReadiness(makeBundle(), { imagesPubliclyAccessible: false });
    expect(codes(result.warnings)).toContain('IMAGES_NOT_PUBLIC');
  });

  it('blocks when no collection is assigned', () => {
    const result = assessReadiness(makeBundle({ collections: [] }));
    expect(codes(result.errors)).toContain('NO_COLLECTION');
  });

  it('blocks on a duplicate handle or SKU', () => {
    const dupHandle = assessReadiness(makeBundle(), { usedHandles: new Set(['amara-zari-kota']) });
    expect(codes(dupHandle.errors)).toContain('DUPLICATE_HANDLE');

    const dupSku = assessReadiness(makeBundle(), { usedSkus: new Set(['HOKK-SAR-ZK-001']) });
    expect(codes(dupSku.errors)).toContain('DUPLICATE_SKU');
  });

  it('blocks on an invalid handle', () => {
    const result = assessReadiness(makeBundle({ product: makeProduct({ handle: 'Amara Zari Kota' }) }));
    expect(codes(result.errors)).toContain('INVALID_HANDLE');
  });

  it('blocks on duplicate variant SKUs and option combinations', () => {
    const result = assessReadiness(
      makeBundle({
        variants: [
          makeVariant({ id: 'v1', sku: 'SKU-A', option1_value: 'M' }),
          makeVariant({ id: 'v2', sku: 'SKU-A', option1_value: 'M' }),
        ],
      }),
    );
    expect(codes(result.errors)).toContain('DUPLICATE_VARIANT_SKU');
    expect(codes(result.errors)).toContain('DUPLICATE_OPTION_COMBO');
  });

  it('warns when compare-at price is below the selling price', () => {
    const result = assessReadiness(
      makeBundle({ product: makeProduct({ price: 12000, compare_at_price: 9000 }) }),
    );
    expect(codes(result.warnings)).toContain('COMPARE_BELOW_PRICE');
  });

  it('returns YELLOW when only warnings remain', () => {
    const result = assessReadiness(
      makeBundle({ product: makeProduct({ seo_title: null, seo_description: null }) }),
    );
    expect(result.state).toBe('WARNINGS');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('duplicate detection (spec §40)', () => {
  it('finds duplicate SKUs and handles', () => {
    const report = detectCatalogDuplicates([
      { sku: 'HOKK-SAR-ZK-001', name: 'Amara', handle: 'amara' },
      { sku: 'HOKK-SAR-ZK-001', name: 'Amara 2', handle: 'amara-2' },
      { sku: 'HOKK-SAR-BAL-001', name: 'Bala', handle: 'amara' },
    ]);
    expect(report.duplicateSkus).toEqual(['HOKK-SAR-ZK-001']);
    expect(report.duplicateHandles).toEqual(['amara']);
  });

  it('flags similar names regardless of word order and punctuation', () => {
    const report = detectCatalogDuplicates([
      { sku: 'A', name: 'Zari Kota Saree', handle: 'a' },
      { sku: 'B', name: 'Saree, Zari Kota', handle: 'b' },
    ]);
    expect(report.similarNames).toHaveLength(1);
    expect(report.similarNames[0].skuA).toBe('A');
  });
});
