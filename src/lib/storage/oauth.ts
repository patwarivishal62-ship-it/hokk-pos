/**
 * OAuth helpers for the Google Drive adapter.
 *
 * Two jobs, both pure and unit-testable:
 *
 *   1. Normalise credentials. Copy-pasting an OAuth client id / secret / refresh
 *      token into `.env`, a Vercel env var or a secret store routinely leaves
 *      wrapping quotes, stray whitespace or a whole Google JSON file behind.
 *      Those survive `trim()` and reach Google verbatim, which answers with a
 *      terse `unauthorized_client` that names no variable.
 *   2. Turn Google's token-endpoint errors into instructions. `unauthorized_client`
 *      / `invalid_client` / `invalid_grant` each have a specific fix; surfacing
 *      the raw JSON body in the Settings UI helps nobody.
 */

/** Google's token endpoint error payload. */
export interface GoogleErrorPayload {
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export type GoogleOAuthFailure =
  | 'unauthorized_client'
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_scope'
  | 'access_denied'
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'unknown';

/**
 * Strips the decorations that survive copy-paste: surrounding whitespace,
 * a matched pair of `"` or `'` (twice, for `""value""`), and a trailing comma
 * left over from a JSON fragment.
 */
export function normalizeCredential(value: string | undefined | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  let out = value.trim();
  if (!out) return undefined;
  for (let i = 0; i < 2; i += 1) {
    if (out.length >= 2 && ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))) {
      out = out.slice(1, -1).trim();
    }
  }
  out = out.replace(/,+$/, '');
  return out || undefined;
}

export interface OAuthCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

function decodeMaybeBase64(raw: string): string {
  if (raw.startsWith('{')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded.startsWith('{') ? decoded : raw;
  } catch {
    return raw;
  }
}

/**
 * Accepts a pasted Google credential blob in place of a bare refresh token:
 * the consent-flow token JSON (`{"refresh_token": "1//0…", "client_id": …,
 * "client_secret": …}`), a downloaded `credentials.json` (`{"installed": {…}}`
 * or `{"web": {…}}`), or either of those base64-encoded.
 * Returns null when the value is a plain token, so the caller keeps using it as-is.
 */
