/**
 * End-to-end smoke test of the product pipeline against the real database.
 *
 *   npm run e2e
 *
 * Drives the same functions the server actions call — createProduct, updateProduct,
 * storage.put, assessReadiness, runExport — so this exercises shipping code paths,
 * not a re-implementation. It creates its own throwaway category/culture so it can
 * be re-run on a clean or populated database.
 */
import { all, get, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { bundleFor, createProduct, getProduct, recomputeProduct, updateProduct, setProductStatus } from '@/lib/products';
import { computeCompleteness } from '@/lib/completeness';
import { assessReadiness } from '@/lib/readiness';
import { canonicalFileName, validateImageBuffer, buildSlotChecklist } from '@/lib/images';
import { getStorage } from '@/lib/storage';
import { runExport } from '@/lib/export';
import { slugify } from '@/lib/handle';
import { parseCsv } from '@/lib/csv';

const STAMP = Date.now().toString(36);
/** SKU segments are unique per category, so derive a short one per run. */
const SEGMENT = `E${STAMP.slice(-3).toUpperCase()}`;

function step(label: string, value: unknown): void {
  console.log(`  ${label}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
}

async function main(): Promise<void> {
  const admin = get<{ id: string; email: string }>('SELECT id, email FROM "user" ORDER BY created_at LIMIT 1');
  if (!admin) throw new Error('No user found — run `npm run bootstrap` first.');
  console.log(`Acting as ${admin.email}\n`);

  // --- taxonomy -------------------------------------------------------------
  const categoryId = cuid();
  run(
    `INSERT INTO category (id, name, slug, sku_segment, template_key, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'SAREE', 999, ?, ?)`,
    [categoryId, `E2E Category ${STAMP}`, `e2e-${STAMP}`, SEGMENT, nowIso(), nowIso()],
  );
  const cultureId = cuid();
  run(
    `INSERT INTO handloom_culture (id, name, slug, code, region, state, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'E2E', 'E2E', 999, ?, ?)`,
    [cultureId, `E2E Culture ${STAMP}`, `e2e-culture-${STAMP}`, SEGMENT, nowIso(), nowIso()],
  );
  const collectionId = cuid();
  run(
    `INSERT INTO collection (id, name, slug, handle, kind, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'CUSTOMER', 999, ?, ?)`,
    [collectionId, `E2E Collection ${STAMP}`, `e2e-collection-${STAMP}`, `e2e-collection-${STAMP}`, nowIso(), nowIso()],
  );
  console.log('1. Taxonomy created (category, culture, collection)');

  // --- product --------------------------------------------------------------
  const product = createProduct(
    {
      name: `E2E Verification Saree ${STAMP}`,
      categoryId,
      handloomCultureId: cultureId,
      price: 12500,
    },
    admin.id,
  );
  console.log('\n2. Product created');
  step('SKU', product.sku);
  step('status', product.status);
  step('handle', product.handle);
  const expectedSku = new RegExp(`^HOKK-${SEGMENT}-${SEGMENT}-\\d{3}$`);
  if (!expectedSku.test(product.sku)) throw new Error(`Unexpected SKU format: ${product.sku}`);

  // --- fill the mandatory fields --------------------------------------------
  updateProduct(
    product.id,
    {
      short_description: 'A handwoven verification saree used by the automated smoke test.',
      full_description: 'This product exists only to prove the pipeline works end to end.',
      story: 'Woven to verify that nothing reaches Shopify unreviewed.',
      colour: 'Maroon',
      fabric: 'Silk',
      fabric_composition: '100% mulberry silk',
      material: 'Silk',
      weave: 'Handloom plain weave',
      technique: 'Handwoven on a pit loom',
      pattern: 'Striped',
      motifs: 'Temple border',
      border: 'Contrast temple border',
      pallu: 'Traditional pallu',
      region: 'E2E',
      weight: 0.8,
      saree_length: 5.5,
      saree_width: 1.15,
      blouse_included: 1,
      care_instructions: 'Dry clean only.',
      care: 'Dry clean only.',
      about_the_weave: 'Woven on a traditional pit loom over four days.',
      craft_story: 'A verification weave created for the automated pipeline test.',
      artisan_name: 'E2E Weaver',
      measurements: JSON.stringify([
        { label: 'Length', value: '5.5', unit: 'm' },
        { label: 'Width', value: '1.15', unit: 'm' },
        { label: 'Blouse length', value: '0.8', unit: 'm' },
      ]),
      cost_price: 6000,
      seo_title: `E2E Saree ${STAMP}`,
      seo_description: 'Automated verification product for the HOKK product operations pipeline.',
    },
    admin.id,
  );
  run('INSERT INTO product_collection (id, product_id, collection_id, sort_order, created_at) VALUES (?, ?, ?, 1, ?)', [
    cuid(),
    product.id,
    collectionId,
    nowIso(),
  ]);
  console.log('\n3. Content, measurements, pricing and collection filled');

  const afterFill = getProduct(product.id);
  if (!afterFill) throw new Error('Product disappeared after update.');
  step('completeness', `${afterFill.completeness_score}%`);

  // --- readiness before images ----------------------------------------------
  const bundleNoImages = bundleFor(afterFill);
  const readinessNoImages = assessReadiness(bundleNoImages);
  console.log('\n4. Readiness before photography');
  step('state', readinessNoImages.state);
  step('errors', readinessNoImages.issues.filter((i) => i.severity === 'ERROR').length);
  step(
    'sample issue',
    readinessNoImages.issues.find((i) => i.severity === 'ERROR')?.message ?? 'none',
  );
  if (readinessNoImages.state !== 'BLOCKED') {
    throw new Error(`Expected BLOCKED without a hero image, got ${readinessNoImages.state}`);
  }

  // --- upload an image through the real storage adapter ---------------------
  const storage = getStorage();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const requiredSlots = all<{ id: string; key: string; label: string; file_suffix: string }>(
    `SELECT s.id, s.key, s.label, s.file_suffix FROM image_slot_definition s
     JOIN image_slot_template t ON t.id = s.template_id
     WHERE t.key = 'SAREE' AND s.is_required = 1 ORDER BY s.sort_order`,
  );
  if (requiredSlots.length === 0) throw new Error('No required SAREE slots found.');
  step('required slots', requiredSlots.map((slot) => slot.label).join(', '));

  const firstName = canonicalFileName({
    sku: afterFill.sku,
    slotSuffix: requiredSlots[0].file_suffix,
    mimeType: 'image/png',
  });
  step('generated filename', firstName);
  const issues = validateImageBuffer(png, { mimeType: 'image/png', originalName: firstName });
  step('validation issues', issues.length === 0 ? 'none' : issues.map((i) => i.message));

  const uploaded: Array<{ slotId: string; file: Awaited<ReturnType<typeof storage.put>> }> = [];
  for (const slot of requiredSlots) {
    const fileName = canonicalFileName({ sku: afterFill.sku, slotSuffix: slot.file_suffix, mimeType: 'image/png' });
    const file = await storage.put({
      data: png,
      fileName,
      mimeType: 'image/png',
      folder: 'ORIGINAL',
      groupKey: afterFill.sku,
    });
    uploaded.push({ slotId: slot.id, file });
  }
  const file = uploaded[0].file;
  {
    uploaded.forEach((entry, index) => {
      run(
        `INSERT INTO product_image
          (id, product_id, slot_id, file_name, storage_key, path, public_url, mime_type, bytes, width, height,
           folder, alt_text, sort_order, is_primary, review_status, storage_backend, drive_file_id, uploaded_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ORIGINAL', ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?)`,
        [
          cuid(),
          product.id,
          entry.slotId,
          entry.file.fileName,
          entry.file.storageKey,
          entry.file.path,
          entry.file.publicUrl,
          entry.file.mimeType,
          entry.file.bytes,
          1,
          1,
          `${afterFill.name} — image ${index + 1}`,
          index + 1,
          index === 0 ? 1 : 0,
          entry.file.backend,
          entry.file.driveFileId ?? null,
          admin.id,
          nowIso(),
          nowIso(),
        ],
      );
    });
    console.log('\n5. Images uploaded through the storage adapter');
    step('count', uploaded.length);
    // uploadImagesAction calls this after writing rows; the script inserts them
    // directly, so it must refresh the derived caches the same way.
    recomputeProduct(product.id, admin.id);
    step('backend', file.backend);
    step('storageKey', file.storageKey);
    step('publicUrl', file.publicUrl ?? 'null (no public base URL configured)');

    // --- readiness after the image ------------------------------------------
    const bundleWithImage = bundleFor(getProduct(product.id)!);
    const readiness = assessReadiness(bundleWithImage);
    console.log('\n6. Readiness after photography');
    step('state', readiness.state);
    step('score', readiness.score);
    step(
      'errors',
      readiness.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message),
    );
    step(
      'warnings',
      readiness.issues.filter((i) => i.severity === 'WARNING').map((i) => i.message),
    );

    const checklist = buildSlotChecklist(
      all<{ id: string; key: string; label: string; file_suffix: string; is_required: number }>(
        `SELECT s.id, s.key, s.label, s.file_suffix, s.is_required FROM image_slot_definition s
         JOIN image_slot_template t ON t.id = s.template_id WHERE t.key = 'SAREE' ORDER BY s.sort_order`,
      ),
      bundleWithImage.images,
    );
    step(
      'slot checklist',
      checklist.map((c) => `${c.label}=${c.state}`).join(', '),
    );

    // --- workflow gate --------------------------------------------------------
    console.log('\n7. Workflow gate');
    if (readiness.state === 'BLOCKED') {
      step('SHOPIFY_READY reachable', 'no — blocked issues remain');
    } else {
      setProductStatus(product.id, 'SHOPIFY_READY', admin.id, { comment: 'e2e approval' });
      step('SHOPIFY_READY reachable', 'yes — status moved');
      step('status', getProduct(product.id)?.status);
    }

    // --- export ---------------------------------------------------------------
    console.log('\n8. Shopify export');
    const result = runExport(
      {
        mode: 'FULL',
        productIds: [product.id],
        includeImages: true,
        includeCollectionColumn: true,
        includeWarnings: true,
      },
      admin.id,
    );
    step('file', result.fileName);
    step('bytes', result.bytes);
    step('counts', result.counts);
    step('warnings', result.warnings);
    step('blocked', result.blocked.map((b) => `${b.sku}: ${b.issues.map((i) => i.message).join('; ')}`));

    const fs = await import('node:fs');
    const csv = fs.readFileSync(result.filePath, 'utf8');
    const parsed = parseCsv(csv);
    step('csv data rows', parsed.rows.length);
    step('column count', parsed.columns.length);
    step('first 6 headers', parsed.columns.slice(0, 6).join(' | '));
    for (const column of ['Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Product image URL', 'SKU', 'Price', 'SEO title']) {
      if (!parsed.columns.includes(column)) throw new Error(`Expected Shopify column missing: ${column}`);
    }
    step('all expected Shopify columns present', true);

    const first = parsed.rows[0];
    step('row 1 Title', first.Title);
    step('row 1 URL handle', first['URL handle']);
    step('row 1 SKU', first.SKU);
    step('row 1 Price', first.Price);
    step('row 1 Status', first.Status);
    step('row 1 image URL', first['Product image URL'] === '' ? '(blank — no public URL)' : first['Product image URL']);
    if (first.SKU !== afterFill.sku) throw new Error(`CSV SKU ${first.SKU} != ${afterFill.sku}`);
    if (first['URL handle'] !== afterFill.handle) throw new Error('CSV handle does not match the product handle.');

    const imageRows = parsed.rows.filter((row) => row['Product image URL'] !== undefined && row['Product image URL'] !== '');
    step('rows carrying an image URL', imageRows.length);
    const positions = parsed.rows.map((row) => row['Image position']).filter(Boolean);
    step('image positions', positions.join(', '));

    // --- completeness of the final product ------------------------------------
    const finalProduct = getProduct(product.id)!;
    const completeness = computeCompleteness(bundleFor(finalProduct));
    console.log('\n9. Final state');
    step('completeness', `${completeness.score}%`);
    step('readiness_state', finalProduct.readiness_state);
    step('status', finalProduct.status);
    step('handle', finalProduct.handle);
    step('handle is slugified', finalProduct.handle === slugify(finalProduct.name ?? ''));

    const auditCount = get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?', [product.id])?.n ?? 0;
    step('audit entries for this product', auditCount);
    if (auditCount === 0) throw new Error('No audit entries were written.');

    const exports = get<{ n: number }>('SELECT COUNT(*) AS n FROM export_run')?.n ?? 0;
    step('export runs recorded', exports);

    if (process.env.E2E_KEEP !== '1') {
      for (const table of ['product_image', 'variant', 'product_collection', 'product_attribute_value', 'product_gap', 'product_snapshot', 'product_review', 'comment', 'assignment']) {
        run(`DELETE FROM ${table} WHERE product_id = ?`, [product.id]);
      }
      run('DELETE FROM audit_log WHERE entity_id = ?', [product.id]);
      run('DELETE FROM product WHERE id = ?', [product.id]);
      run('DELETE FROM export_run_product WHERE export_id = ?', [result.exportId]);
      // The export writes its own audit row keyed by the export run id, not the
      // product id, so clearing only the product's rows leaves it behind.
      run('DELETE FROM audit_log WHERE entity_id = ?', [result.exportId]);
      run('DELETE FROM export_run WHERE id = ?', [result.exportId]);
      run('DELETE FROM collection WHERE id = ?', [collectionId]);
      run('DELETE FROM category WHERE id = ?', [categoryId]);
      run('DELETE FROM handloom_culture WHERE id = ?', [cultureId]);
      console.log('\n(cleaned up test data — set E2E_KEEP=1 to retain it)');
    }

    console.log('\nE2E PASS');
    console.log(`Product: ${finalProduct.sku} (${finalProduct.id})`);
    console.log(`Export file: ${result.filePath}`);
  }
}

void main();
