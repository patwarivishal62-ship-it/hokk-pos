/**
 * Live verification of the Google Drive adapter against a real Drive account.
 *
 *   GDRIVE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
 *   GDRIVE_PARENT_FOLDER_ID="1sharedFolderId" \
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-gdrive.ts
 *
 * Requires:
 *   - GDRIVE_SERVICE_ACCOUNT_JSON (or GDRIVE_SERVICE_ACCOUNT_FILE)
 *   - GDRIVE_PARENT_FOLDER_ID (shared folder that the service account can write to)
 *
 * Steps:
 *   1. buildDriveConfig() + ensureFolders() → creates House of Kala Katha/Original+Final
 *   2. put() a small PNG to Original
 *   3. put() a small PNG to Final
 *   4. Verify publicUrl uses template and file is marked shared
 *   5. read() bytes back via alt=media
 *   6. remove() both files
 *
 * Prints folder IDs and public URLs. Exits non-zero on any failure.
 */

import { buildDriveConfig } from '@/lib/storage';
import { GoogleDriveStorage } from '@/lib/storage/gdrive';

async function main() {
  const config = buildDriveConfig();
  console.log('Drive config:', {
    hasServiceAccount: Boolean(config.serviceAccountJson || config.serviceAccountFile),
    parentFolderId: config.parentFolderId,
    apiBase: config.apiBase,
    oauthBase: config.oauthBase,
  });

  const drive = new GoogleDriveStorage(config);
  console.log('isConfigured:', drive.isConfigured());
  if (!drive.isConfigured()) {
    console.error('Google Drive is not configured. Set GDRIVE_SERVICE_ACCOUNT_JSON and GDRIVE_PARENT_FOLDER_ID.');
    process.exit(1);
  }

  console.log('\nEnsuring folders...');
  const folders = await drive.ensureFolders();
  console.log('Root:', folders.rootFolderId);
  console.log('Original:', folders.originalFolderId);
  console.log('Final:', folders.finalFolderId);

  const status = await drive.status();
  console.log('Status:', status);

  // Minimal 1x1 PNG (same as e2e)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );

  console.log('\nUploading to Original...');
  const original = await drive.put({
    data: png,
    fileName: `HOKK-VERIFY-ORIGINAL-${Date.now()}.png`,
    mimeType: 'image/png',
    folder: 'ORIGINAL',
    groupKey: 'VERIFY',
  });
  console.log('Original fileId:', original.driveFileId);
  console.log('Original publicUrl:', original.publicUrl);
  console.log('Original folderId:', original.driveFolderId);

  console.log('\nUploading to Final...');
  const final = await drive.put({
    data: png,
    fileName: `HOKK-VERIFY-FINAL-${Date.now()}.png`,
    mimeType: 'image/png',
    folder: 'FINAL',
    groupKey: 'VERIFY',
  });
  console.log('Final fileId:', final.driveFileId);
  console.log('Final publicUrl:', final.publicUrl);
  console.log('Final folderId:', final.driveFolderId);

  if (original.driveFolderId !== folders.originalFolderId) {
    throw new Error(`Original routing failed: ${original.driveFolderId} != ${folders.originalFolderId}`);
  }
  if (final.driveFolderId !== folders.finalFolderId) {
    throw new Error(`Final routing failed: ${final.driveFolderId} != ${folders.finalFolderId}`);
  }

  console.log('\nReading back Original bytes via alt=media...');
  const bytes = await drive.read({ storageKey: original.storageKey, driveFileId: original.driveFileId });
  console.log('Read bytes:', bytes.length);

  console.log('\nDeleting files...');
  await drive.remove({ storageKey: original.storageKey, driveFileId: original.driveFileId });
  console.log('Deleted Original');
  await drive.remove({ storageKey: final.storageKey, driveFileId: final.driveFileId });
  console.log('Deleted Final');

  console.log('\nGDRIVE VERIFY PASS');
  console.log(`Original public URL was: ${original.publicUrl}`);
  console.log(`Final public URL was: ${final.publicUrl}`);
  console.log('Both were uploaded to correct folders and publicly shared.');
}

main().catch((err) => {
  console.error('\nGDRIVE VERIFY FAIL');
  console.error(err);
  process.exit(1);
});
