/**
 * OAuth credential handling for the Google Drive adapter.
 *
 * These cover the failure the Settings page used to report as a bare
 * `401 unauthorized_client`: mis-pasted credentials, tokens minted by another
 * OAuth client, public clients with no secret, and a revoked token cached
 * mid-flight.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GoogleDriveStorage } from '@/lib/storage/gdrive';
import {
  classifyTokenError,
  describeCredentialShape,
  explainOAuthFailure,
  maskCredential,
  normalizeCredential,
  parseOAuthCredentialBlob,
} from '@/lib/storage/oauth';

interface TokenCall {
  grant_type: string | null;
  client_id: string | null;
  client_secret: string | null;
  refresh_token: string | null;
}

let server: Server;
let base: string;
let tokenCalls: TokenCall[] = [];
let driveCalls = 0;
let folderCount = 0;
let tokenMode: 'ok' | 'reject-secret' | 'reject-always' | 'invalid-grant' = 'ok';
let firstDriveCallStatus = 200;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (url.pathname === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(body.toString('utf8'));
        tokenCalls.push({
          grant_type: form.get('grant_type'),
          client_id: form.get('client_id'),
          client_secret: form.get('client_secret'),
          refresh_token: form.get('refresh_token'),
        });
        if (tokenMode === 'reject-always') {
          send(401, { error: 'unauthorized_client', error_description: 'Unauthorized' });
          return;
        }
        if (tokenMode === 'reject-secret' && form.get('client_secret')) {
          send(401, { error: 'unauthorized_client', error_description: 'Unauthorized' });
          return;
        }
        if (tokenMode === 'invalid-grant') {
          if (form.get('client_secret')) {
            send(401, { error: 'unauthorized_client', error_description: 'Unauthorized' });
          } else {
            send(400, { error: 'invalid_grant', error_description: 'Bad Request' });
          }
          return;
        }
        send(200, { access_token: `token-${tokenCalls.length}`, expires_in: 3600, token_type: 'Bearer' });
        return;
      }

      if (!req.headers.authorization?.startsWith('Bearer ')) {
        send(401, { error: 'unauthorized' });
        return;
      }

      if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
        driveCalls += 1;
        if (firstDriveCallStatus !== 200 && driveCalls === 1) {
          send(firstDriveCallStatus, { error: { code: 401, message: 'Invalid Credentials' } });
          return;
        }
        send(200, { files: [] });
        return;
      }

      if (url.pathname === '/drive/v3/files' && req.method === 'POST') {
        folderCount += 1;
        send(200, { id: `folder-${folderCount}`, name: 'folder' });
        return;
      }

      send(404, { error: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  tokenCalls = [];
  driveCalls = 0;
  folderCount = 0;
  tokenMode = 'ok';
  firstDriveCallStatus = 200;
});

function oauthDrive(overrides: Partial<{ clientId: string; clientSecret: string; refreshToken: string }> = {}) {
  return new GoogleDriveStorage({
    apiBase: base,
    oauthBase: base,
    clientId: overrides.clientId ?? '123-abc.apps.googleusercontent.com',
    clientSecret: overrides.clientSecret ?? 'GOCSPX-secret',
    refreshToken: overrides.refreshToken ?? '1//0refresh-token',
  });
}

describe('normalizeCredential', () => {
  it('strips wrapping quotes and whitespace left by copy-paste', () => {
    expect(normalizeCredential('  "1//0abc"  ')).toBe('1//0abc');
    expect(normalizeCredential("'GOCSPX-abc'")).toBe('GOCSPX-abc');
    expect(normalizeCredential('""1//0abc""')).toBe('1//0abc');
    expect(normalizeCredential('1//0abc,\n')).toBe('1//0abc');
  });

  it('returns undefined for empty or missing values', () => {
    expect(normalizeCredential('')).toBeUndefined();
    expect(normalizeCredential('   ')).toBeUndefined();
    expect(normalizeCredential(undefined)).toBeUndefined();
  });

  it('leaves a clean value untouched', () => {
    expect(normalizeCredential('1//0abcDEF')).toBe('1//0abcDEF');
  });
});

describe('parseOAuthCredentialBlob', () => {
  it('reads a pasted consent-flow token JSON', () => {
    const blob = JSON.stringify({
      client_id: '123-abc.apps.googleusercontent.com',
      client_secret: 'GOCSPX-secret',
      refresh_token: '1//0refresh-token',
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    expect(parseOAuthCredentialBlob(blob)).toEqual({
      clientId: '123-abc.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-secret',
      refreshToken: '1//0refresh-token',
    });
  });

  it('reads a downloaded credentials.json (installed or web)', () => {
    const installed = JSON.stringify({
      installed: { client_id: 'id.apps.googleusercontent.com', client_secret: 'GOCSPX-x' },
    });
    expect(parseOAuthCredentialBlob(installed)?.clientId).toBe('id.apps.googleusercontent.com');
    const web = JSON.stringify({ web: { client_id: 'web.apps.googleusercontent.com', client_secret: 'GOCSPX-y' } });
    expect(parseOAuthCredentialBlob(web)?.clientId).toBe('web.apps.googleusercontent.com');
  });

  it('reads a base64-encoded blob', () => {
    const blob = Buffer.from(JSON.stringify({ refresh_token: '1//0b64' })).toString('base64');
    expect(parseOAuthCredentialBlob(blob)?.refreshToken).toBe('1//0b64');
  });

  it('returns null for a plain token so the caller keeps using it as-is', () => {
    expect(parseOAuthCredentialBlob('1//0plain-token')).toBeNull();
    expect(parseOAuthCredentialBlob(undefined)).toBeNull();
    expect(parseOAuthCredentialBlob('{not json')).toBeNull();
  });
});

describe('credential shape hints', () => {
  it('spots an access token pasted in place of a refresh token', () => {
    const hint = describeCredentialShape('refreshToken', 'ya29.a0AfH6SMBexample');
    expect(hint.ok).toBe(false);
    expect(hint.detail).toMatch(/ACCESS token/i);
  });

  it('accepts well-formed values', () => {
    expect(describeCredentialShape('clientId', '123-abc.apps.googleusercontent.com').ok).toBe(true);
    expect(describeCredentialShape('clientSecret', 'GOCSPX-abcdefghijk').ok).toBe(true);
    expect(describeCredentialShape('refreshToken', '1//0gH2kLm').ok).toBe(true);
  });

  it('never prints a secret in full', () => {
    const masked = maskCredential('GOCSPX-abcdefghijklmnop');
    expect(masked).not.toContain('abcdefghijklmnop');
    expect(masked).toContain('mnop');
  });
});

describe('error classification', () => {
  it('maps Google error codes', () => {
    expect(classifyTokenError(401, { error: 'unauthorized_client' })).toBe('unauthorized_client');
    expect(classifyTokenError(400, { error: 'invalid_grant' })).toBe('invalid_grant');
    expect(classifyTokenError(429, null)).toBe('rate_limited');
    expect(classifyTokenError(500, null)).toBe('server_error');
  });

  it('names the env vars to check for unauthorized_client', () => {
    const text = explainOAuthFailure('unauthorized_client', { error_description: 'Unauthorized' });
    expect(text).toMatch(/GDRIVE_CLIENT_ID/);
    expect(text).toMatch(/GDRIVE_REFRESH_TOKEN/);
    expect(text).toMatch(/drive:authorize/);
    expect(text).not.toMatch(/GDRIVE_CLIENT_SECRET\s+must be deleted/);
  });
});

describe('GoogleDriveStorage OAuth refresh grant', () => {
  it('normalises quoted credentials before sending them', async () => {
    const drive = oauthDrive({
      clientId: '"123-abc.apps.googleusercontent.com"',
      clientSecret: '"GOCSPX-secret"',
      refreshToken: '  "1//0refresh-token"  ',
    });
    await expect(drive.getAccessToken()).resolves.toBe('token-1');
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].client_id).toBe('123-abc.apps.googleusercontent.com');
    expect(tokenCalls[0].client_secret).toBe('GOCSPX-secret');
    expect(tokenCalls[0].refresh_token).toBe('1//0refresh-token');
  });

  it('collapses concurrent refreshes into one token request', async () => {
    const drive = oauthDrive();
    const tokens = await Promise.all([drive.getAccessToken(), drive.getAccessToken(), drive.getAccessToken()]);
    expect(tokens).toEqual(['token-1', 'token-1', 'token-1']);
    expect(tokenCalls).toHaveLength(1);
  });

  it('retries without a client secret for public/installed clients', async () => {
    tokenMode = 'reject-secret';
    const drive = oauthDrive();
    await expect(drive.getAccessToken()).resolves.toBe('token-2');
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls[0].client_secret).toBe('GOCSPX-secret');
    expect(tokenCalls[1].client_secret).toBeNull();
  });

  it('reports the most specific failure when both attempts fail', async () => {
    tokenMode = 'invalid-grant';
    const drive = oauthDrive();
    await expect(drive.getAccessToken()).rejects.toThrow(/invalid_grant/);
  });

  it('explains unauthorized_client instead of dumping the raw body', async () => {
    tokenMode = 'reject-always';
    const drive = oauthDrive();
    await expect(drive.getAccessToken()).rejects.toThrow(
      /Failed to obtain access token \(refresh token\): 401 unauthorized_client[\s\S]*GDRIVE_CLIENT_ID/,
    );
  });

  it('masks credentials in the error message', async () => {
    tokenMode = 'reject-always';
    const drive = oauthDrive({ refreshToken: '1//0super-secret-refresh-token' });
    let message = '';
    try {
      await drive.getAccessToken();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/refresh_token=/);
    expect(message).not.toContain('super-secret-refresh-token');
  });

  it('treats a client secret as optional when checking configuration', () => {
    expect(oauthDrive({ clientSecret: '' }).isConfigured()).toBe(true);
  });

  it('recovers from a revoked token instead of failing until restart', async () => {
    firstDriveCallStatus = 401;
    const drive = oauthDrive();
    const folders = await drive.ensureFolders();
    expect(folders.originalFolderId).toBeTruthy();
    expect(folders.finalFolderId).toBeTruthy();
    // The 401 invalidated the cached token, so a fresh one was minted.
    expect(tokenCalls.length).toBeGreaterThan(1);
    expect(driveCalls).toBeGreaterThan(3);
  });
});
