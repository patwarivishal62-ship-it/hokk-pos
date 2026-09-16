# Beginner Guide — Drive Folder Sharing & Test Connection

You said: "I'm a newbie, I did not understand these points. I have created folders as you said"

Perfect! You did the hardest part. Now only 2 small steps left. I'll explain like you're 10 years old.

---

## What you already did (GOOD!)

You opened: https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH

And created:
```
House of Kala Katha/
  ├─ Original
  ├─ Final
  ├─ Exports
  ├─ Imports
  ├─ Archive
  └─ Temp
```

✅ That's exactly right!

---

## What is left? 2 steps explained SUPER simply

### Step 1: "Share your folder with service account as Editor"

**What is a service account?**
Think of it as a ROBOT email address. Your HOKK app is a robot. It needs its own Gmail to put photos into your Drive. You need to give that robot permission to use your folder.

**Where is this robot email?**

You have 2 options:

#### OPTION A — You already have a service account (from developer)
If someone gave you a file called `service-account.json` or `gdrive.json`, open it in Notepad. Inside you'll see:

```json
{
  "client_email": "hokk-pos@your-project.iam.gserviceaccount.com",
  ...
}
```

That `client_email` is the robot's email. Copy it.

#### OPTION B — You don't have it yet (most newbies)
You need to create it. It's free and takes 5 minutes. Follow this:

1. Go to https://console.cloud.google.com/
2. Login with YOUR Google account (the one that owns the Drive folder)
3. Top left, click "Select Project" → "New Project" → Name it `HOKK POS` → Create
4. Wait 30 sec, then select that project
5. Left menu → "APIs & Services" → "Enabled APIs" → Click "+ ENABLE APIS AND SERVICES"
6. Search "Google Drive API" → Click it → Click "Enable"
7. Left menu → "IAM & Admin" → "Service Accounts" → "Create Service Account"
8. Name: `hokk-pos` → Click "Create and Continue" → Skip roles → Done
9. Now you see your service account in list. Click on it → "Keys" tab → "Add Key" → "Create New Key" → JSON → Create
10. A file downloads automatically — that's your `service-account.json` — KEEP IT SAFE, don't share publicly
11. Inside that file, find `client_email` — that's the robot email, looks like: `hokk-pos@hokk-pos-123456.iam.gserviceaccount.com`

**Now SHARE your folder with that robot email:**

1. Go back to https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH
2. Right-click on your folder (or click the 3 dots) → "Share" → "Share"
3. In "Add people" box, PASTE the robot email: `hokk-pos@...iam.gserviceaccount.com`
4. On the right, change from "Viewer" to "Editor"
5. Uncheck "Notify people" (robot doesn't need email)
6. Click "Share" or "Send"

That's it! Now robot can write files to your folder.

**Repeat sharing for subfolder too (important):**
Also share `House of Kala Katha` folder the same way with same robot email as Editor. This ensures all subfolders inherit permission.

Done for Step 1!

---

### Step 2: "Test connection" in the app

This is a button INSIDE your HOKK POS website/app that checks if robot can actually use your Drive.

**Where is this button?**

1. Open your HOKK app:
   - If running locally: http://localhost:3000
   - If on Vercel: https://your-app-name.vercel.app

2. Login with your admin account (founder@houseofkalakatha.com or whatever you created)

3. Look at left sidebar → Click "Settings" (bottom of sidebar, gear icon)

4. In Settings page, you'll see tabs or sections. Find "Storage" section

5. Inside Storage, you will see:
   - Storage Backend: LOCAL / GDRIVE
   - Parent Folder ID: 1iViabmuDwg8uboyWNmetl4cxoW4LsPuH
   - And a button that says "Test connection" or "Test Drive Connection"

6. Click that button!

**What should happen:**

- If sharing was done correctly AND service account JSON is set in .env, it will show GREEN message:
  ```
  Connected. Original folder 1a2b..., Final folder 3c4d... Storage backend switched to Google Drive.
  ```

- If it fails, it will show RED error like "Google Drive is not configured" or "403" — that means sharing or JSON is missing. Tell me the exact error and I'll fix.

**Where to put service-account.json so Test connection works?**

For LOCAL development (your laptop):

1. In your project folder `hokk-pos/`, create folder `secrets/` if not exists
2. Put your downloaded `service-account.json` inside `secrets/gdrive.json`
3. Open `.env` file in Notepad, set:
   ```
   STORAGE_BACKEND="GDRIVE"
   GDRIVE_SERVICE_ACCOUNT_FILE="./secrets/gdrive.json"
   GDRIVE_PARENT_FOLDER_ID="1iViabmuDwg8uboyWNmetl4cxoW4LsPuH"
   ```
4. Restart your app: `npm run dev`

For VERCEL (production):

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - Name: `GDRIVE_SERVICE_ACCOUNT_JSON`
   - Value: Open your `service-account.json` file, copy ENTIRE content, paste
   - (If it has newlines issue, use base64: `cat service-account.json | base64 -w 0` and paste that)
   - Name: `GDRIVE_PARENT_FOLDER_ID` Value: `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
   - Name: `STORAGE_BACKEND` Value: `GDRIVE`
3. Click Save → Go to Deployments → Redeploy latest

Then try Test connection again.

---

## Visual Checklist for You

Please check and reply with ✅ or ❌:

- [ ] I created `House of Kala Katha` inside `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
- [ ] Inside it, I created `Original`, `Final`, `Exports`, `Imports`, `Archive`, `Temp`
- [ ] I have a service-account.json file (or I created one following Option B)
- [ ] I found the robot email inside it (ends with `iam.gserviceaccount.com`)
- [ ] I shared BOTH `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH` AND `House of Kala Katha` with that robot email as Editor
- [ ] I put the JSON path in `.env` or Vercel env vars
- [ ] I clicked "Test connection" in Settings → Storage

If you are stuck at any checkbox, tell me which one and I will help with screenshots!

---

## No Service Account? Use LOCAL for now (temporary)

If this is too much for now, you can keep using LOCAL storage:

In `.env`:
```
STORAGE_BACKEND="LOCAL"
```

Your photos will be stored on your computer/server under `storage/uploads/original/` and `storage/uploads/final/` — not in Drive, but app will work 100%. You can switch to GDRIVE later when ready. No need to rush.

---

## Hosting it online? Use Render (photos kept for real)

If you want the app on the internet with photos stored for real (not in Drive),
deploy it to **Render** — the step-by-step, click-by-click guide is in
**`RENDER.md`**.

The short version:

1. Render Dashboard → **New** → **Blueprint** → pick this repository → **Apply**.
2. Render reads `render.yaml` and creates the app **plus a 10 GB disk** mounted
   at `/var/data` — that disk is where your photos and the product data live.
3. When Render asks for `ALLOWED_ORIGINS`, type your service host
   (e.g. `hokk-pos.onrender.com`). Leave `PUBLIC_BASE_URL` blank.
4. Open your service URL → `/setup` → create your first account.

The app will **refuse to start** if that disk is missing (it shows a screen with
these exact steps) — because without it Render wipes everything on every deploy.
That warning is a feature, not an error: nothing gets lost quietly.

---

## Need Help? Tell me:

1. Do you have `service-account.json` file? Yes/No
2. Are you running app locally (`localhost:3000`) or on Vercel?
3. What do you see when you click Test connection? (copy paste the message)

I will fix it for you in next message!
