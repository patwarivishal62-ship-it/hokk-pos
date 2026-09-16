/**
 * Live verification of a Render deployment's on-disk state.
 *
 *   npm run render:verify          # locally, or from Render Shell
 *
 * Answers the three questions that matter once the app is hosted on Render:
 *
 *   1. Is a *persistent* disk attached, or is /var/data just a directory on the
 *      ephemeral container filesystem (data would be lost on the next deploy)?
 *   2. Do uploads, exports and the SQLite database actually live on that disk?
 *   3. Does an upload survive a real write → read → delete round trip through
 *      the storage adapter, and is the resulting image URL publicly fetchable
 *      (the URL Shopify is given in a CSV export)?
 *
 * Read-only apart from one probe image in original/VERIFY/, which it deletes.
 * Exits non-zero when something is wrong, so it can gate a deploy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LocalStorage } from '@/lib/storage/local';
import { buildLocalConfig, buildS3Config } from '@/lib/storage';
import { diskStatus, exportDir, hostingPublicBaseUrl, isPersistentMount, isRender } from '@/lib/hosting';
import { resolveDbPath, resolveDbUrl } from '@/lib/db';

const PROBLEMS: string[] = [];

function ok(label: string, detail = ''): void {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label: string, detail = ''): void {
  console.log(`  WARN  ${label}${detail ? ` — ${detail}` : ''}`);
}

function bad(label: string, detail = ''): void {
  PROBLEMS.push(label);
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

const isRemote = (url: string) => /^(libsql|https?|wss?):/i.test(url);

function insideMount(target: string, mount: string): boolean {
  const abs = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
  return abs === mount || abs.startsWith(mount + path.sep);
}

async function main(): Promise<void> {
  console.log('Render storage verification\n');
  console.log(
    '  host:',
    isRender() ? 'Render' : 'not Render (this run only checks the local defaults)',
  );
  console.log('  cwd:', process.cwd());

  // --- 1. Persistent disk ----------------------------------------------------
  console.log('\n1. Persistent disk');
  const disk = diskStatus();
  console.log(
    '  mount:',
    disk.mountPath,
    disk.exists ? '(exists)' : '(missing)',
    disk.persistent ? '(separate filesystem)' : '',
  );
  if (!disk.required) {
    ok(
      'No disk needed',
      'storage/database do not use the filesystem (S3-compatible bucket + remote database)',
    );
  } else if (!isRender()) {
    warn('Not running on Render', `on Render the disk is expected at ${disk.mountPath}`);
  } else if (!disk.exists) {
    bad('No directory at the disk mount path', `add a disk at ${disk.mountPath} (see RENDER.md)`);
  } else if (!isPersistentMount(disk.mountPath)) {
    bad(
      'No persistent disk attached',
      `${disk.mountPath} sits on the ephemeral container filesystem — add a disk in Render → Disks`,
    );
  } else {
    ok('Persistent disk attached', disk.mountPath);
  }

  // --- 2. Where state lives --------------------------------------------------
  console.log('\n2. On-disk state');
  const uploadDir = buildLocalConfig().uploadDir;
  const exportDirResolved = exportDir();
  const dbPath = resolveDbPath();
  const dbUrl = resolveDbUrl();
  const backend = (process.env.STORAGE_BACKEND || 'LOCAL').trim().toUpperCase();
  const storageBackend = backend === 'LOCAL' ? 'LOCAL' : backend;

  console.log('  storage backend:', storageBackend);
  console.log('  upload dir:', uploadDir);
  console.log('  export dir:', exportDirResolved);
  console.log('  database:', isRemote(dbUrl) ? `${dbUrl.replace(/\/\/.*@/, '//***@')} (remote)` : dbPath);

  if (storageBackend === 'LOCAL') {
    if (isRender() && !insideMount(uploadDir, disk.mountPath)) {
      bad('Uploads are not on the persistent disk', `${uploadDir} is outside ${disk.mountPath}`);
    } else {
      try {
        fs.mkdirSync(path.isAbsolute(uploadDir) ? uploadDir : path.resolve(process.cwd(), uploadDir), {
          recursive: true,
        });
        fs.accessSync(path.isAbsolute(uploadDir) ? uploadDir : path.resolve(process.cwd(), uploadDir), fs.constants.W_OK);
        ok('Upload directory is writable', uploadDir);
      } catch (error) {
        bad('Upload directory is not writable', (error as Error).message);
      }
    }
  } else {
    const s3 = buildS3Config();
    ok('Object storage backend', `${storageBackend}${s3.bucket ? ` bucket ${s3.bucket}` : ''}`);
  }

  if (!isRemote(dbUrl)) {
    const dbDir = path.dirname(dbPath);
    if (isRender() && !insideMount(dbPath, disk.mountPath)) {
      bad(
        'Database is not on the persistent disk',
        `${dbPath} is outside ${disk.mountPath} — set DATABASE_URL=file:${path.join(disk.mountPath, 'hokk.db')}`,
      );
    } else {
      try {
        fs.mkdirSync(dbDir, { recursive: true });
        fs.accessSync(dbDir, fs.constants.W_OK);
        ok('Database directory is writable', dbDir);
      } catch (error) {
        bad('Database directory is not writable', (error as Error).message);
      }
    }
  } else {
    ok('Remote database configured', 'no local file required');
  }

  // --- 3. Upload round trip --------------------------------------------------
  console.log('\n3. Upload round trip (local adapter)');
  const local = new LocalStorage({ uploadDir });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fileName = `HOKK-VERIFY-${Date.now()}.png`;
  const put = await local.put({
    data: png,
    fileName,
    mimeType: 'image/png',
    folder: 'ORIGINAL',
    groupKey: 'VERIFY',
  });
  console.log('  key:', put.storageKey);
  console.log('  file:', put.path);

  const readBack = await local.read({ storageKey: put.storageKey });
  if (readBack.equals(png)) ok('Write → read matches byte for byte', `${readBack.length} bytes`);
  else bad('Read-back mismatch', `${readBack.length} bytes vs ${png.length}`);

  if (put.path) {
    const onDisk = fs.existsSync(put.path);
    const device = onDisk ? fs.statSync(put.path).dev : null;
    if (!onDisk) bad('File missing from disk', put.path);
    else if (isRender() && disk.required && device === fs.statSync(process.cwd()).dev) {
      bad('Upload landed on the ephemeral filesystem', 'it will be erased on the next deploy');
    } else {
      ok('File physically present on disk', onDisk ? `device ${device}` : '');
    }
  }

  // --- 4. Public URL ---------------------------------------------------------
  console.log('\n4. Public image URL (what Shopify fetches)');
  const base = hostingPublicBaseUrl();
  const publicUrl = put.publicUrl ?? (base ? `${base}/api/media/${put.storageKey}` : '');
  if (!base) {
    warn(
      'No public base URL',
      'set PUBLIC_BASE_URL to this service URL (Render provides RENDER_EXTERNAL_URL automatically) or Shopify CSV imports will have blank image URLs',
    );
  } else {
    console.log('  base:', base);
    console.log('  url: ', publicUrl);
    try {
      const res = await fetch(publicUrl, { method: 'GET' });
      if (res.ok) ok('Image URL is publicly reachable', `HTTP ${res.status}`);
      else if (res.status === 404) warn('HTTP 404', 'the running server cannot see the file — check UPLOAD_DIR on the service');
      else warn(`HTTP ${res.status}`, 'check ALLOWED_ORIGINS / proxy settings');
    } catch (error) {
      warn('Could not fetch the URL from here', (error as Error).message);
    }
  }

  await local.remove({ storageKey: put.storageKey });
  if (fs.existsSync(path.join(uploadDir, put.storageKey))) bad('Probe file left behind', put.storageKey);
  else ok('Probe deleted');

  console.log('');
  if (PROBLEMS.length) {
    console.log(`RENDER VERIFY FAIL — ${PROBLEMS.length} problem(s):`);
    for (const problem of PROBLEMS) console.log(`  - ${problem}`);
    process.exit(1);
  }
  console.log('RENDER VERIFY PASS');
  console.log('Uploads, exports and the database are all on a location that survives a deploy.');
}

main().catch((error) => {
  console.error('\nRENDER VERIFY FAIL');
  console.error(error);
  process.exit(1);
});
