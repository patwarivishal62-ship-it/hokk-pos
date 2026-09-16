/**
 * Google Drive OAuth doctor.
 *
 *   npm run drive:doctor
 *
 * Answers the question Google's `401 unauthorized_client` does not: *which*
 * credential is wrong. It reports the credential the server would actually
 * send (masked, with shape checks), performs one live token exchange, and
 * translates the answer into the next action. Never prints a secret in full.
 *
 * Safe to run against production — it only touches the token endpoint.
 * Exits non-zero when the exchange fails.
 */

import {
  classifyTokenError,
  describeCredentialShape,
  explainOAuthFailure,
  maskCredential,
  normalizeCredential,
  parseGoogleErrorBody,
  parseOAuthCredentialBlob,
} from '@/lib/storage/oauth';

const TOKEN_URL = process.env.GDRIVE_OAUTH_BASE?.trim()
  ? `${process.env.GDRIVE_OAUTH_BASE.trim().replace(/\/$/, '')}/token`
  : 'https://oauth2.googleapis.com/token';

const ENV_KEYS = ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN'] as const;

function rule(char = '-'): string {
  return char.repeat(72);
}

function statusIcon(ok: boolean): string {
  return ok ? '✓' : '✗';
}

/** Flags values that only work because we normalise them (quotes, whitespace). */
function describeRaw(key: string, raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return `${key} is set but empty/whitespace only`;
  if (raw !== trimmed) return `${key} has leading/trailing whitespace (stripped at runtime)`;
  const quotes = /^["'].*["']$/s.test(trimmed);
  if (quotes) return `${key} is wrapped in quotes (stripped at runtime — but fix the env value)`;
  return null;
}

async function main(): Promise<void> {
  console.log('HOKK — Google Drive OAuth doctor');
  console.log(rule('='));

  const rawValues: Record<string, string | undefined> = {
    GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID,
    GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET,
    GDRIVE_REFRESH_TOKEN: process.env.GDRIVE_REFRESH_TOKEN,
  };

  const blob = parseOAuthCredentialBlob(rawValues.GDRIVE_REFRESH_TOKEN);
  const clientId = normalizeCredential(rawValues.GDRIVE_CLIENT_ID) || blob?.clientId;
  const clientSecret = normalizeCredential(rawValues.GDRIVE_CLIENT_SECRET) || blob?.clientSecret;
  const refreshToken = blob ? blob.refreshToken : normalizeCredential(rawValues.GDRIVE_REFRESH_TOKEN);

  const serviceAccount = Boolean(
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON?.trim() || process.env.GDRIVE_SERVICE_ACCOUNT_FILE?.trim(),
  );

  console.log('\n1. Credentials this server would send');
  console.log(rule());
  console.log(`   Service account : ${serviceAccount ? 'set (takes priority over OAuth)' : 'not set'}`);
  console.log(`   OAuth flow      : ${blob ? 'GDRIVE_REFRESH_TOKEN holds a Google JSON blob' : 'plain environment values'}`);
  console.log('');

  const shapes: Array<{ key: string; value: string | undefined; kind: 'clientId' | 'clientSecret' | 'refreshToken' }> = [
    { key: 'GDRIVE_CLIENT_ID', value: clientId, kind: 'clientId' },
    { key: 'GDRIVE_CLIENT_SECRET', value: clientSecret, kind: 'clientSecret' },
    { key: 'GDRIVE_REFRESH_TOKEN', value: refreshToken, kind: 'refreshToken' },
  ];

  let allShapesOk = true;
  for (const shape of shapes) {
    const hint = describeCredentialShape(shape.kind, shape.value);
    if (!hint.ok) allShapesOk = false;
    console.log(`   ${statusIcon(hint.ok)} ${shape.key.padEnd(22)} ${maskCredential(shape.value)} — ${hint.detail}`);
  }

  const rawIssues = ENV_KEYS.map((key) => describeRaw(key, rawValues[key])).filter(Boolean) as string[];
  if (rawIssues.length > 0) {
    console.log('\n   Formatting problems in the raw env values:');
    rawIssues.forEach((issue) => console.log(`     ! ${issue}`));
  }

  if (!clientId && !refreshToken && !serviceAccount) {
    console.log('\nNo Google Drive credentials found in the environment.');
    console.log('Set either GDRIVE_SERVICE_ACCOUNT_JSON (recommended for servers) or the OAuth trio:');
    console.log('  GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN');
    process.exit(1);
  }

  if (serviceAccount) {
    console.log('\nA service account is configured — it is tried before the OAuth refresh token.');
    console.log('If you meant to use OAuth, unset GDRIVE_SERVICE_ACCOUNT_JSON / _FILE and re-run.');
  }

  if (!clientId || !refreshToken) {
    console.log('\n' + rule());
    console.log('Diagnosis: OAuth setup is incomplete.');
    console.log(`   ${clientId ? '✓' : '✗'} GDRIVE_CLIENT_ID`);
    console.log(`   ${refreshToken ? '✓' : '✗'} GDRIVE_REFRESH_TOKEN`);
    console.log(`   ${clientSecret ? '✓' : '·'} GDRIVE_CLIENT_SECRET (optional for public/installed clients)`);
    console.log('\nMint a fresh token with this exact client:');
    console.log('   npm run drive:authorize');
    process.exit(1);
  }

  console.log('\n2. Live token exchange');
  console.log(rule());
  console.log(`   POST ${TOKEN_URL}`);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
  if (clientSecret) body.set('client_secret', clientSecret);

  let status = 0;
  let responseBody = '';
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    status = res.status;
    responseBody = await res.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`   ✗ network error: ${message}`);
    console.log('\n' + rule());
    console.log('Diagnosis: could not reach Google.');
    process.exit(1);
  }

  const payload = parseGoogleErrorBody(responseBody);

  if (status === 200) {
    let expiresIn: number | undefined;
    try {
      expiresIn = (JSON.parse(responseBody) as { expires_in?: number }).expires_in;
    } catch {
      /* ignore */
    }
    console.log(`   ✓ 200 OK — access token issued${expiresIn ? ` (expires in ${expiresIn}s)` : ''}`);
    console.log('\n' + rule());
    console.log('Credentials are valid. If uploads still fail, the problem is downstream:');
    console.log('  • GDRIVE_PARENT_FOLDER_ID must be a folder this account can write to');
    console.log('  • the Google Drive API must be enabled for the project');
    console.log('  • then run: npm run drive:verify');
    if (!allShapesOk) {
      console.log('\nNote: this exchange succeeded despite a suspicious credential shape — fix it anyway.');
    }
    process.exit(0);
  }

  const failure = classifyTokenError(status, payload);
  console.log(`   ✗ ${status} ${payload?.error ?? 'unknown_error'}${payload?.error_description ? ` — ${payload.error_description}` : ''}`);
  if (!payload && responseBody) {
    console.log(`   Raw response: ${responseBody.slice(0, 300)}`);
  }

  // Secret-less retry: public/installed clients (Desktop, Android, iOS, Chrome)
  // have no secret, and sending one is itself a cause of unauthorized_client.
  if (clientSecret && (failure === 'unauthorized_client' || failure === 'invalid_client')) {
    console.log('\n   Retrying without client_secret (public/installed clients have none)...');
    const retryBody = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    });
    const retry = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: retryBody.toString(),
    });
    const retryText = await retry.text();
    const retryPayload = parseGoogleErrorBody(retryText);
    if (retry.ok) {
      console.log('   ✓ 200 OK without a client secret — this is a public/installed client.');
      console.log('\n' + rule());
      console.log('Fix: remove GDRIVE_CLIENT_SECRET from the environment (leave it empty).');
      process.exit(0);
    }
    console.log(`   ✗ ${retry.status} ${retryPayload?.error ?? 'unknown_error'} — the secret is not the problem.`);
  }

  console.log('\n' + rule());
  console.log('Diagnosis');
  console.log(rule());
  console.log(explainOAuthFailure(failure, payload));
  console.log('');
  console.log('Re-check any time with: npm run drive:doctor');
  process.exit(1);
}

main().catch((error) => {
  console.error('\nDoctor failed unexpectedly:');
  console.error(error);
  process.exit(1);
});
