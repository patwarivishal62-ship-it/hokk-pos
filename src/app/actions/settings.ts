'use server';

import { revalidatePath } from 'next/cache';
import { all, get, run, transaction } from '@/lib/db';
import { cuid, nowIso } from '@/lib/id';
import { requirePermission } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getSetting, setSetting } from '@/lib/settings';
import { findPreset } from '@/lib/shopify/schema';

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const NUMERIC_KEYS = new Set([
  'sku.sequence.padding',
  'images.max.bytes',
  'images.min.bytes',
  'images.min.width',
  'images.min.height',
  'images.recommend.bytes',
]);

export async function saveSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('settings.manage');
    const changes: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }> = [];

    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('setting:')) continue;
      const settingKey = key.slice('setting:'.length);
      const next = String(value ?? '').trim();
      const previous = getSetting(settingKey);
      if (next === '' ) continue;
      if (NUMERIC_KEYS.has(settingKey) && Number.isNaN(Number(next))) {
        return { ok: false, error: `${settingKey} must be a number.` };
      }
      if (previous !== next) {
        setSetting(settingKey, next);
        changes.push({ field: settingKey, label: settingKey, oldValue: previous ?? null, newValue: next });
      }
    }

    // Checkboxes arrive only when ticked; explicit 0/1 fields keep booleans honest.
    for (const key of ['shopify.published', 'shopify.include.google_columns', 'shopify.collection_column', 'workflow.allow_export_warnings']) {
      const next = formData.get(`setting:${key}`) === '1' ? '1' : '0';
      const previous = getSetting(key);
      if (previous !== next) {
        setSetting(key, next);
        changes.push({ field: key, label: key, oldValue: previous ?? null, newValue: next });
      }
    }

    if (changes.length > 0) {
      logAudit({ entityType: 'SETTING', entityId: 'settings', entityLabel: 'Settings', action: 'EDIT', userId: user.id, changes });
    }
    revalidatePath('/settings');
    revalidatePath('/dashboard');
    return { ok: true, message: changes.length > 0 ? `${changes.length} setting(s) saved.` : 'No changes.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function applyShopifyPresetAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('export.configure');
    const presetKey = String(formData.get('preset') ?? '');
    const preset = findPreset(presetKey);
    if (!preset) return { ok: false, error: 'Unknown Shopify schema preset.' };

    transaction(() => {
      run('DELETE FROM shopify_field_mapping');
      preset.columns.forEach((column, index) => {
        run(
          'INSERT INTO shopify_field_mapping (id, schema_key, column, level, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          [cuid(), preset.key, column.column, column.level, column.enabled ? 1 : 0, index + 1],
        );
      });
    });
    setSetting('shopify.schema_key', preset.key);
    setSetting('shopify.schema_version', preset.version);

    logAudit({
      entityType: 'SHOPIFY_MAPPING',
      entityId: preset.key,
      entityLabel: preset.name,
      action: 'CONFIGURE',
      userId: user.id,
      changes: [{ field: 'schema', label: 'Shopify schema', oldValue: null, newValue: `${preset.key} ${preset.version}` }],
    });
    revalidatePath('/settings');
    return { ok: true, message: `Applied ${preset.name} (${preset.version}).` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function updateMappingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission('export.configure');
    const rows = all<{ id: string; column: string; level: string; enabled: number }>(
      'SELECT id, column, level, enabled FROM shopify_field_mapping ORDER BY sort_order',
    );
    transaction(() => {
      rows.forEach((row) => {
        run('UPDATE shopify_field_mapping SET enabled = ? WHERE id = ?', [formData.get(`map:${row.id}`) === '1' ? 1 : 0, row.id]);
      });
    });
    logAudit({ entityType: 'SHOPIFY_MAPPING', entityId: 'mapping', entityLabel: 'Column mapping', action: 'CONFIGURE', userId: user.id });
    revalidatePath('/settings');
    return { ok: true, message: 'Column mapping updated.' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function testDriveConnectionAction(): Promise<ActionResult> {
  try {
    const user = await requirePermission('settings.manage');
    const { buildDriveConfig, GoogleDriveStorage, DriveNotConfiguredError } = await import('@/lib/storage');
    const config = buildDriveConfig();
    const drive = new GoogleDriveStorage(config);
    if (!drive.isConfigured()) {
      return { ok: false, error: 'Google Drive is not configured. Provide a service account or OAuth refresh token in the environment.' };
    }
    let originalFolderId = config.originalFolderId;
    let finalFolderId = config.finalFolderId;
    try {
      const folders = await drive.ensureFolders();
      originalFolderId = folders.originalFolderId;
      finalFolderId = folders.finalFolderId;
      setSetting('drive.original_folder_id', originalFolderId);
      setSetting('drive.final_folder_id', finalFolderId);
      setSetting('storage.backend', 'GDRIVE');
    } catch (error) {
      if (error instanceof DriveNotConfiguredError) {
        return { ok: false, error: 'Google Drive is not configured on this server.' };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Could not reach Google Drive: ${message}` };
    }
    logAudit({
      entityType: 'SETTING',
      entityId: 'storage',
      entityLabel: 'Google Drive',
      action: 'CONFIGURE',
      userId: user.id,
      changes: [
        { field: 'drive.original_folder_id', label: 'Original folder', oldValue: config.originalFolderId, newValue: originalFolderId },
        { field: 'drive.final_folder_id', label: 'Final folder', oldValue: config.finalFolderId, newValue: finalFolderId },
      ],
    });
    revalidatePath('/settings');
    return {
      ok: true,
      message: `Connected. Original folder ${originalFolderId}, Final folder ${finalFolderId}. Storage backend switched to Google Drive.`,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}




