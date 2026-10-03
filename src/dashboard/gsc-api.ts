import crypto from 'node:crypto';
import { GSC_SCOPE, redactSecrets, type GscStore, type OAuthClient, type StoredToken } from './gsc-store.js';

/**
 * Google Search Console, vetëm lexim (scope webmasters.readonly).
 * - OAuth 2.0 për aplikacione desktop: redirect loopback http://127.0.0.1:<porti i dashboard-it>/gsc/callback,
 *   PKCE S256 dhe "state" i rastësishëm, një përdorim, 10 minuta.
 *   (https://developers.google.com/identity/protocols/oauth2/native-app)
 * - API: sites.list dhe searchAnalytics.query (https://developers.google.com/webmaster-tools/v1/).
 * Endpoint-et janë fikse në kod. fetch është i injektueshëm: testet s'prekin rrjetin dhe s'përdorin token-a realë.
 */

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const API_BASE = 'https://www.googleapis.com/webmasters/v3';

/** Kufijtë e API-së (dokumentacioni i Search Console): 25 000 rreshta për kërkesë. */
export const ROW_LIMIT = 25_000;
/** Kufiri ynë: sa faqe rezultatesh (×25 000) merren për një dimension; mbi të, lista shënohet e kufizuar. */
export const MAX_PAGES_PER_QUERY = 2;
/** GSC ruan rreth 16 muaj të dhëna. */
export const MAX_HISTORY_DAYS = 16 * 30;

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class GscError extends Error {
  constructor(message: string, readonly kind: 'not-configured' | 'not-connected' | 'reconnect' | 'api' | 'network' | 'invalid', readonly status?: number) {
    super(redactSecrets(message));
  }
}

const b64url = (b: Buffer) => b.toString('base64url');

