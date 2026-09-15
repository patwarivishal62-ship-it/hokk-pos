import { describe, expect, it } from 'vitest';
import { computeCompleteness, isHandloomProduct, photographyCounters } from '@/lib/completeness';
import { makeAttribute, makeBundle, makeProduct, sareeImages, sareeSlots } from './helpers/product';

describe('completeness engine (spec §7)', () => {
  it('scores a fully-populated saree at 100%', () => {
    const result = computeCompleteness(makeBundle());
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it('reports a low score for a bare product', () => {
    const bare = makeProduct({
      name: null,
      fabric: null,
      fabric_composition: null,
      weave: null,
      technique: null,
      colour: null,
      border: null,
      pallu: null,
      pattern: null,
      motifs: null,
      saree_length: null,
      saree_width: null,
      blouse_included: null,
      care_instructions: null,
      short_description: null,
      full_description: null,
      story: null,
      about_the_weave: null,
      care: null,
      seo_title: null,
      seo_description: null,
      handle: null,
      price: null,
      yarn: null,
      zari_type: null,
      dyeing_method: null,
      craft_story: null,
      artisan_name: null,
      name_status: 'NOT_NAMED',
    });
    const result = computeCompleteness(makeBundle({ product: bare, images: [], variants: [], collections: [] }));
    expect(result.score).toBeLessThan(30);
    const labels = result.missing.map((m) => m.label);
    expect(labels).toContain('Product name');
    expect(labels).toContain('Pallu');
    expect(labels).toContain('The story');
    expect(labels).toContain('Artisan / weaver');
    expect(labels).toContain('Hero / model');
  });

  it('only applies saree-specific fields to saree products', () => {
    const apparel = makeProduct({
      template_key: 'APPAREL',
      fit: 'Regular',
      neckline: 'Crew',
      sleeve: 'Short',
      garment_length: 'Hip',
      size_guide_id: 'sg-1',
      handloom_culture_id: null,
    });
    const result = computeCompleteness(makeBundle({ product: apparel }));
    const fields = result.missing.map((m) => m.field);
    expect(fields).not.toContain('saree_length');
    expect(fields).not.toContain('pallu');
    expect(result.bySection.HANDLOOM.total).toBe(0);
  });

  it('counts an explicit MISSING — INFORMATION REQUIRED flag as absent', () => {
    const flagged = makeBundle({
      attributes: [makeAttribute({ value: 'Pure zari', is_missing: 1 })],
    });
    const result = computeCompleteness(flagged);
    expect(result.score).toBeLessThan(100);
    expect(result.missing.map((m) => m.field)).toContain('attr:zari_purity');
  });

  it('counts a declared gap even when the automatic check passes', () => {
    const result = computeCompleteness(
      makeBundle({
        gaps: [{ field_key: 'weaver_verification', label: 'Weaver verification', severity: 'REQUIRED', status: 'OPEN', section: 'HANDLOOM' }],
      }),
    );
    expect(result.missing.map((m) => m.label)).toContain('Weaver verification');
  });

  it('ignores resolved gaps', () => {
    const result = computeCompleteness(
      makeBundle({
        gaps: [{ field_key: 'weaver_verification', label: 'Weaver verification', severity: 'REQUIRED', status: 'RESOLVED', section: 'HANDLOOM' }],
      }),
    );
    expect(result.score).toBe(100);
  });

  it('requires a size guide for apparel but not for sarees', () => {
    const apparel = makeProduct({ template_key: 'APPAREL', fit: 'Regular', neckline: 'Crew', sleeve: 'Short', garment_length: 'Hip' });
    const withoutGuide = computeCompleteness(makeBundle({ product: apparel }));
    expect(withoutGuide.missing.map((m) => m.field)).toContain('size_guide_id');

    const saree = computeCompleteness(makeBundle());
    expect(saree.missing.map((m) => m.field)).not.toContain('size_guide_id');
  });

  it('treats "blouse included = no" as answered', () => {
    const result = computeCompleteness(makeBundle({ product: makeProduct({ blouse_included: 0 }) }));
    expect(result.missing.map((m) => m.field)).not.toContain('blouse_included');
  });
});

describe('photographyCounters', () => {
  it('counts required slots only', () => {
    const slots = sareeSlots();
    const all = sareeImages();
    expect(photographyCounters({ slots, images: all })).toEqual({ complete: 6, required: 6 });

    const withoutPallu = all.filter((img) => img.slot_key !== 'PALLU');
    expect(photographyCounters({ slots, images: withoutPallu })).toEqual({ complete: 5, required: 6 });
  });
});

describe('isHandloomProduct', () => {
  it('is driven by the category template, not the product name', () => {
    expect(isHandloomProduct(makeProduct({ template_key: 'SAREE' }))).toBe(true);
    expect(isHandloomProduct(makeProduct({ template_key: 'APPAREL' }))).toBe(false);
    expect(isHandloomProduct(makeProduct({ template_key: null as unknown as string }))).toBe(false);
  });
});
