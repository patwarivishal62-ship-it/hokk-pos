# Where exactly to put `secrets/gdrive.json`? — Beginner Visual Guide

You asked: "my project, where exactly do you mean"

I mean the **hokk-pos folder on YOUR computer** — the one you downloaded/cloned from GitHub.

---

## 📁 What is "your project"?

It's the folder named `hokk-pos` that contains files like `package.json`, `README.md`, `src/`, etc.

**How to find it:**

- **If you downloaded ZIP from GitHub:** You probably have it in `Downloads/hokk-pos-main/` or `Desktop/hokk-pos/`
- **If you used `git clone`:** It's wherever you ran the clone command, often `Documents/` or `Desktop/`

**Check:** Open the folder. You should see these files inside:
```
hokk-pos/
  ├─ package.json
  ├─ README.md
  ├─ src/
  ├─ db/
  ├─ scripts/
  ├─ .env.example
  └─ storage/
```
If you see those, you are in the RIGHT place.

---

## 📂 EXACT LOCATION to put JSON file

Inside that `hokk-pos/` folder, you need to create a subfolder called `secrets` and put your JSON inside it.

**Final path should be:**
```
hokk-pos/
  └─ secrets/
      └─ gdrive.json   ← YOUR DOWNLOADED FILE GOES HERE
```

### Step-by-step (Windows)

1. **Find your hokk-pos folder:**
   - Open File Explorer (Windows + E)
   - Go to where you saved hokk-pos (e.g., `C:\Users\YourName\Downloads\hokk-pos` or `C:\Users\YourName\Desktop\hokk-pos`)

2. **Open the hokk-pos folder** — you should see `package.json` etc.

3. **Create `secrets` folder:**
   - Right-click inside hokk-pos folder → New → Folder → Name it `secrets` (lowercase, exactly)

4. **Put your JSON file:**
   - You downloaded a file like `hokk-pos-123456-abc.json` from Google Cloud
   - Copy that file (Ctrl+C)
   - Go inside the `secrets` folder you just created (double-click it)
   - Paste (Ctrl+V)
   - **Rename it to `gdrive.json`:**
     - Right-click the file → Rename → Type `gdrive.json` → Enter
     - Windows may warn about changing extension → Click Yes

5. **Verify:**
   - Path should be: `hokk-pos\secrets\gdrive.json`
   - Open `gdrive.json` in Notepad — you should see `{"type": "service_account", "client_email": "...", ...}`

### Step-by-step (Mac)

1. **Find your hokk-pos folder:**
   - Open Finder → Go → Downloads or Desktop → Find `hokk-pos`

2. **Open hokk-pos** — see `package.json` etc.

3. **Create `secrets` folder:**
   - Right-click inside → New Folder → Name `secrets`

4. **Put JSON:**
   - Copy your downloaded JSON (Cmd+C)
   - Open `secrets` folder → Paste (Cmd+V)
   - Rename to `gdrive.json` (right-click → Rename)

5. **Verify path:** `hokk-pos/secrets/gdrive.json`

---

## 💻 Where to run `npm run drive:setup`?

You need to run this command INSIDE the hokk-pos folder, in a terminal.

### Windows — How to open terminal in project folder:

**Method 1 (Easiest):**
1. Open your `hokk-pos` folder in File Explorer
2. Click the address bar at top (where it shows `C:\Users\...\hokk-pos`)
3. Type `cmd` and press Enter
4. A black window opens — that's your terminal, already inside hokk-pos

**Method 2:**
1. Inside `hokk-pos` folder, hold **Shift** + Right-click on empty space
2. Click **"Open PowerShell window here"** or **"Open in Terminal"**

**Method 3:**
1. Open Start Menu → Type `cmd` → Open Command Prompt
2. Type: `cd Desktop\hokk-pos` (or wherever your folder is) → Enter
   - Example: `cd C:\Users\YourName\Downloads\hokk-pos`

### Mac — How to open terminal:

1. Open `hokk-pos` folder in Finder
2. Right-click on folder background → **"New Terminal at Folder"**
   - If you don't see it: Finder → Services → New Terminal at Folder (enable in System Settings → Keyboard → Shortcuts → Services)
3. Or: Open Spotlight (Cmd+Space) → Type `Terminal` → Enter → Type `cd ~/Desktop/hokk-pos` → Enter

### Once terminal is open:

Type these commands ONE BY ONE and press Enter after each:

```bash
# 1. Check you are in right folder (should show package.json)
dir
# or on Mac: ls

# 2. Check secrets file exists
dir secrets
# or on Mac: ls secrets
# You should see gdrive.json listed

# 3. Run the setup (this creates folders in your Drive)
npm run drive:setup
```

**What it does:**
- Reads `secrets/gdrive.json`
- Connects to your Drive folder `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
- Creates `House of Kala Katha/Original`, `Final`, etc.
- Prints IDs like:
  ```
  ✅ Folders created:
    Original: 1abc...
    Final: 1def...
  ```

**If you see error "npm not found":**
You need to install Node.js first:
- Go to https://nodejs.org/ → Download LTS → Install → Restart terminal → Try again

**If you see "No credentials found":**
- Means `secrets/gdrive.json` not found — check spelling, must be exactly `secrets/gdrive.json` inside hokk-pos

---

## 🌐 What if my project is on VERCEL (not on my laptop)?

If your app is deployed on Vercel (vercel.com), you DON'T need to put file in folder. Instead:

1. Go to https://vercel.com/dashboard
2. Click your project `hokk-pos`
3. Top menu → **Settings** → **Environment Variables**
4. Click **Add New**
   - Name: `GDRIVE_SERVICE_ACCOUNT_JSON`
   - Value: Open your `gdrive.json` in Notepad → Select ALL (Ctrl+A) → Copy (Ctrl+C) → Paste into Value box
   - Click Save
5. Add another:
   - Name: `GDRIVE_PARENT_FOLDER_ID`
   - Value: `1iViabmuDwg8uboyWNmetl4cxoW4LsPuH`
   - Save
6. Add:
   - Name: `STORAGE_BACKEND`
   - Value: `GDRIVE`
   - Save
7. Go to **Deployments** tab → Click latest deployment → **Redeploy**

Then Test connection in your live app will work.

---

## ✅ Quick Checklist

- [ ] I found my `hokk-pos` folder on my computer (has `package.json` inside)
- [ ] Inside it, I created folder `secrets`
- [ ] I put my downloaded JSON inside `secrets/` and renamed to `gdrive.json`
- [ ] Path is `hokk-pos/secrets/gdrive.json` (check: open it in Notepad, see client_email)
- [ ] I opened terminal INSIDE hokk-pos folder
- [ ] I ran `npm run drive:setup` and saw ✅ Folders created

If stuck, tell me:
1. What computer? Windows / Mac?
2. Where is your hokk-pos folder? (Desktop? Downloads?)
3. What error do you see when you run `npm run drive:setup`? (copy paste)

I'll guide you!
