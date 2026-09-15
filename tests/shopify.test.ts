import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA, LEGACY_SCHEMA, findPreset } from '@/lib/shopify/schema';
import { buildCatalogCsv, buildDescription, buildProductRows, toGrams } from '@/lib/shopify/build';
import { toCsv, parseCsv } from '@/lib/csv';
import { makeBundle, makeImage, makeProduct, makeVariant } from './helpers/product';
import type { BuildOptions, MappedColumn } from '@/lib/shopify/build';

const columnsOf = (preset = CURRENT_SCHEMA): MappedColumn[] =>
  preset.columns.map((column) => ({ key: column.key, column: column.column, level: column.level, enabled: column.enabled }));

const options = (overrides: Partial<BuildOptions> = {}): BuildOptions => ({
  columns: columnsOf(),
  vendor: 'House of Kala Katha',
  defaultStatus: 'draft',
  published: false,
  includeImages: true,
  includeCollectionColumn: false,
  ...overrides,
});

function productInput(overrides: Partial<ReturnType<typeof makeBundle>> = {}) {
  const bundle = makeBundle(overrides);
  return {
    product: bundle.product,
    variants: bundle.variants,
    images: bundle.images.map((img) => ({
      id: img.id,
      sortOrder: img.sort_order,
      altText: img.alt_text,
      isPrimary: img.is_primary,
      slotKey: img.slot_key ?? null,
      publicUrl: img.public_url,
    })),
    collections: bundle.collections.map((c) => c.name),
    category: { name: 'Sarees', shopify_category: 'Apparel & Accessories > Clothing > Traditional', shopify_type: 'Saree' },
    culture: { name: 'Zari Kota' },
  };
}

