# Google Drive Setup — HOKK POS

**Your Drive Folder:** https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH  
**Folder ID:** `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` (this is your `GDRIVE_PARENT_FOLDER_ID`)

This folder is the **parent** under which the app creates `House of Kala Katha/Original` and `House of Kala Katha/Final`.

---

## Recommended Folder Structure

Inside `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`, the app will auto-create:

```
1iViabmuDwg8uboyWNmetl4cxoW4LsPuH/   ← YOUR SHARED FOLDER (parent)
└─ House of Kala Katha/            ← Created by ensureFolders()
   ├─ Original/                    ← REQUIRED — raw uploads
   ├─ Final/                       ← REQUIRED — Shopify-ready
   ├─ Exports/                     ← RECOMMENDED — Shopify CSVs + Excel
   ├─ Imports/                     ← RECOMMENDED — bulk import sheets
   ├─ Archive/                     ← RECOMMENDED — old/deprecated
   └─ Temp/                        ← OPTIONAL — staging
```

- `Original` and `Final` are **required** and auto-created by `ensureFolders()` / `ensureFullStructure()`.
- `Exports`, `Imports`, `Archive`, `Temp` are recommended for ops and created by `ensureFullStructure()` (new method).

Filenames inside Original/Final are auto-generated as `HOKK-SAR-ZK-001-HERO.jpg` — never dependent on display name.

---

## Option A: Automatic creation (recommended)

If you have a Google Service Account, run:

```bash
# Put service account JSON in a file
echo '{"type":"service_account","project_id":...}' > ./secrets/gdrive.json

GDRIVE_SERVICE_ACCOUNT_FILE="./secrets/gdrive.json" \
GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts

# Or with raw JSON env var
GDRIVE_SERVICE_ACCOUNT_JSON="$(cat ./secrets/gdrive.json)" \
GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
npx tsx --tsconfig scripts/tsconfig.json scripts/setup-drive-structure.ts
```

This will:
1. Create `House of Kala Katha` under your parent
2. Create `Original`, `Final`, `Exports`, `Imports`, `Archive`, `Temp`
3. Print their IDs and the env vars to set

Expected output:
```
✅ Folders created / verified:
  Root (House of Kala Katha): 1abc...
  Original: 1def...
  Final: 1ghi...
  ...
```

---

## Option B: Manual creation (if you don't have credentials handy)

1. Open https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH
2. Create folder `House of Kala Katha`
3. Inside it, create:
   - `Original`
   - `Final`
   - `Exports`
   - `Imports`
   - `Archive`
   - `Temp`
4. Share `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` with your service account email (Editor):
   - Service account email looks like: `hokk-pos@<project>.iam.gserviceaccount.com`
   - Right-click folder → Share → Add service account email → Editor
   - Tick "Notify" off, Share. Subfolders inherit.

---

## Environment Variables

### Local `.env`

Copy `.env.example` to `.env` and set:

```env
STORAGE_BACKEND="GDRIVE"
GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH"
# After auto-creation, also set these (optional but speeds up):
GDRIVE_ORIGINAL_FOLDER_ID="<id from script>"
GDRIVE_FINAL_FOLDER_ID="<id from script>"
GDRIVE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# Or file path:
GDRIVE_SERVICE_ACCOUNT_FILE="./secrets/gdrive.json"
GDRIVE_PUBLIC_URL_TEMPLATE="https://lh3.googleusercontent.com/d/{fileId}"
PUBLIC_BASE_URL="https://your-app.vercel.app"  # fallback for LOCAL
```

For Vercel, base64-encode the JSON if it contains newlines:

```bash
cat service-account.json | base64 -w 0
# Paste that into Vercel env var GDRIVE_SERVICE_ACCOUNT_JSON
```

The code auto-detects base64 and decodes it.

### Vercel Dashboard

Set in Vercel → Project → Settings → Environment Variables:

- `STORAGE_BACKEND` = `GDRIVE`
- `GDRIVE_PARENT_FOLDER_ID` = `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
- `GDRIVE_SERVICE_ACCOUNT_JSON` = `<your JSON or base64>`
- `GDRIVE_PUBLIC_URL_TEMPLATE` = `https://lh3.googleusercontent.com/d/{fileId}`
- `DATABASE_URL` = `libsql://...` (Turso)
- `TURSO_AUTH_TOKEN` = `...`
- `SESSION_SECRET` = random 32+ chars
- `ALLOWED_ORIGINS` = your domain

Redeploy after changing.

---

## Verification

### Via UI (easiest)

1. Deploy / run `npm run dev`
2. Login as Super Admin
3. Go to Settings → Storage
4. Click **Test connection**
5. Should show:
   ```
   Connected. Original folder <id>, Final folder <id>. Storage backend switched to Google Drive.
   ```

If it fails, check:
- Parent folder is shared with service account (Editor)
- Service account JSON is valid
- Parent ID is exactly `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`

### Via script (live check)

