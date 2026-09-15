/**
 * Shopify product CSV schemas.
 *
 * The column list is DATA, not code: every column is a row in
 * `shopify_field_mapping` so an administrator can rename, reorder, enable or
 * disable columns from Settings → Shopify without a deploy. If Shopify revises
 * the template again, a new preset is added here (or edited in the UI) and the
 * export follows it.
 *
 * Preset `shopify-product-csv` was verified against Shopify's official sample
 * template (help.shopify.com/csv/product_template.csv) on 2026-09-15 and uses
 * the current headers: "URL handle", "Description", "Price", "Product image
 * URL", "Published on online store". The `legacy` preset keeps the older
 * "Handle" / "Body (HTML)" / "Variant Price" / "Image Src" headers that most
 * third-party tools still emit.
 */

export interface ShopifyColumnDefinition {
  key: string;
  column: string;
  level: 'PRODUCT' | 'VARIANT' | 'IMAGE';
  section: 'CORE' | 'OPTIONS' | 'PRICING' | 'INVENTORY' | 'SHIPPING' | 'IMAGES' | 'SEO' | 'GOOGLE' | 'META';
  enabled: boolean;
  required?: boolean;
  notes?: string;
}

export interface ShopifySchemaPreset {
  key: string;
  name: string;
  version: string;
  description: string;
  columns: ShopifyColumnDefinition[];
}

const c = (
  key: string,
  column: string,
  level: ShopifyColumnDefinition['level'],
  section: ShopifyColumnDefinition['section'],
  enabled = true,
  required = false,
  notes?: string,
): ShopifyColumnDefinition => ({ key, column, level, section, enabled, required, notes });