describe('Shopify schema presets', () => {
  it('uses the current official headers', () => {
    const headers = CURRENT_SCHEMA.columns.map((c) => c.column);
    expect(headers).toContain('URL handle');
    expect(headers).toContain('Description');
    expect(headers).toContain('Price');
    expect(headers).toContain('Product image URL');
    expect(headers).toContain('Published on online store');
    expect(headers).not.toContain('Handle');
    expect(headers).not.toContain('Body (HTML)');
  });

  it('keeps the legacy headers available for tools that still need them', () => {
    const headers = LEGACY_SCHEMA.columns.map((c) => c.column);
    expect(headers).toContain('Handle');
    expect(headers).toContain('Body (HTML)');
    expect(headers).toContain('Variant Price');
    expect(headers).toContain('Image Src');
  });

  it('falls back to the current preset for an unknown key', () => {
    expect(findPreset('does-not-exist').key).toBe(CURRENT_SCHEMA.key);
  });

  it('has unique internal keys', () => {
    const keys = CURRENT_SCHEMA.columns.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('row layout', () => {
  it('emits product fields on the first row only and the handle on every row', () => {
    const { rows, columns } = buildProductRows(productInput(), options());
    // 1 variant row (carrying the first image) + 5 rows for the other images.
    expect(rows).toHaveLength(6);
    expect(rows[0]['Title']).toBe('Amara — Zari Kota');
    expect(rows[0]['URL handle']).toBe('amara-zari-kota');
    expect(columns[0]).toBe('Title');
  });

  it('writes one row per variant plus one row per extra image', () => {
    const input = productInput({
      variants: [
        makeVariant({ id: 'v1', sku: 'V-S', option1_name: 'Size', option1_value: 'S' }),
        makeVariant({ id: 'v2', sku: 'V-M', option1_name: 'Size', option1_value: 'M' }),
        makeVariant({ id: 'v3', sku: 'V-L', option1_name: 'Size', option1_value: 'L' }),
      ],
    });
    // 6 required saree images: 1 rides on row 1, the remaining 5 get their own rows.
    const { rows } = buildProductRows(input, options());
    expect(rows).toHaveLength(3 + 5);
    expect(rows[0]['Title']).toBe('Amara — Zari Kota');
    expect(rows[1]['Title'] ?? '').toBe('');
    expect(rows[1]['URL handle']).toBe('amara-zari-kota');
    expect(rows[1]['SKU']).toBe('V-M');
    expect(rows.every((row) => row['URL handle'] === 'amara-zari-kota')).toBe(true);
  });

  it('writes option names only on the first row, values on every row', () => {
    const input = productInput({
      variants: [
        makeVariant({ id: 'v1', sku: 'V-S', option1_name: 'Size', option1_value: 'S' }),
        makeVariant({ id: 'v2', sku: 'V-M', option1_name: 'Size', option1_value: 'M' }),
      ],
    });
    const { rows } = buildProductRows(input, options());
    expect(rows[0]['Option1 name']).toBe('Size');
    expect(rows[1]['Option1 name']).toBe('');
    expect(rows[1]['Option1 value']).toBe('M');
  });

  it('still emits a single default row when the product has no variants', () => {
    const { rows } = buildProductRows(productInput({ variants: [] }), options());
    expect(rows).toHaveLength(1 + 5);
    expect(rows[0]['SKU']).toBe('HOKK-SAR-ZK-001');
    expect(rows[0]['Option1 value']).toBe('Default Title');
  });
});

describe('column values', () => {
  it('formats prices with two decimals and no currency symbol', () => {
    const { rows } = buildProductRows(productInput(), options());
    expect(rows[0]['Price']).toBe('12500.00');
    expect(rows[0]['Compare-at price']).toBe('15000.00');
    expect(rows[0]['Cost per item']).toBe('6000.00');
  });

  it('maps Shopify booleans to TRUE / FALSE', () => {
    const { rows } = buildProductRows(productInput(), options());
    expect(rows[0]['Charge tax']).toBe('TRUE');
    expect(rows[0]['Requires shipping']).toBe('TRUE');
    expect(rows[0]['Published on online store']).toBe('FALSE');
    expect(rows[0]['Gift card']).toBe('FALSE');
  });

  it('maps inventory policy to DENY / CONTINUE', () => {
    const deny = buildProductRows(productInput(), options());
    expect(deny.rows[0]['Continue selling when out of stock']).toBe('DENY');
    const cont = buildProductRows(
      productInput({ variants: [makeVariant({ inventory_policy: 'continue' })] }),
      options(),
    );
    expect(cont.rows[0]['Continue selling when out of stock']).toBe('CONTINUE');
  });

  it('blanks the inventory tracker when tracking is off', () => {
    // Tracking is per-variant; the default variant mirrors the product setting.
    const { rows } = buildProductRows(
      productInput({
        product: makeProduct({ track_inventory: 0 }),
        variants: [makeVariant({ track_inventory: 0 })],
      }),
      options(),
    );
    expect(rows[0]['Inventory tracker']).toBe('');
    expect(rows[0]['Inventory quantity']).toBe('');
  });

  it('capitalises the Status value', () => {
    const { rows } = buildProductRows(productInput({ product: makeProduct({ shopify_status: 'active' }) }), options());
    expect(rows[0]['Status']).toBe('Active');
  });

  it('merges tags and collections', () => {
    const { rows } = buildProductRows(productInput({ product: makeProduct({ tags: '["festive","zari"]' }) }), options());
    expect(rows[0]['Tags']).toBe('festive, zari, Handloom Stories');
  });

  it('converts weight to grams for Shopify', () => {
    expect(toGrams(0.62, 'kg')).toBe(620);
    expect(toGrams(620, 'g')).toBe(620);
    expect(toGrams(1, 'lb')).toBe(454);
    expect(toGrams(null, 'g')).toBeNull();
    const { rows } = buildProductRows(
      productInput({ variants: [makeVariant({ weight: 0.62, weight_unit: 'kg' })] }),
      options(),
    );
    expect(rows[0]['Weight value (grams)']).toBe(620);
  });

  it('positions images starting at 1 with the primary image first', () => {
    const { rows } = buildProductRows(productInput(), options());
    const positions = rows.map((row) => row['Image position']).filter(Boolean);
    expect(positions[0]).toBe('1');
    expect(positions).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('can add the non-breaking Collection column', () => {
    const { rows, columns } = buildProductRows(productInput(), options({ includeCollectionColumn: true }));
    expect(columns).toContain('Collection');
    expect(rows[0]['Collection']).toBe('Handloom Stories');
  });
});

describe('image URL safety (spec §33)', () => {
  it('writes a blank URL and a warning instead of a local path', () => {
    const bundle = makeBundle();
    const input = productInput({
      images: bundle.images.map((img, index) =>
        index === 0 ? { ...img, public_url: null } : img,
      ),
    });
    const { rows, warnings } = buildProductRows(input, options());
    expect(rows[0]['Product image URL']).toBe('');
    expect(warnings.some((w) => w.includes('no public URL'))).toBe(true);
  });

  it('omits image columns entirely when images are disabled', () => {
    const { rows, columns } = buildProductRows(productInput(), options({ includeImages: false }));
    expect(columns).toContain('Product image URL');
    expect(rows[0]['Product image URL'] ?? '').toBe('');
    // Only the single variant row: no extra image rows are appended.
    expect(rows).toHaveLength(1);
  });
});

describe('description assembly', () => {
  it('composes the separated content fields into HTML sections', () => {
    const html = buildDescription(makeProduct());
    expect(html).toContain('<p>Woven on a pit loom');
    expect(html).toContain('<h3>The Story</h3>');
    expect(html).toContain('<h3>About the Weave</h3>');
    expect(html).toContain('<li>Pure zari border</li>');
    expect(html).toContain('<h3>Care</h3>');
  });

  it('escapes HTML in plain-text fields but preserves authored HTML', () => {
    const escaped = buildDescription(makeProduct({ story: 'Woven <b>carefully</b>' }));
    expect(escaped).toContain('Woven &lt;b&gt;carefully&lt;/b&gt;');
    const authored = buildDescription(makeProduct({ full_description: '<p>Authored</p>', story: null, about_the_weave: null, details: '[]', care: null, about_the_artisan: null }) as never);
    expect(authored).toContain('<p>Authored</p>');
  });
});

describe('full CSV round-trip', () => {
  it('produces a CSV that re-parses to the same shape', () => {
    const built = buildCatalogCsv([productInput()], options());
    const csv = toCsv(built.columns, built.rows, { bom: false });
    const parsed = parseCsv(csv);
    expect(parsed.columns[0]).toBe('Title');
    expect(parsed.rows[0]['URL handle']).toBe('amara-zari-kota');
    expect(parsed.rows[0]['Vendor']).toBe('House of Kala Katha');
    expect(parsed.rows[0]['Product category']).toBe('Apparel & Accessories > Clothing > Traditional');
    expect(parsed.rows[0]['Type']).toBe('Saree');
    expect(parsed.rows[5]['Image position']).toBe('6');
  });

  it('honours a legacy mapping without a code change', () => {
    const built = buildProductRows(productInput(), options({ columns: columnsOf(LEGACY_SCHEMA) }));
    expect(built.columns).toContain('Handle');
    expect(built.columns).toContain('Body (HTML)');
    expect(built.columns).toContain('Variant Price');
    expect(built.rows[0]['Handle']).toBe('amara-zari-kota');
    expect(built.rows[0]['Variant Price']).toBe('12500.00');
    expect(built.rows[0]['Image Src']).toContain('https://');
  });

  it('drops disabled columns from the output', () => {
    const columns = columnsOf().filter((column) => column.key !== 'google_category' && column.enabled);
    const { columns: out } = buildProductRows(productInput(), options({ columns }));
    expect(out).not.toContain('Google Shopping / Google product category');
  });

  it('aggregates warnings across products', () => {
    const bundle = makeBundle();
    const noPublic = productInput({ images: bundle.images.map((img) => ({ ...img, public_url: null })) });
    const built = buildCatalogCsv([productInput(), noPublic], options());
    expect(built.warnings.length).toBeGreaterThan(0);
    expect(built.rows.length).toBe(12);
  });
});

describe('hero image selection', () => {
  it('places the primary image first even if its sort order is higher', () => {
    const bundle = makeBundle();
    const shuffled = [
      makeImage({ id: 'b', slot_key: 'FULL', is_primary: 0, sort_order: 0, public_url: 'https://cdn.example.com/full.jpg' }),
      makeImage({ id: 'a', slot_key: 'HERO', is_primary: 1, sort_order: 5, public_url: 'https://cdn.example.com/hero.jpg' }),
    ];
    const { rows } = buildProductRows(
      productInput({ images: [...shuffled, ...bundle.images.slice(2)] }),
      options(),
    );
    expect(rows[0]['Product image URL']).toBe('https://cdn.example.com/hero.jpg');
  });
});