export interface PendingAuth {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

/** Hapi 1: URL-ja e Google për pëlqimin, me PKCE dhe state. Gjendja mbahet vetëm në memorie. */
export function buildAuthRequest(client: OAuthClient, redirectUri: string, now = Date.now()): { url: string; pending: PendingAuth } {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GSC_SCOPE,
    // offline: refresh token për lexime të mëvonshme; consent: Google e jep refresh token-in në çdo lidhje.
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { url: `${AUTH_URL}?${q.toString()}`, pending: { state, verifier, redirectUri, createdAt: now } };
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/** Verifikon state-in e kthyer nga Google (një përdorim, kohë e kufizuar, krahasim në kohë konstante). */
export function checkState(pending: PendingAuth | undefined, state: string | undefined, now = Date.now()): string | undefined {
  if (!pending) return "S'ka lidhje në pritje: nise sërish nga faqja Search Console.";
  if (now - pending.createdAt > PENDING_TTL_MS) return 'Lidhja skadoi (më shumë se 10 minuta): nise sërish.';
  const a = Buffer.from(pending.state);
  const b = Buffer.from(state ?? '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'State i pavlefshëm: kërkesa s\'erdhi nga kjo lidhje.';
  return undefined;
}

async function postForm(fetchFn: FetchFn, url: string, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  } catch (e) {
    throw new GscError(`Google s'u arrit: ${(e as Error).message}`, 'network');
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

function tokenError(status: number, body: Record<string, unknown>): GscError {
  const err = String(body.error ?? `HTTP ${status}`);
  const desc = typeof body.error_description === 'string' ? `: ${body.error_description}` : '';
  // invalid_grant: token-i u revokua, skadoi (7 ditë kur aplikacioni është në "Testing") ose ndryshoi fjalëkalimi.
  if (err === 'invalid_grant') return new GscError(`Lidhja me Google s'vlen më (${err}${desc}). Nëse projekti yt në Google Cloud është në "Testing", autorizimi skadon pas 7 ditësh. Lidhu sërish.`, 'reconnect', status);
  if (err === 'invalid_client') return new GscError(`Klienti OAuth s'u pranua (${err}${desc}). Kontrollo client_id/client_secret ose importo sërish JSON-in.`, 'not-configured', status);
  return new GscError(`Google refuzoi kërkesën e token-it (${err}${desc}).`, 'api', status);
}

/** Hapi 2: kodi i autorizimit → token-a. Kontrollon që Google dha refresh token dhe scope-in e kërkuar. */
export async function exchangeCode(fetchFn: FetchFn, client: OAuthClient, pending: PendingAuth, code: string, now = Date.now()): Promise<StoredToken> {
  const { status, body } = await postForm(fetchFn, TOKEN_URL, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: pending.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: pending.verifier,
  });
  if (status !== 200) throw tokenError(status, body);
  const scope = String(body.scope ?? '');
  if (!scope.split(/\s+/).includes(GSC_SCOPE)) throw new GscError(`Google s'dha lejen e leximit të Search Console (scope: ${scope || 'asnjë'}). Gjatë pëlqimit, lejo "View Search Console data".`, 'invalid');
  if (typeof body.refresh_token !== 'string') throw new GscError("Google s'ktheu refresh token. Hiqe aksesin te myaccount.google.com/permissions dhe lidhu sërish.", 'invalid');
  return {
    refreshToken: body.refresh_token,
    accessToken: typeof body.access_token === 'string' ? body.access_token : undefined,
    expiresAt: now + Number(body.expires_in ?? 0) * 1000,
    scope,
    connectedAt: new Date(now).toISOString(),
  };
}

export async function refreshAccessToken(fetchFn: FetchFn, client: OAuthClient, token: StoredToken, now = Date.now()): Promise<StoredToken> {
  const { status, body } = await postForm(fetchFn, TOKEN_URL, { client_id: client.clientId, client_secret: client.clientSecret, refresh_token: token.refreshToken, grant_type: 'refresh_token' });
  if (status !== 200) throw tokenError(status, body);
  return { ...token, accessToken: String(body.access_token ?? ''), expiresAt: now + Number(body.expires_in ?? 0) * 1000 };
}

/** Revokon token-in te Google. Gabimi (p.sh. token tashmë i pavlefshëm) s'e ndal fshirjen lokale. */
export async function revokeToken(fetchFn: FetchFn, token: StoredToken): Promise<{ revoked: boolean; httpStatus?: number; error?: string }> {
  try {
    const { status, body } = await postForm(fetchFn, REVOKE_URL, { token: token.refreshToken });
    if (status === 200) return { revoked: true, httpStatus: status };
    // Vetëm kodi i gabimit (p.sh. invalid_token), i kufizuar: s'ruhet tekst arbitrar.
    const code = typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : undefined;
    return { revoked: false, httpStatus: status, error: code };
  } catch {
    return { revoked: false, error: 'network' };
  }
}

// ------------------------------------------------------------ API

export interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

export interface Row {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryBody {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  type?: 'web';
  dataState?: 'final' | 'all';
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
  rowLimit?: number;
  startRow?: number;
}

/** Klient i lidhur: merr access token (e rifreskon kur skadon) dhe thërret API-në. */
export class GscClient {
  constructor(private readonly store: GscStore, private readonly fetchFn: FetchFn, private readonly now: () => number = Date.now) {}

  private async accessToken(): Promise<string> {
    const client = this.store.loadClient();
    if (!client) throw new GscError('Klienti OAuth s\'është importuar.', 'not-configured');
    const token = this.store.loadToken();
    if (!token) throw new GscError('Llogaria Google s\'është e lidhur.', 'not-connected');
    if (token.accessToken && token.expiresAt && token.expiresAt - 60_000 > this.now()) return token.accessToken;
    try {
      const fresh = await refreshAccessToken(this.fetchFn, client, token, this.now());
      this.store.saveToken(fresh);
      return fresh.accessToken!;
    } catch (e) {
      // Token-i s'vlen më: fshihet lokalisht, që ndërfaqja të kërkojë lidhje të re (s'mbetet sekret i vdekur).
      if (e instanceof GscError && e.kind === 'reconnect') this.store.deleteToken();
      throw e;
    }
  }

  private async call(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    let res;
    try {
      res = await this.fetchFn(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new GscError(`Search Console API s'u arrit: ${(e as Error).message}`, 'network');
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    if (!res.ok) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      const msg = typeof e.message === 'string' ? e.message : `HTTP ${res.status}`;
      if (res.status === 401) throw new GscError(`Google s'e pranoi autorizimin (${msg}). Lidhu sërish.`, 'reconnect', 401);
      if (res.status === 403) throw new GscError(`S'ke leje për këtë property ose API s'është aktivizuar në projekt (${msg}).`, 'api', 403);
      if (res.status === 429) throw new GscError(`Kufiri i kërkesave të API-së u arrit (${msg}). Provo më vonë.`, 'api', 429);
      throw new GscError(`Search Console API: ${msg}`, 'api', res.status);
    }
    return json;
  }

  async listSites(): Promise<GscSite[]> {
    const j = await this.call('GET', `${API_BASE}/sites`);
    const entries = Array.isArray(j.siteEntry) ? (j.siteEntry as Record<string, unknown>[]) : [];
    return entries.map((s) => ({ siteUrl: String(s.siteUrl ?? ''), permissionLevel: String(s.permissionLevel ?? '') })).filter((s) => s.siteUrl).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
  }

  async query(siteUrl: string, body: QueryBody): Promise<{ rows: Row[]; aggregation: string; metadata: Record<string, unknown> }> {
    const j = await this.call('POST', `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body);
    const rows = Array.isArray(j.rows) ? (j.rows as Record<string, unknown>[]) : [];
    return {
      rows: rows.map((r) => ({ keys: Array.isArray(r.keys) ? (r.keys as unknown[]).map(String) : [], clicks: Number(r.clicks ?? 0), impressions: Number(r.impressions ?? 0), ctr: Number(r.ctr ?? 0), position: Number(r.position ?? 0) })),
      aggregation: String(j.responseAggregationType ?? ''),
      metadata: (j.metadata ?? {}) as Record<string, unknown>,
    };
  }

  /** Faqëzim me startRow deri në MAX_PAGES_PER_QUERY; truncated=true kur faqja e fundit ishte e plotë. */
  async queryAll(siteUrl: string, body: QueryBody): Promise<{ rows: Row[]; truncated: boolean; requests: number }> {
    const rows: Row[] = [];
    for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
      const r = await this.query(siteUrl, { ...body, rowLimit: ROW_LIMIT, startRow: page * ROW_LIMIT });
      rows.push(...r.rows);
      if (r.rows.length < ROW_LIMIT) return { rows, truncated: false, requests: page + 1 };
    }
    return { rows, truncated: true, requests: MAX_PAGES_PER_QUERY };
  }
}