export const CURRENT_SCHEMA: ShopifySchemaPreset = {
  key: 'shopify-product-csv',
  name: 'Shopify product CSV (current)',
  version: '2025-template',
  description:
    'Matches the official Shopify sample product template. Uses "URL handle", "Description", "Price" and "Product image URL".',
  columns: [
    c('title', 'Title', 'PRODUCT', 'CORE', true, true, 'Required for new products. First row only.'),
    c('url_handle', 'URL handle', 'PRODUCT', 'CORE', true, true, 'Required when the product has variants. Present on every row.'),
    c('description', 'Description', 'PRODUCT', 'CORE', true, false, 'HTML allowed. First row only.'),
    c('vendor', 'Vendor', 'PRODUCT', 'CORE', true),
    c('product_category', 'Product category', 'PRODUCT', 'CORE', true, false, 'Shopify product taxonomy path.'),
    c('type', 'Type', 'PRODUCT', 'CORE', true),
    c('tags', 'Tags', 'PRODUCT', 'CORE', true),
    c('published_online_store', 'Published on online store', 'PRODUCT', 'CORE', true, false, 'TRUE / FALSE.'),
    c('status', 'Status', 'PRODUCT', 'CORE', true, false, 'Active / Draft / Archived.'),

    c('variant_sku', 'SKU', 'VARIANT', 'CORE', true),
    c('variant_barcode', 'Barcode', 'VARIANT', 'CORE', true),

    c('option1_name', 'Option1 name', 'VARIANT', 'OPTIONS', true, false, 'Option names are only written on the first row.'),
    c('option1_value', 'Option1 value', 'VARIANT', 'OPTIONS', true),
    c('option1_linked_to', 'Option1 Linked To', 'VARIANT', 'OPTIONS', false),
    c('option2_name', 'Option2 name', 'VARIANT', 'OPTIONS', true),
    c('option2_value', 'Option2 value', 'VARIANT', 'OPTIONS', true),
    c('option2_linked_to', 'Option2 Linked To', 'VARIANT', 'OPTIONS', false),
    c('option3_name', 'Option3 name', 'VARIANT', 'OPTIONS', true),
    c('option3_value', 'Option3 value', 'VARIANT', 'OPTIONS', true),
    c('option3_linked_to', 'Option3 Linked To', 'VARIANT', 'OPTIONS', false),

    c('price', 'Price', 'VARIANT', 'PRICING', true, false, 'Plain number, no currency symbol.'),
    c('compare_at_price', 'Compare-at price', 'VARIANT', 'PRICING', true),
    c('cost_per_item', 'Cost per item', 'VARIANT', 'PRICING', true),
    c('charge_tax', 'Charge tax', 'VARIANT', 'PRICING', true, false, 'TRUE / FALSE.'),
    c('tax_code', 'Tax code', 'VARIANT', 'PRICING', true),
    c('unit_price_total_measure', 'Unit price total measure', 'VARIANT', 'PRICING', false),
    c('unit_price_total_measure_unit', 'Unit price total measure unit', 'VARIANT', 'PRICING', false),
    c('unit_price_base_measure', 'Unit price base measure', 'VARIANT', 'PRICING', false),
    c('unit_price_base_measure_unit', 'Unit price base measure unit', 'VARIANT', 'PRICING', false),

    c('inventory_tracker', 'Inventory tracker', 'VARIANT', 'INVENTORY', true, false, '"shopify" to track, blank to skip.'),
    c('inventory_quantity', 'Inventory quantity', 'VARIANT', 'INVENTORY', true, false, 'Single-location stores only.'),
    c('continue_selling', 'Continue selling when out of stock', 'VARIANT', 'INVENTORY', true, false, 'DENY / CONTINUE.'),

    c('weight_value', 'Weight value (grams)', 'VARIANT', 'SHIPPING', true),
    c('weight_unit', 'Weight unit for display', 'VARIANT', 'SHIPPING', true),
    c('requires_shipping', 'Requires shipping', 'VARIANT', 'SHIPPING', true, false, 'TRUE / FALSE.'),
    c('fulfillment_service', 'Fulfillment service', 'VARIANT', 'SHIPPING', true, false, 'Usually "manual".'),

    c('image_src', 'Product image URL', 'IMAGE', 'IMAGES', true, false, 'Must be a publicly reachable https:// URL.'),
    c('image_position', 'Image position', 'IMAGE', 'IMAGES', true, false, '1 = featured image.'),
    c('image_alt', 'Image alt text', 'IMAGE', 'IMAGES', true),
    c('variant_image', 'Variant image URL', 'VARIANT', 'IMAGES', true),

    c('gift_card', 'Gift card', 'PRODUCT', 'CORE', true, false, 'FALSE for physical goods.'),
    c('seo_title', 'SEO title', 'PRODUCT', 'SEO', true),
    c('seo_description', 'SEO description', 'PRODUCT', 'SEO', true, false, 'Keep under 320 characters.'),

    c('color_metafield', 'Color (product.metafields.shopify.color-pattern)', 'PRODUCT', 'META', false),
    c('google_category', 'Google Shopping / Google product category', 'PRODUCT', 'GOOGLE', false),
    c('google_gender', 'Google Shopping / Gender', 'PRODUCT', 'GOOGLE', false),
    c('google_age_group', 'Google Shopping / Age group', 'PRODUCT', 'GOOGLE', false),
    c('google_mpn', 'Google Shopping / Manufacturer part number (MPN)', 'PRODUCT', 'GOOGLE', false),
    c('google_ad_group', 'Google Shopping / Ad group name', 'PRODUCT', 'GOOGLE', false),
    c('google_ads_labels', 'Google Shopping / Ads labels', 'PRODUCT', 'GOOGLE', false),
    c('google_condition', 'Google Shopping / Condition', 'PRODUCT', 'GOOGLE', false),
    c('google_custom_product', 'Google Shopping / Custom product', 'PRODUCT', 'GOOGLE', false),
    c('google_label_0', 'Google Shopping / Custom label 0', 'PRODUCT', 'GOOGLE', false),
    c('google_label_1', 'Google Shopping / Custom label 1', 'PRODUCT', 'GOOGLE', false),
    c('google_label_2', 'Google Shopping / Custom label 2', 'PRODUCT', 'GOOGLE', false),
    c('google_label_3', 'Google Shopping / Custom label 3', 'PRODUCT', 'GOOGLE', false),
    c('google_label_4', 'Google Shopping / Custom label 4', 'PRODUCT', 'GOOGLE', false),
  ],
};

