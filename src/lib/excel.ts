/**
 * Internal operations workbook (spec §38).
 *
 * This is NOT the Shopify import file — it is a human-readable multi-sheet
 * workbook for the HOKK team, generated with exceljs.
 */
import 'server-only';
import ExcelJS from 'exceljs';
import { all } from '@/lib/db';
import { parseJson } from '@/lib/db';
import type { ProductRow } from '@/lib/types';

export async function buildOperationsWorkbook(productIds?: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HOKK Product Operations System';
  workbook.created = new Date();

  const where = productIds && productIds.length > 0 ? `WHERE p.id IN (${productIds.map(() => '?').join(',')})` : '';
  const params = productIds ?? [];

  const products = all<ProductRow>(
    `SELECT p.*, c.name AS category_name, hc.name AS culture_name, u.name AS assignee_name
     FROM product p
     LEFT JOIN category c ON c.id = p.category_id
     LEFT JOIN handloom_culture hc ON hc.id = p.handloom_culture_id
     LEFT JOIN "user" u ON u.id = p.assignee_id
     ${where}
     ORDER BY p.sku`,
    params,
  );

  addSheet(workbook, 'PRODUCTS', {
    columns: [
      'SKU', 'Name', 'Status', 'Readiness', 'Complete %', 'Category', 'Culture', 'Colour', 'Fabric',
      'Price', 'Currency', 'Compare-at', 'Cost', 'Handle', 'SEO title', 'Assigned to', 'Created', 'Updated',
    ],
    rows: products.map((product) => [
      product.sku,
      product.name ?? '',
      product.status,
      product.readiness_state,
      product.completeness_score,
      product.category_name ?? '',
      product.culture_name ?? '',
      product.colour ?? '',
      product.fabric ?? '',
      product.price ?? '',
      product.currency,
      product.compare_at_price ?? '',
      product.cost_price ?? '',
      product.handle ?? '',
      product.seo_title ?? '',
      product.assignee_name ?? '',
      product.created_at,
      product.updated_at,
    ]),
  });

  const variants = all<ExcelVariant>(
    `SELECT v.* FROM variant v JOIN product p ON p.id = v.product_id ${where} ORDER BY p.sku, v.position`,
    params,
  );
  addSheet(workbook, 'VARIANTS', {
    columns: ['SKU', 'Product', 'Option1', 'Option2', 'Option3', 'Price', 'Compare-at', 'Cost', 'Inventory', 'Weight', 'Barcode'],
    rows: variants.map((variant) => [
      variant.sku ?? '',
      productSku(products, String(variant.product_id)),
      `${variant.option1_name ?? ''}: ${variant.option1_value ?? ''}`,
      `${variant.option2_name ?? ''}: ${variant.option2_value ?? ''}`,
      `${variant.option3_name ?? ''}: ${variant.option3_value ?? ''}`,
      variant.price ?? '',
      variant.compare_at_price ?? '',
      variant.cost_price ?? '',
      variant.inventory_qty ?? '',
      `${variant.weight ?? ''} ${variant.weight_unit ?? ''}`.trim(),
      variant.barcode ?? '',
    ]),
  });

  const images = all<ExcelImage>(
    `SELECT pi.*, p.sku AS product_sku, s.label AS slot_label FROM product_image pi
     JOIN product p ON p.id = pi.product_id
     LEFT JOIN image_slot_definition s ON s.id = pi.slot_id
     ${where}
     ORDER BY p.sku, pi.sort_order`,
    params,
  );
  addSheet(workbook, 'IMAGES', {
    columns: ['Product SKU', 'File name', 'Slot', 'Folder', 'Alt text', 'Primary', 'Review', 'Public URL', 'Size (bytes)'],
    rows: images.map((image) => [
      image.product_sku,
      image.file_name,
      image.slot_label ?? '',
      image.folder,
      image.alt_text ?? '',
      image.is_primary === 1 ? 'Yes' : 'No',
      image.review_status,
      image.public_url ?? '',
      image.bytes ?? '',
    ]),
  });

  const collections = all<{ name: string; handle: string; kind: string; product_count: number }>(
    `SELECT c.name, c.handle, c.kind, COUNT(pc.product_id) AS product_count
     FROM collection c LEFT JOIN product_collection pc ON pc.collection_id = c.id
     GROUP BY c.id ORDER BY c.sort_order, c.name`,
  );
  addSheet(workbook, 'COLLECTIONS', {
    columns: ['Name', 'Handle', 'Kind', 'Products'],
    rows: collections.map((collection) => [collection.name, collection.handle, collection.kind, collection.product_count]),
  });

  const guides = all<{ id: string; name: string; unit: string; applies_to: string }>(
    'SELECT id, name, unit, applies_to FROM size_guide WHERE is_archived = 0 ORDER BY name',
  );
  const guideRows: Array<Array<string | number>> = [];
  for (const guide of guides) {
    const columns = all<{ id: string; label: string }>(
      'SELECT id, label FROM size_guide_column WHERE size_guide_id = ? ORDER BY sort_order',
      [guide.id],
    );
    const rows = all<{ id: string; size_label: string }>(
      'SELECT id, size_label FROM size_guide_row WHERE size_guide_id = ? ORDER BY sort_order',
      [guide.id],
    );
    const cells = all<{ row_id: string; column_id: string; value: string }>(
      'SELECT row_id, column_id, value FROM size_guide_cell WHERE row_id IN (SELECT id FROM size_guide_row WHERE size_guide_id = ?)',
      [guide.id],
    );
    if (rows.length === 0) continue;
    guideRows.push([guide.name, '', ...columns.map((column) => `${column.label} (${guide.unit})`)]);
    for (const row of rows) {
      guideRows.push([
        '',
        row.size_label,
        ...columns.map((column) => cells.find((cell) => cell.row_id === row.id && cell.column_id === column.id)?.value ?? ''),
      ]);
    }
    guideRows.push(['']);
  }
  addSheet(workbook, 'SIZE GUIDES', { columns: ['Guide', 'Size', 'Measurement'], rows: guideRows });

  addSheet(workbook, 'PRODUCT STORIES', {
    columns: ['SKU', 'Name', 'Short description', 'Full description', 'The story', 'About the weave', 'About the artisan', 'Details', 'Care'],
    rows: products.map((product) => [
      product.sku,
      product.name ?? '',
      product.short_description ?? '',
      product.full_description ?? '',
      product.story ?? '',
      product.about_the_weave ?? '',
      product.about_the_artisan ?? '',
      parseJson<string[]>(product.details, []).join('\n'),
      product.care ?? product.care_instructions ?? '',
    ]),
  });

  const audit = all<{ created_at: string; action: string; entity_label: string | null; user_name: string | null; changes: string }>(
    `SELECT a.created_at, a.action, a.entity_label, u.name AS user_name, a.changes
     FROM audit_log a LEFT JOIN "user" u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT 2000`,
  );
  addSheet(workbook, 'AUDIT & EXPORT LOG', {
    columns: ['When', 'Action', 'Entity', 'User', 'Changes'],
    rows: audit.map((entry) => [
      entry.created_at,
      entry.action,
      entry.entity_label ?? '',
      entry.user_name ?? 'System',
      parseJson<Array<{ label: string; oldValue: unknown; newValue: unknown }>>(entry.changes, [])
        .map((change) => `${change.label}: ${String(change.oldValue ?? 'empty')} → ${String(change.newValue ?? 'empty')}`)
        .join(' | '),
    ]),
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

interface ExcelVariant {
  id: string;
  product_id: string;
  sku: string | null;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  price: number | null;
  compare_at_price: number | null;
  cost_price: number | null;
  inventory_qty: number | null;
  weight: number | null;
  weight_unit: string | null;
  barcode: string | null;
  position: number;
}

interface ExcelImage {
  id: string;
  file_name: string;
  folder: string;
  alt_text: string | null;
  is_primary: number;
  review_status: string;
  public_url: string | null;
  bytes: number | null;
  product_sku: string;
  slot_label: string | null;
}

function productSku(products: ProductRow[], productId: string): string {
  return products.find((product) => product.id === productId)?.sku ?? productId;
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  definition: { columns: string[]; rows: Array<Array<string | number>> },
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = definition.columns.map((title) => ({ header: title, key: title, width: Math.min(48, Math.max(12, title.length + 4)) }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of definition.rows) sheet.addRow(row);
}