export function parseOAuthCredentialBlob(value: string | undefined | null): OAuthCredentials | null {
  const raw = normalizeCredential(value);
  if (!raw) return null;
  const candidate = decodeMaybeBase64(raw);
  if (!candidate.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const root = parsed as Record<string, unknown>;
  // credentials.json nests the fields under "installed" or "web".
  const nested = (['installed', 'web', 'oauth_client'] as const)
    .map((key) => root[key])
    .find((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  const source: Record<string, unknown> = nested ? { ...root, ...nested } : root;

  const clientId = normalizeCredential(source.client_id as string | undefined);
  const clientSecret = normalizeCredential(source.client_secret as string | undefined);
  const refreshToken = normalizeCredential(source.refresh_token as string | undefined);
  if (!clientId && !clientSecret && !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export function parseGoogleErrorBody(text: string | null | undefined): GoogleErrorPayload | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as GoogleErrorPayload)
      : null;
  } catch {
    return null;
  }
}

export function classifyTokenError(status: number, payload: GoogleErrorPayload | null): GoogleOAuthFailure {
  switch (payload?.error) {
    case 'unauthorized_client':
      return 'unauthorized_client';
    case 'invalid_client':
      return 'invalid_client';
    case 'invalid_grant':
      return 'invalid_grant';
    case 'invalid_scope':
      return 'invalid_scope';
    case 'access_denied':
      return 'access_denied';
    default:
      break;
  }
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Higher rank = more specific diagnosis. Used when both a with-secret and a
 * secret-less token exchange fail, to report the error that actually explains
 * the problem (`invalid_grant` about the token beats `unauthorized_client`
 * about the client).
 */
const SPECIFICITY: Record<GoogleOAuthFailure, number> = {
  unknown: 0,
  network: 0,
  server_error: 1,
  rate_limited: 2,
  unauthorized_client: 3,
  invalid_client: 3,
  access_denied: 4,
  invalid_scope: 4,
  invalid_grant: 5,
};

export function moreSpecificFailure(a: GoogleOAuthFailure, b: GoogleOAuthFailure): GoogleOAuthFailure {
  return SPECIFICITY[b] > SPECIFICITY[a] ? b : a;
}

/** Masks a secret for logs/UI: keeps a recognisable prefix and the last 4 chars. */
export function maskCredential(value: string | undefined | null): string {
  const raw = normalizeCredential(value);
  if (!raw) return '(not set)';
  const tail = raw.slice(-4);
  const head = raw.slice(0, Math.min(raw.length, Math.max(0, raw.length - 8)));
  return `${'*'.repeat(Math.min(head.length, 12))}${tail} (${raw.length} chars)`;
}

export interface CredentialShapeHint {
  ok: boolean;
  detail: string;
}

/** Cheap shape checks — these catch the majority of mis-pasted values. */
export function describeCredentialShape(kind: 'clientId' | 'clientSecret' | 'refreshToken', value: string | undefined): CredentialShapeHint {
  const raw = normalizeCredential(value);
  if (!raw) return { ok: false, detail: 'not set' };
  if (kind === 'clientId') {
    const ok = raw.endsWith('.apps.googleusercontent.com') && raw.length > 20;
    return {
      ok,
      detail: ok ? 'looks like an OAuth client id' : 'should end with .apps.googleusercontent.com',
    };
  }
  if (kind === 'clientSecret') {
    const ok = /^(GOCSPX-|d-|[A-Za-z0-9_-]{20,})/.test(raw);
    return { ok, detail: ok ? 'looks like a client secret' : 'usually starts with GOCSPX-' };
  }
  const looksLikeAccessToken = raw.startsWith('ya29.');
  if (looksLikeAccessToken) {
    return { ok: false, detail: 'this is an ACCESS token (ya29.), not a refresh token — it cannot be refreshed' };
  }
  const ok = raw.startsWith('1//') || raw.startsWith('1/');
  return { ok, detail: ok ? 'looks like a refresh token' : 'should start with 1//' };
}

/**
 * Builds the actionable part of an OAuth failure. Deliberately names the env
 * vars and the order to check them, because the raw Google error does not.
 */
export function explainOAuthFailure(
  failure: GoogleOAuthFailure,
  payload: GoogleErrorPayload | null,
): string {
  const googleSaid = payload?.error_description ? ` Google said: "${payload.error_description}".` : '';
  switch (failure) {
    case 'unauthorized_client':
      return (
        'The OAuth client this server presents is not the client that issued the refresh token' +
        `${googleSaid}\n` +
        'Fix, in this order:\n' +
        '  1. Google Cloud Console → APIs & Services → Credentials → open the OAuth client you used to create the refresh token. ' +
        'Copy its Client ID into GDRIVE_CLIENT_ID and its Client secret into GDRIVE_CLIENT_SECRET. All three values (plus GDRIVE_REFRESH_TOKEN) must come from the SAME client and the SAME project.\n' +
        '  2. If the refresh token came from the OAuth Playground or a different client, re-mint it with this client: npm run drive:authorize\n' +
        '  3. GDRIVE_REFRESH_TOKEN must start with "1//" — a value starting with "ya29." is a short-lived access token and can never be refreshed.\n' +
        '  4. Set the variables in the environment the running server actually reads (on Vercel: Project Settings → Environment Variables) and redeploy.'
      );
    case 'invalid_client':
      return (
        'Google does not recognise this client_id/client_secret pair' +
        `${googleSaid}\n` +
        'Fix, in this order:\n' +
        '  1. Re-copy GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET straight from the console — no quotes, no line breaks, no trailing spaces.\n' +
        '  2. Confirm the OAuth client still exists and belongs to this project; deleted or disabled clients return this error.\n' +
        '  3. If this is a public/installed client (Desktop, Android, iOS, Chrome) it may have no secret at all — leave GDRIVE_CLIENT_SECRET empty and the app will retry without it.'
      );
    case 'invalid_grant':
      return (
        'The refresh token is expired, revoked or was never issued to this client' +
        `${googleSaid}\n` +
        'Fix, in this order:\n' +
        '  1. Re-mint a refresh token with this exact client: npm run drive:authorize, then set GDRIVE_REFRESH_TOKEN.\n' +
        '  2. A refresh token dies when the user changes their Google password, revokes access (myaccount.google.com/permissions), or when the app is in Testing mode and the grant is older than 7 days.\n' +
        '  3. Verify the token belongs to the same client as GDRIVE_CLIENT_ID — a token from another client gives this same error.'
      );
    case 'invalid_scope':
      return (
        'The requested scope is not valid for this client' +
        `${googleSaid}\n` +
        'Fix: enable the Google Drive API for this project (APIs & Services → Library → Google Drive API → Enable), then re-mint the token with the drive scope: npm run drive:authorize'
      );
    case 'access_denied':
      return (
        'Google denied the request for this client' +
        `${googleSaid}\n` +
        'Fix: enable the Google Drive API for the project that owns GDRIVE_CLIENT_ID, and make sure the consent screen is not blocking the account (add it as a test user while the app is unverified).'
      );
    case 'rate_limited':
      return 'Google is rate-limiting token refreshes (429). Wait a few minutes and retry; avoid firing many uploads at once.';
    case 'server_error':
      return `Google's token endpoint returned a server error (${payload?.error ?? 'unknown'}). This is usually transient — retry in a moment.`;
    case 'network':
      return 'Could not reach Google’s token endpoint. Check outbound network access / DNS from the server (Vercel functions do allow HTTPS egress, but proxies do not).';
    default:
      return (
        'Google rejected the token exchange.' +
        `${googleSaid}` +
        (payload?.error ? ` Error code: ${payload.error}.` : '') +
        ' Run npm run drive:doctor for a full credential report.'
      );
  }
}

export interface OAuthFailureContext {
  status: number;
  body: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  sentClientSecret: boolean;
}

export class DriveOAuthError extends Error {
  readonly failure: GoogleOAuthFailure;
  readonly status: number;

  constructor(failure: GoogleOAuthFailure, status: number, message: string) {
    super(message);
    this.name = 'DriveOAuthError';
    this.failure = failure;
    this.status = status;
  }
}

/** Composes the full, operator-readable error for a failed token exchange. */
export function buildOAuthError(ctx: OAuthFailureContext): DriveOAuthError {
  const payload = parseGoogleErrorBody(ctx.body);
  const failure = classifyTokenError(ctx.status, payload);
  const summary = [
    `grant=refresh_token`,
    `client_id=${maskCredential(ctx.clientId)}`,
    `client_secret=${ctx.sentClientSecret ? maskCredential(ctx.clientSecret) : '(not sent)'}`,
    `refresh_token=${maskCredential(ctx.refreshToken)}`,
  ].join(' ');

  const head = `Failed to obtain access token (refresh token): ${ctx.status} ${payload?.error ?? 'unknown_error'}`;
  const message = `${head}\n\n${explainOAuthFailure(failure, payload)}\n\nSent: ${summary}`;
  return new DriveOAuthError(failure, ctx.status, message);
}
