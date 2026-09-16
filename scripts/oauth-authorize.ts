/**
 * Mint a Google Drive refresh token for the OAuth client this app is configured
 * with — the fix for `unauthorized_client`, which almost always means the
 * refresh token was issued by a *different* client than GDRIVE_CLIENT_ID.
 *
 *   npm run drive:authorize
 *   npm run drive:authorize -- --client-id 123-abc.apps.googleusercontent.com --client-secret GOCSPX-…
 *
 * Before running, add this redirect URI to the OAuth client in
 * Google Cloud Console → APIs & Services → Credentials → [your client]:
 *
 *   http://127.0.0.1:8765/callback
 *
 * Then run the script, approve in the browser, and paste the printed value
 * into GDRIVE_REFRESH_TOKEN (same environment as the client id/secret).
 */

import { createServer, type Server } from 'node:http';
import { normalizeCredential } from '@/lib/storage/oauth';

const SCOPE = 'https://www.googleapis.com/auth/drive';

interface Options {
  clientId: string;
  clientSecret: string;
  port: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Partial<Options> & { help?: boolean } {
  const out: Partial<Options> & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--client-id') out.clientId = normalizeCredential(argv[i + 1]);
    else if (arg === '--client-secret') out.clientSecret = normalizeCredential(argv[i + 1]);
    else if (arg === '--port') out.port = Number(argv[i + 1]);
    else if (arg === '--timeout') out.timeoutMs = Number(argv[i + 1]) * 1000;
  }
  return out;
}

function resolveOptions(): Options {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args.clientId || normalizeCredential(process.env.GDRIVE_CLIENT_ID);
  const clientSecret = args.clientSecret || normalizeCredential(process.env.GDRIVE_CLIENT_SECRET) || '';
  return {
    clientId: clientId ?? '',
    clientSecret,
    port: Number.isFinite(args.port) && args.port ? (args.port as number) : 8765,
    timeoutMs: Number.isFinite(args.timeoutMs) && args.timeoutMs ? (args.timeoutMs as number) : 10 * 60 * 1000,
  };
}

function waitForCode(opts: Options, authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<h1>Denied</h1><p>Google returned an error. You can close this tab.</p>');
        finish(() => {
          server.close();
          reject(new Error(`Google returned an error: ${error}`));
        });
        return;
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<h1>No code</h1><p>Missing ?code= parameter.</p>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        '<h1>Connected ✓</h1><p>HOKK has a refresh token. You can close this tab and return to the terminal.</p>',
      );
      finish(() => {
        server.close();
        resolve(code);
      });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => reject(new Error(`Could not listen on port ${opts.port}: ${error.message}`)));
    });

    server.listen(opts.port, '127.0.0.1', () => {
      console.log('\nOpen this URL in your browser and approve access:\n');
      console.log(`  ${authUrl}\n`);
      console.log(`Waiting for the callback on http://127.0.0.1:${opts.port}/callback ...`);
    });

    const timer = setTimeout(() => {
      finish(() => {
        server.close();
        reject(new Error('Timed out waiting for the browser callback.'));
      });
    }, opts.timeoutMs);
    timer.unref?.();
  });
}

async function exchangeCode(opts: Options, code: string, redirectUri: string): Promise<{ refresh_token?: string; access_token?: string }> {
  const body = new URLSearchParams({
    code,
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let json: { refresh_token?: string; access_token?: string; error?: string; error_description?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Unexpected response from Google: ${res.status} ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(
      `Token exchange failed: ${res.status} ${json.error ?? 'unknown_error'} — ${json.error_description ?? ''}\n` +
        'Make sure the redirect URI http://127.0.0.1:' +
        opts.port +
        '/callback is listed under "Authorized redirect URIs" for this client.',
    );
  }
  return json;
}

async function main(): Promise<void> {
  const opts = resolveOptions();

  if (!opts.clientId) {
    console.error('No OAuth client id found.');
    console.error('Pass --client-id <id> (or set GDRIVE_CLIENT_ID) — copy it from');
    console.error('Google Cloud Console → APIs & Services → Credentials.');
    process.exit(1);
  }
  if (!opts.clientId.endsWith('.apps.googleusercontent.com')) {
    console.error(`GDRIVE_CLIENT_ID does not look like an OAuth client id: it should end with .apps.googleusercontent.com`);
  }

  const redirectUri = `http://127.0.0.1:${opts.port}/callback`;
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: opts.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    }).toString();

  console.log('HOKK — Google Drive authorize');
  console.log('='.repeat(72));
  console.log(`Client      : ${opts.clientId}`);
  console.log(`Secret      : ${opts.clientSecret ? 'configured' : 'not set (public/installed client)'}`);
  console.log(`Redirect URI: ${redirectUri}`);
  console.log('\nAdd that redirect URI to the client\'s "Authorized redirect URIs" first,');
  console.log('otherwise Google will refuse the exchange with redirect_uri_mismatch.');

  const code = await waitForCode(opts, authUrl);
  console.log('\nExchanging authorization code...');
  const tokens = await exchangeCode(opts, code, redirectUri);

  if (!tokens.refresh_token) {
    console.error('\nGoogle returned no refresh token.');
    console.error('This happens when the grant was already approved: revoke access at');
    console.error('myaccount.google.com/permissions and run this script again with prompt=consent.');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(72));
  console.log('Success — paste this into your environment (Vercel: Project Settings →');
  console.log('Environment Variables), then redeploy:\n');
  console.log(`GDRIVE_CLIENT_ID="${opts.clientId}"`);
  if (opts.clientSecret) console.log(`GDRIVE_CLIENT_SECRET="${opts.clientSecret}"`);
  console.log(`GDRIVE_REFRESH_TOKEN="${tokens.refresh_token}"`);
  console.log('\nThen verify:  npm run drive:doctor');
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
