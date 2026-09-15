'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { applyImport, buildPreview, detectMapping } from '@/lib/importer';
import { getStagedPreview, releaseStagedImport, stageImport, takeStagedImport } from '@/lib/import-staging';
import { json, run } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import type { ExportMode } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  /** Populated on upload so the page can show the detected preview. */
  previewId?: string;
}

const MAX_BYTES = 15 * 1024 * 1024; // Shopify's documented import limit

export async function stageImportAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('import.run');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose a CSV file.' };
    if (file.size > MAX_BYTES) return { ok: false, error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — Shopify allows up to 15 MB.` };
    if (!/\.csv$/i.test(file.name)) return { ok: false, error: 'Only CSV files are supported.' };

    const text = await file.text();
    if (!text.trim()) return { ok: false, error: 'The file is empty.' };

    const mode = ((String(formData.get('mode') ?? 'NEW') || 'NEW').toUpperCase()) as ExportMode;
    const preview = buildPreview(text, {}, mode);
    const mapping = detectMapping(preview.columns);
    if (Object.keys(mapping).length === 0) {
      return { ok: false, error: 'No recognisable header row found. The first row must contain the column names.' };
    }

    const id = cuid();
    stageImport(id, { text, mapping, mode, userId: user.id, createdAt: Date.now() });

    run(
      `INSERT INTO import_run (id, file_name, status, row_count, column_mapping, detected_columns, header_row, user_id, created_at, updated_at)
       VALUES (?, ?, 'UPLOADED', ?, ?, ?, 1, ?, ?, ?)`,
      [id, file.name, preview.rows.length, json(mapping), json(preview.columns), user.id, nowIso(), nowIso()],
    );

    revalidatePath('/imports');
    redirect(`/imports?preview=${id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('NEXT_REDIRECT')) throw error;
    return { ok: false, error: message };
  }
}

export async function runImportAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('import.run');
    const id = String(formData.get('preview_id') ?? '');
    const entry = takeStagedImport(id);
    if (!entry) return { ok: false, error: 'This preview expired. Upload the file again.' };

    // Column mapping can be corrected between preview and import.
    const mapping: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('map:')) continue;
      const column = String(value ?? '').trim();
      if (column) mapping[key.slice('map:'.length)] = column;
    }
    const finalMapping = Object.keys(mapping).length > 0 ? mapping : entry.mapping;
    const skipDuplicates = formData.get('skip_duplicates') === '1';

    const result = applyImport(entry.text, finalMapping, entry.mode, user.id, skipDuplicates);
    releaseStagedImport(id);
    run('UPDATE import_run SET status = ?, imported_count = ?, skipped_count = ?, failed_count = ?, duplicate_count = ?, column_mapping = ?, updated_at = ? WHERE id = ?', [
      'COMPLETED',
      result.imported,
      result.skipped,
      result.failed,
      result.duplicates,
      json(finalMapping),
      nowIso(),
      id,
    ]);

    revalidatePath('/imports');
    revalidatePath('/products');
    revalidatePath('/dashboard');
    return {
      ok: true,
      message: `Imported ${result.imported}, skipped ${result.skipped} (${result.duplicates} flagged as potential duplicates).`,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

