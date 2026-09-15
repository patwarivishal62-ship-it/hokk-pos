/**
 * Setup full Google Drive folder structure for HOKK POS
 *
 * Usage:
 *   GDRIVE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
 *   GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts
 *
 * Or with a file path:
 *   GDRIVE_SERVICE_ACCOUNT_FILE="./secrets/gdrive.json" \
 *   GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts
 *
 * If no credentials are set, it prints manual instructions and the
 * expected folder IDs / structure for the provided parent folder.
 */

import { buildDriveConfig } from '@/lib/storage';
import { GoogleDriveStorage } from '@/lib/storage/gdrive';

const EXPECTED_PARENT_ID = '1iViabmuDwg8uboyWNmetl4cxoW4LsPuH';

async function main() {
  const config = buildDriveConfig();

  // Allow override via arg or default to the user's provided folder
  const parentFromArg = process.argv[2]?.trim();
  if (parentFromArg && !config.parentFolderId) {
    config.parentFolderId = parentFromArg;
  }
  if (!config.parentFolderId) {
    console.log(`\nNo GDRIVE_PARENT_FOLDER_ID set — using your provided folder:`);
    console.log(`  ${EXPECTED_PARENT_ID}`);
    config.parentFolderId = EXPECTED_PARENT_ID;
  }

  console.log('\n=== HOKK POS — Drive Folder Setup ===');
  console.log(`Parent Folder ID: ${config.parentFolderId}`);
  console.log(`Parent URL: https://drive.google.com/drive/folders/${config.parentFolderId}`);
  console.log(`Expected: https://drive.google.com/drive/folders/${EXPECTED_PARENT_ID}`);

  const drive = new GoogleDriveStorage(config);

  if (!drive.isConfigured()) {
    console.log('\n⚠️  No Google Drive credentials found — showing MANUAL setup instructions.\n');
    printManualInstructions(config.parentFolderId!);
    console.log('\nTo auto-create via API, set one of:');
    console.log('  GDRIVE_SERVICE_ACCOUNT_JSON  (raw JSON or base64)');
    console.log('  GDRIVE_SERVICE_ACCOUNT_FILE  (path to JSON file)');
    console.log('  OR OAuth: GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET + GDRIVE_REFRESH_TOKEN');
    console.log('\nThen re-run this script.\n');
    return;
  }

  console.log(`\n✓ Credentials found — creating folders via Drive API...`);
  console.log(`  isConfigured: ${drive.isConfigured()}`);

  try {
    const folders = await drive.ensureFullStructure();

    console.log('\n✅ Folders created / verified:');
    console.log(`  Root (House of Kala Katha): ${folders.rootFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.rootFolderId}`);
    console.log(`  Original: ${folders.originalFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.originalFolderId}`);
    console.log(`  Final: ${folders.finalFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.finalFolderId}`);
    console.log(`  Exports: ${folders.exportsFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.exportsFolderId}`);
    console.log(`  Imports: ${folders.importsFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.importsFolderId}`);
    console.log(`  Archive: ${folders.archiveFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.archiveFolderId}`);
    console.log(`  Temp: ${folders.tempFolderId}`);
    console.log(`    URL: https://drive.google.com/drive/folders/${folders.tempFolderId}`);

    console.log('\n=== ENV VARS TO SET (Vercel / .env) ===');
    console.log(`STORAGE_BACKEND="GDRIVE"`);
    console.log(`GDRIVE_PARENT_FOLDER_ID="${config.parentFolderId}"`);
    console.log(`GDRIVE_ORIGINAL_FOLDER_ID="${folders.originalFolderId}"`);
    console.log(`GDRIVE_FINAL_FOLDER_ID="${folders.finalFolderId}"`);
    console.log(`# Optional extra folders:`);
    console.log(`# GDRIVE_EXPORTS_FOLDER_ID="${folders.exportsFolderId}"`);
    console.log(`# GDRIVE_IMPORTS_FOLDER_ID="${folders.importsFolderId}"`);
    console.log(`GDRIVE_PUBLIC_URL_TEMPLATE="https://lh3.googleusercontent.com/d/{fileId}"`);

    console.log('\n=== NEXT STEPS ===');
    console.log('1. Set the env vars above in Vercel and/or your .env file');
    console.log('2. In the app: Settings → Storage → Test connection');
    console.log('   It should report: Connected. Original folder ..., Final folder ...');
    console.log('3. Upload a product image — it will go to Original and be publicly shared');
    console.log('4. Promote to Final — Shopify will be able to fetch via public URL');

    const status = await drive.status();
    console.log('\nStatus check:', status);

    console.log('\n🎉 Drive structure ready!\n');
  } catch (err) {
    console.error('\n❌ Failed to create folders:');
    console.error(err);
    console.log('\n--- Manual fallback ---');
    printManualInstructions(config.parentFolderId!);
    process.exit(1);
  }
}

function printManualInstructions(parentId: string) {
  console.log(`
MANUAL FOLDER CREATION (in https://drive.google.com/drive/folders/${parentId})

1. Open your folder: https://drive.google.com/drive/folders/${parentId}

2. Inside it, create a folder named:
   House of Kala Katha

3. Inside "House of Kala Katha", create these 6 subfolders (exact names, case-sensitive):

   - Original   (REQUIRED — raw photographs, uploaded by photography team)
   - Final      (REQUIRED — approved, export-ready assets for Shopify)
   - Exports    (RECOMMENDED — Shopify CSV + Excel history)
   - Imports    (RECOMMENDED — bulk import sheets)
   - Archive    (RECOMMENDED — deprecated / old assets)
   - Temp       (OPTIONAL — staging)

   Final tree should look like:
   ${parentId}/
     └─ House of Kala Katha/
         ├─ Original/
         ├─ Final/
         ├─ Exports/
         ├─ Imports/
         ├─ Archive/
         └─ Temp/

4. Share with service account (if using service account auth):
   - In Google Cloud Console, note your service account email:
     e.g. hokk-pos@your-project.iam.gserviceaccount.com
   - For EACH folder (parent + House of Kala Katha + subfolders), click:
     Share → Add people → paste service account email → Editor access
   - Or share only the top parent folder and ensure subfolders inherit.

5. Get Folder IDs:
   - Open each folder in browser, copy ID from URL:
     https://drive.google.com/drive/folders/<THIS_IS_THE_ID>
   - Note IDs for .env:
     GDRIVE_PARENT_FOLDER_ID=${parentId}
     GDRIVE_ORIGINAL_FOLDER_ID=<id of Original>
     GDRIVE_FINAL_FOLDER_ID=<id of Final>

6. Configure app:
   .env:
     STORAGE_BACKEND="GDRIVE"
     GDRIVE_PARENT_FOLDER_ID="${parentId}"
     GDRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

   Vercel:
     Add same env vars in Dashboard → Settings → Environment Variables
     Redeploy

7. Verify:
   - App → Settings → Storage → Test connection
   - Should show: Connected. Original folder <id>, Final folder <id>
   - Upload a test image in Products → Media → should appear in Drive/Original
   - Promote to Final → should move to Drive/Final and get public URL
   - Public URL format: https://lh3.googleusercontent.com/d/{fileId}
     Must be accessible without login (Shopify requirement)

SECURITY NOTE:
- Files are shared as "Anyone with the link — Reader" so Shopify can fetch them.
- Do NOT put sensitive docs in these folders.
- Service account JSON must be kept secret (base64 encode for Vercel if needed).
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