export const LEGACY_SCHEMA: ShopifySchemaPreset = {
  key: 'shopify-product-csv-legacy',
  name: 'Shopify product CSV (legacy headers)',
  version: '2023-template',
  description:
    'Older header names still accepted by the Shopify importer: "Handle", "Body (HTML)", "Variant Price", "Image Src".',
  columns: [
    c('url_handle', 'Handle', 'PRODUCT', 'CORE', true, true),
    c('title', 'Title', 'PRODUCT', 'CORE', true, true),
    c('description', 'Body (HTML)', 'PRODUCT', 'CORE', true),
    c('vendor', 'Vendor', 'PRODUCT', 'CORE', true),
    c('product_category', 'Product Category', 'PRODUCT', 'CORE', true),
    c('type', 'Type', 'PRODUCT', 'CORE', true),
    c('tags', 'Tags', 'PRODUCT', 'CORE', true),
    c('published_online_store', 'Published', 'PRODUCT', 'CORE', true),
    c('status', 'Status', 'PRODUCT', 'CORE', true),

    c('option1_name', 'Option1 Name', 'VARIANT', 'OPTIONS', true),
    c('option1_value', 'Option1 Value', 'VARIANT', 'OPTIONS', true),
    c('option2_name', 'Option2 Name', 'VARIANT', 'OPTIONS', true),
    c('option2_value', 'Option2 Value', 'VARIANT', 'OPTIONS', true),
    c('option3_name', 'Option3 Name', 'VARIANT', 'OPTIONS', true),
    c('option3_value', 'Option3 Value', 'VARIANT', 'OPTIONS', true),

    c('variant_sku', 'Variant SKU', 'VARIANT', 'CORE', true),
    c('weight_value', 'Variant Grams', 'VARIANT', 'SHIPPING', true),
    c('inventory_tracker', 'Variant Inventory Tracker', 'VARIANT', 'INVENTORY', true),
    c('inventory_quantity', 'Variant Inventory Qty', 'VARIANT', 'INVENTORY', true),
    c('continue_selling', 'Variant Inventory Policy', 'VARIANT', 'INVENTORY', true),
    c('fulfillment_service', 'Variant Fulfillment Service', 'VARIANT', 'SHIPPING', true),
    c('price', 'Variant Price', 'VARIANT', 'PRICING', true),
    c('compare_at_price', 'Variant Compare At Price', 'VARIANT', 'PRICING', true),
    c('requires_shipping', 'Variant Requires Shipping', 'VARIANT', 'SHIPPING', true),
    c('charge_tax', 'Variant Taxable', 'VARIANT', 'PRICING', true),
    c('variant_barcode', 'Variant Barcode', 'VARIANT', 'CORE', true),
    c('cost_per_item', 'Cost per item', 'VARIANT', 'PRICING', true),
    c('weight_unit', 'Variant Weight Unit', 'VARIANT', 'SHIPPING', true),
    c('tax_code', 'Variant Tax Code', 'VARIANT', 'PRICING', true),

    c('image_src', 'Image Src', 'IMAGE', 'IMAGES', true),
    c('image_position', 'Image Position', 'IMAGE', 'IMAGES', true),
    c('image_alt', 'Image Alt Text', 'IMAGE', 'IMAGES', true),
    c('variant_image', 'Variant Image', 'VARIANT', 'IMAGES', true),

    c('gift_card', 'Gift Card', 'PRODUCT', 'CORE', true),
    c('seo_title', 'SEO Title', 'PRODUCT', 'SEO', true),
    c('seo_description', 'SEO Description', 'PRODUCT', 'SEO', true),
    c('google_category', 'Google Shopping / Google Product Category', 'PRODUCT', 'GOOGLE', false),
    c('google_gender', 'Google Shopping / Gender', 'PRODUCT', 'GOOGLE', false),
    c('google_age_group', 'Google Shopping / Age Group', 'PRODUCT', 'GOOGLE', false),
    c('google_condition', 'Google Shopping / Condition', 'PRODUCT', 'GOOGLE', false),
    c('google_custom_product', 'Google Shopping / Custom Product', 'PRODUCT', 'GOOGLE', false),
  ],
};

export const SCHEMA_PRESETS: ShopifySchemaPreset[] = [CURRENT_SCHEMA, LEGACY_SCHEMA];

export function findPreset(key: string): ShopifySchemaPreset {
  return SCHEMA_PRESETS.find((preset) => preset.key === key) ?? CURRENT_SCHEMA;
}

/** Optional extra column documented by Shopify as non-breaking. */
export const COLLECTION_COLUMN = 'Collection';
