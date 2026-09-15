# How to Enable Google Drive API — Super Simple Guide

You asked: "Where do i find drive api in cloud to enable"

Here is the EASIEST way (2 clicks):

---

## 🚀 FASTEST METHOD — Direct Link (Recommended)

Just click this link while logged into your Google account:

**👉 https://console.cloud.google.com/apis/library/drive.googleapis.com**

This link directly opens the Google Drive API page.

Then:
1. At the top, make sure your project is selected. If you don't have a project, click "Select Project" → "New Project" → Name it `HOKK POS` → Create → Wait 30 sec → Select it.
2. You will see a big blue button that says **"ENABLE"** — Click it!
3. Done! ✅ Drive API is now enabled. Takes 10 seconds.

That's it!

---

## 🐢 SLOW METHOD — Through Menu (if direct link doesn't work)

If you want to navigate manually:

1. Go to **https://console.cloud.google.com/**

2. **Login** with the SAME Google account that owns your Drive folder `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
   - Check which account owns the folder: Open https://drive.google.com/drive/folders/1iViabmuDwg8uboyWNmetl4cxoW4LsPuH → Right click → Details → Owner

3. **Create or Select Project:**
   - Top left, next to "Google Cloud", click the dropdown that says "Select Project"
   - Click "NEW PROJECT"
   - Project name: `HOKK POS` (or any name you like)
   - Click "CREATE"
   - Wait 20-30 seconds
   - Click the dropdown again and select your new project `HOKK POS`

4. **Go to APIs Page:**
   - On the left side menu (☰ hamburger menu), click **"APIs & Services"** → **"Enabled APIs & services"**
   - Or go to: https://console.cloud.google.com/apis/dashboard

5. **Enable Drive API:**
   - At the top, click **"+ ENABLE APIS AND SERVICES"** (big button)
   - In the search box, type **"Google Drive API"**
   - Click on **"Google Drive API"** (it has a colorful triangle Drive icon)
   - Click the blue **"ENABLE"** button
   - Wait 10 seconds — it will say "API enabled"

6. **Done!** Now you can create Service Account.

---

## What to do AFTER enabling?

After Drive API is enabled, you need to create Service Account (robot email):

1. Left menu → **"IAM & Admin"** → **"Service Accounts"**
   - Direct link: https://console.cloud.google.com/iam-admin/serviceaccounts

2. Click **"CREATE SERVICE ACCOUNT"** at top

3. Fill:
   - Service account name: `hokk-pos`
   - Description: `HOKK POS Drive access`
   - Click **"CREATE AND CONTINUE"**

4. For "Grant this service account access", just click **"CONTINUE"** (skip)

5. Click **"DONE"**

6. Now you see `hokk-pos@...` in list → Click on it

7. Go to **"KEYS"** tab at top

8. Click **"ADD KEY"** → **"Create new key"** → Choose **JSON** → **"CREATE"**

9. A file will automatically download — `hokk-pos-xxxxx.json` — This is your secret file! Save it safely.

10. Open that file in Notepad, find `client_email` — that's the email you need to share your Drive folder with.

---

## Screenshots Description (what you should see)

**Step 4 — Enabled APIs page:**
- You see a page with "APIs & Services" at top
- List of APIs like "Google Drive API", "Gmail API" etc if already enabled
- Big button at top: "+ ENABLE APIS AND SERVICES"

**Step 5 — Search Drive API:**
- Search bar at top
- Type "Drive" → You see "Google Drive API" with Google Drive logo (green-yellow-blue triangle)
- Click it → Page shows "Google Drive API" with description and blue ENABLE button

**After ENABLE:**
- Button changes to "MANAGE"
- You see graphs and metrics (all zero at first) — that's normal

---

## Common Problems

**Q: I don't see "APIs & Services" in menu**
A: Click the ☰ hamburger menu top left → Scroll down → "APIs & Services" → "Enabled APIs & services"

**Q: It asks for billing?**
A: Google Cloud requires billing to be enabled for some APIs, but Drive API is free. You can skip or add a billing account (no charge unless you use paid services). If it forces billing, click "Enable Billing" → Add card → It's free tier, Drive API costs $0 for normal use.

**Q: I clicked ENABLE but it says "API already enabled"**
A: Perfect! That means it was already enabled earlier. You can skip to Service Account creation.

**Q: I enabled but don't see Service Accounts**
A: Go to: https://console.cloud.google.com/iam-admin/serviceaccounts → Make sure correct project is selected at top.

---

## Video Steps Summary (30 seconds)

1. Open https://console.cloud.google.com/apis/library/drive.googleapis.com
2. Select Project (or create new `HOKK POS`)
3. Click ENABLE (blue button)
4. Done ✅

Then create service account as described above.

---

## Need Help?

Tell me:
- Did you open the direct link? What do you see? (ENABLE button or MANAGE button?)
- Do you have a Google Cloud Project already? What's its name?
- Screenshot of what you see after clicking the link?

I can guide you further!
