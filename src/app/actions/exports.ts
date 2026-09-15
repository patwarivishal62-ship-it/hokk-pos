'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth';
import { runExport } from '@/lib/export';
import type { ExportMode } from '@/lib/types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
}

export async function runExportAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('export.run');
    const mode = (String(formData.get('mode') ?? 'FULL') || 'FULL').toUpperCase() as ExportMode;
    const ids = String(formData.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const result = runExport(
      {
        mode,
        productIds: ids.length > 0 ? ids : undefined,
        includeImages: formData.get('include_images') !== '0',
        includeCollectionColumn: formData.get('include_collections') === '1',
        includeWarnings: formData.get('include_warnings') === '1',
      },
      user.id,
    );
    revalidatePath('/exports');
    revalidatePath('/dashboard');
    redirect(`/exports/${result.exportId}`);
  } catch (error) {
    const message = (error as Error).message ?? 'Export failed.';
    if (message.startsWith('NEXT_REDIRECT')) throw error;
    return { ok: false, error: message };
  }
}