```bash
GDRIVE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)" \
GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH" \
npx tsx --tsconfig scripts/tsconfig.json scripts/verify-gdrive.ts
```

Should upload a 1x1 PNG to Original and Final, read it back, delete, and print public URLs.

### Check Drive directly

After Test connection:
- Open https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH
- You should see `House of Kala Katha` folder
- Inside it: `Original` and `Final` (and others if you ran full structure)
- Upload a product image in app → it should appear in `Original` in Drive within seconds
- Promote to Final → file should move/copy to `Final` and get public URL

---

## How storage works in app

- **LOCAL**: files under `storage/uploads/original/<sku>/...` and served at `/api/media/<key>` (requires `PUBLIC_BASE_URL` for Shopify)
- **GDRIVE**: files uploaded via Drive API, shared as `anyone with link → reader`, public URL = `https://lh3.googleusercontent.com/d/{fileId}`

Shopify **requires** publicly reachable image URLs. Local paths without `PUBLIC_BASE_URL` will be left blank in CSV and export will warn: *"Images cannot be imported into Shopify until publicly accessible URLs are available."*

GDRIVE solves this — each file gets a public URL immediately.

---

## Troubleshooting

**Test connection says "Google Drive is not configured"**
- Check `GDRIVE_SERVICE_ACCOUNT_JSON` is set and valid JSON
- Or set `GDRIVE_SERVICE_ACCOUNT_FILE` pointing to a file that exists
- For OAuth: need all three `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`

**"Failed to obtain access token"**
- Private key format: ensure `\n` are real newlines or `\\n` escaped — code handles both
- Service account email must match private key
- If base64 encoded, ensure it's standard base64, not url-safe, and decodes to JSON starting with `{`

**"Failed to obtain access token (refresh token): 401 unauthorized_client"**

Google is saying: *the client ID/secret this server sends is not the client that issued
`GDRIVE_REFRESH_TOKEN`.* It never names the variable, so run the doctor first:

```bash
npm run drive:doctor
```

It prints the credential the server would send (masked, with shape checks — e.g. it flags a
`ya29.` access token pasted where a `1//` refresh token belongs), performs one live token
exchange, and tells you which value to fix.

The usual causes, in order:

1. **Token minted by a different client.** A refresh token from the OAuth Playground or another
   tutorial will never work with your own client ID. Re-mint it with the client the app uses:

   ```bash
   # add http://127.0.0.1:8765/callback to that client's "Authorized redirect URIs" first
   npm run drive:authorize
   ```

   Then set all three values together—`GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`,
   `GDRIVE_REFRESH_TOKEN`—from the *same* OAuth client, and redeploy.
2. **`ya29.` access token used as the refresh token.** Access tokens expire in an hour and can
   never be refreshed. A refresh token starts with `1//`.
3. **Public/installed client with no secret.** Desktop, Android, iOS and Chrome clients have no
   client secret; sending one is itself a cause of `unauthorized_client`. The app now retries
   once without the secret — if that succeeds, remove `GDRIVE_CLIENT_SECRET` entirely.
4. **Wrapping quotes / stray whitespace.** Copy-paste often leaves `GDRIVE_CLIENT_ID="123…"`
   with the quotes inside the value. These are stripped at runtime now, and the doctor flags them.
5. **Different environment than the running server.** On Vercel the variables must be in
   Project Settings → Environment Variables, and you must redeploy; a local `.env` is not read.

**"Drive create folder failed: 403"**
- Parent folder not shared with service account
- Share `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` with service account email as Editor

**"Drive create folder failed: 404"**
- Parent folder ID wrong or not accessible
- Verify URL: https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH opens in your browser

**Images upload but Shopify CSV has blank image URL**
- Check `publicUrl` in `product_image` table — should be `https://lh3.googleusercontent.com/d/...`
- If blank, check `GDRIVE_PUBLIC_URL_TEMPLATE` and that permission step succeeded (code shares as anyone/reader)
- Try re-running Test connection to re-link folder IDs

---

## Quick Reference — Your IDs

- Parent (you provided): `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` → https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH
- Root (auto-created): `House of Kala Katha` → ID printed by setup script
- Original (auto-created): `Original` → ID printed by setup script
- Final (auto-created): `Final` → ID printed by setup script

Keep this file in repo — it documents the live folder.

---

## Scripts

- `npm run drive:setup` — creates the full folder tree under your parent, prints IDs, works with or without credentials (prints manual steps if none are set).
- `npm run drive:doctor` — **run this first when uploads fail.** Reports the credentials the server would send (masked), flags malformed values, performs one live token exchange and explains Google's answer.
- `npm run drive:authorize` — mints a fresh `GDRIVE_REFRESH_TOKEN` for the client in `GDRIVE_CLIENT_ID`. This is the fix for `unauthorized_client`. Needs `http://127.0.0.1:8765/callback` added to that client's Authorized redirect URIs.
- `npm run drive:verify` — end-to-end check: creates folders, uploads, shares, reads back and deletes a test PNG.
