import crypto from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { API_BASE, AUTH_URL, buildAuthRequest, checkState, exchangeCode, GscClient, GscError, REVOKE_URL, ROW_LIMIT, TOKEN_URL, type FetchFn } from '../src/dashboard/gsc-api.js';
import { compareDatasets, crawlMatch, exposureOf, fetchDataset, indexDataset, latestFinalDate, normalizeUrl, propertyCovers, taskExposure, todayPt, validatePeriod, type GscDataset } from '../src/dashboard/gsc-model.js';
import { countText, paginate } from '../src/dashboard/views-gsc.js';
import { orderTasks } from '../src/dashboard/views-tasks.js';
import type { Task } from '../src/dashboard/tasks.js';
import { defaultGscDir, displayDir, dpapiProtector, GSC_SCOPE, GscStore, parseClientJson, redactSecrets, type Protector } from '../src/dashboard/gsc-store.js';
import { startDashboard } from '../src/dashboard/server.js';

// ------------------------------------------------------------ të rreme (asnjë token real)

const CLIENT_JSON = JSON.stringify({ installed: { client_id: '1234567890-testclient.apps.googleusercontent.com', project_id: 'seo-tool-test', client_secret: 'GOCSPX-test-not-a-secret', auth_uri: 'https://evil.example/auth', token_uri: 'https://evil.example/token', redirect_uris: ['http://localhost'] } });
const CLIENT = { clientId: '1234567890-testclient.apps.googleusercontent.com', clientSecret: 'GOCSPX-test-not-a-secret', projectId: 'seo-tool-test' };
const REFRESH = '1//test-refresh-token-not-real-0000';
const ACCESS = 'ya29.test-access-token-not-real';

/** "Enkriptim" i rremë për teste: i kthyeshëm, por teksti s'mbetet i lexueshëm. */
const fakeProtector: Protector = {
  kind: 'memory',
  protect: (d) => Buffer.from(d.map((b) => b ^ 0x5a)),
  unprotect: (d) => Buffer.from(d.map((b) => b ^ 0x5a)),
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Google i simuluar: token, revoke, sites, searchAnalytics. */
function fakeGoogle(o: { tokenStatus?: number; tokenBody?: Record<string, unknown>; refreshError?: string; sites?: { siteUrl: string; permissionLevel: string }[]; pages?: { page: string; clicks: number; impressions: number; ctr: number; position: number }[]; dates?: string[]; apiStatus?: number; apiMessage?: string; revokeStatus?: number; totals?: unknown[] } = {}) {
  const calls: Call[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetchFn: FetchFn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? '' });
    if (url === TOKEN_URL) {
      const f = new URLSearchParams(init.body);
      if (f.get('grant_type') === 'refresh_token') return o.refreshError ? reply(400, { error: o.refreshError, error_description: 'Token has been expired or revoked.' }) : reply(200, { access_token: `${ACCESS}-2`, expires_in: 3599, scope: GSC_SCOPE, token_type: 'Bearer' });
      return reply(o.tokenStatus ?? 200, o.tokenBody ?? { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3599, scope: GSC_SCOPE, token_type: 'Bearer' });
    }
    if (url === REVOKE_URL) return o.revokeStatus ? reply(o.revokeStatus, { error: 'invalid_token' }) : reply(200, {});
    if (o.apiStatus) return reply(o.apiStatus, { error: { code: o.apiStatus, message: o.apiMessage ?? 'error' } });
    if (url === `${API_BASE}/sites`) return reply(200, { siteEntry: o.sites ?? [{ siteUrl: 'sc-domain:e.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.example/', permissionLevel: 'siteFullUser' }] });
    if (url.startsWith(`${API_BASE}/sites/`) && url.endsWith('/searchAnalytics/query')) {
      const q = JSON.parse(init.body ?? '{}') as { dimensions?: string[]; startRow?: number };
      const dims = (q.dimensions ?? []).join(',');
      if (dims === 'date') return reply(200, { rows: (o.dates ?? ['2026-09-27', '2026-09-28', '2026-09-29']).map((d) => ({ keys: [d], clicks: 1, impressions: 10, ctr: 0.1, position: 5 })) });
      if (dims === '') return reply(200, { rows: o.totals ?? [{ clicks: 120, impressions: 9000, ctr: 0.0133, position: 14.2 }], responseAggregationType: 'byProperty' });
      const pages = o.pages ?? [
        { page: 'https://e.com/', clicks: 80, impressions: 5000, ctr: 0.016, position: 9.1 },
        { page: 'https://e.com/faq/', clicks: 10, impressions: 1200, ctr: 0.0083, position: 12 },
        { page: 'https://e.com/sq/faq/', clicks: 2, impressions: 300, ctr: 0.0067, position: 20 },
        { page: 'https://e.com/old-page', clicks: 3, impressions: 90, ctr: 0.033, position: 8 },
      ];
      if (q.startRow) return reply(200, { rows: [] });
      if (dims === 'page') return reply(200, { rows: pages.map((p) => ({ keys: [p.page], ...p })), responseAggregationType: 'byPage' });
      if (dims === 'page,query') return reply(200, { rows: [{ keys: ['https://e.com/', 'theth guesthouse'], clicks: 40, impressions: 2000, ctr: 0.02, position: 6.5 }] });
    }
    return reply(404, { error: { message: `e papritur: ${url}` } });
  };
  return { fetchFn, calls };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-test-'));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const newStore = () => {
  const d = tmp();
  dirs.push(d);
  return new GscStore(path.join(d, 'gsc'), fakeProtector);
};

// ------------------------------------------------------------ klienti OAuth dhe ruajtja

describe('GSC: klienti OAuth dhe ruajtja e sigurt', () => {
  it('pranohet vetëm klienti "Desktop app"; endpoint-et e skedarit s\'përdoren', () => {
    const ok = parseClientJson(CLIENT_JSON);
    expect(ok).toEqual({ ok: true, client: CLIENT });
    expect(parseClientJson(JSON.stringify({ web: { client_id: 'x.apps.googleusercontent.com' } }))).toMatchObject({ ok: false, error: expect.stringContaining('Desktop app') });
    expect(parseClientJson('{')).toMatchObject({ ok: false });
    expect(parseClientJson(JSON.stringify({ installed: { client_id: 'evil', client_secret: 's' } }))).toMatchObject({ ok: false, error: expect.stringContaining('client_id') });
  });

  it('klienti dhe token-i ruhen të mbrojtur: skedarët s\'përmbajnë sekretet në tekst; fshirja i heq', () => {
    const s = newStore();
    s.saveClient(CLIENT);
    s.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: 1, scope: GSC_SCOPE, connectedAt: '2026-10-03T00:00:00Z' });
    for (const f of ['client.bin', 'token.bin']) {
      const raw = fs.readFileSync(path.join(s.dir, f), 'latin1');
      expect(raw.startsWith('SEOTOOL-memory\n')).toBe(true);
      expect(raw).not.toContain('GOCSPX');
      expect(raw).not.toContain('test-refresh-token');
    }
    expect(s.loadClient()).toEqual(CLIENT);
    expect(s.loadToken()!.refreshToken).toBe(REFRESH);
    // mbrojtje tjetër → s'lexohet (s'ngatërrohet me tekst të pambrojtur)
    const other = new GscStore(s.dir, { ...fakeProtector, kind: 'file-permissions' });
    expect(() => other.loadToken()).toThrow(/mbrojtje tjetër/);
    s.deleteToken();
    expect(s.loadToken()).toBeUndefined();
    s.deleteAll();
    expect(fs.existsSync(s.dir)).toBe(false);
  });

  it('të dhënat: id e validuar (pa shtegje), fshirja e veçantë e të dhënave', () => {
    const s = newStore();
    s.saveDataset({ id: 'aaaaaaaaaaaaaaaa', x: 1 } as { id: string });
    expect(s.listDatasets()).toHaveLength(1);
    expect(s.loadDataset('../token')).toBeUndefined();
    expect(() => s.saveDataset({ id: '../../x' })).toThrow();
    expect(s.deleteDatasets()).toBe(1);
    expect(s.listDatasets()).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('Windows DPAPI (CurrentUser): enkriptim/dekriptim real me të dhëna provë', () => {
    const p = dpapiProtector();
    const plain = Buffer.from('teksti-prove-jo-token');
    const enc = p.protect(plain);
    expect(enc.toString('latin1')).not.toContain('teksti-prove');
    expect(p.unprotect(enc).toString()).toBe('teksti-prove-jo-token');
  }, 60_000);

  it('redaktimi heq token-a dhe sekrete nga mesazhet', () => {
    expect(redactSecrets(`Bearer ${ACCESS} refresh ${REFRESH} GOCSPX-abc code=4/xyz`)).not.toMatch(/ya29\.|1\/\/test|GOCSPX-abc|4\/xyz/);
  });
});

// ------------------------------------------------------------ OAuth

describe('GSC: hyrja (OAuth desktop + PKCE) dhe dalja', () => {
  it('URL-ja e pëlqimit: vetëm webmasters.readonly, offline, PKCE S256, state, redirect loopback 127.0.0.1', () => {
    const { url, pending } = buildAuthRequest(CLIENT, 'http://127.0.0.1:4790/gsc/callback', 1000);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(AUTH_URL);
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(pending.verifier).digest('base64url'));
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4790/gsc/callback');
    expect(u.searchParams.get('state')).toBe(pending.state);
    expect(url).not.toContain('GOCSPX'); // sekreti s'del në URL
  });

  it('state: mungon, skadoi, s\'përputhet → refuzohet; i saktë → pranohet', () => {
    const { pending } = buildAuthRequest(CLIENT, 'http://127.0.0.1:1/gsc/callback', 0);
    expect(checkState(undefined, pending.state)).toMatch(/pritje/);
    expect(checkState(pending, pending.state, 11 * 60 * 1000)).toMatch(/skadoi/);
    expect(checkState(pending, 'tjetër', 1)).toMatch(/pavlefshëm/);
    expect(checkState(pending, pending.state, 1)).toBeUndefined();
  });

  it('kodi → token-a: verifier dërgohet; mungesa e scope-it ose e refresh token-it → gabim i qartë', async () => {
    const { pending } = buildAuthRequest(CLIENT, 'http://127.0.0.1:1/gsc/callback', 0);
    const g = fakeGoogle();
    const t = await exchangeCode(g.fetchFn, CLIENT, pending, '4/test-code', 1000);
    expect(t).toMatchObject({ refreshToken: REFRESH, accessToken: ACCESS, scope: GSC_SCOPE, expiresAt: 1000 + 3599_000 });
    expect(new URLSearchParams(g.calls[0]!.body).get('code_verifier')).toBe(pending.verifier);
    await expect(exchangeCode(fakeGoogle({ tokenBody: { access_token: 'x', refresh_token: 'y', scope: 'openid' } }).fetchFn, CLIENT, pending, 'c')).rejects.toThrow(/s'dha lejen/);
    await expect(exchangeCode(fakeGoogle({ tokenBody: { access_token: 'x', scope: GSC_SCOPE } }).fetchFn, CLIENT, pending, 'c')).rejects.toThrow(/refresh token/);
    await expect(exchangeCode(fakeGoogle({ tokenStatus: 400, tokenBody: { error: 'invalid_client' } }).fetchFn, CLIENT, pending, 'c')).rejects.toMatchObject({ kind: 'not-configured' });
  });

  it('access token i skaduar → rifreskim; invalid_grant (p.sh. 7 ditë në Testing) → token-i fshihet, kërkohet lidhje e re', async () => {
    const s = newStore();
    s.saveClient(CLIENT);
    s.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: 0, scope: GSC_SCOPE, connectedAt: 'x' });
    const g = fakeGoogle();
    await new GscClient(s, g.fetchFn, () => 10_000).listSites();
    expect(g.calls.map((c) => c.url)).toEqual([TOKEN_URL, `${API_BASE}/sites`]);
    expect(g.calls[1]!.headers.Authorization).toBe(`Bearer ${ACCESS}-2`);
    expect(s.loadToken()!.accessToken).toBe(`${ACCESS}-2`);

    s.saveToken({ refreshToken: REFRESH, expiresAt: 0, scope: GSC_SCOPE, connectedAt: 'x' });
    const err = (await new GscClient(s, fakeGoogle({ refreshError: 'invalid_grant' }).fetchFn).listSites().catch((e) => e)) as GscError;
    expect(err.kind).toBe('reconnect');
    expect(err.message).toContain('7 ditësh');
    expect(s.loadToken()).toBeUndefined();
  });

  it('gabimet e API-së: 401 → lidhu sërish, 403 → leje, 429 → kufi; mesazhi s\'përmban token', async () => {
    const s = newStore();
    s.saveClient(CLIENT);
    s.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: Date.now() + 3600_000, scope: GSC_SCOPE, connectedAt: 'x' });
    const err = async (status: number) => (await new GscClient(s, fakeGoogle({ apiStatus: status, apiMessage: `fail with ${ACCESS}` }).fetchFn).listSites().catch((e) => e)) as GscError;
    expect((await err(401)).kind).toBe('reconnect');
    expect((await err(403)).message).toMatch(/leje/);
    expect((await err(429)).message).toMatch(/Kufiri/);
    expect((await err(500)).message).not.toContain('ya29');
    // pa klient / pa token
    await expect(new GscClient(newStore(), fakeGoogle().fetchFn).listSites()).rejects.toMatchObject({ kind: 'not-configured' });
  });
});

// ------------------------------------------------------------ API, periudhat, URL-të

describe('GSC: faqëzimi, data e fundit, periudhat', () => {
  const connected = () => {
    const s = newStore();
    s.saveClient(CLIENT);
    s.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: Date.now() + 3600_000, scope: GSC_SCOPE, connectedAt: 'x' });
    return s;
  };

  it('faqëzim me startRow: < 25 000 → i plotë; dy faqe të plota → "i kufizuar"', async () => {
    const full = Array.from({ length: ROW_LIMIT }, (_, i) => ({ keys: [`https://e.com/p${i}`], clicks: 0, impressions: 1, ctr: 0, position: 1 }));
    const mk = (pages: unknown[][]) => {
      let i = 0;
      const f: FetchFn = async () => ({ ok: true, status: 200, json: async () => ({ rows: pages[i++] ?? [] }), text: async () => '' });
      return f;
    };
    const a = await new GscClient(connected(), mk([full, full.slice(0, 10)])).queryAll('sc-domain:e.com', { startDate: '2026-09-01', endDate: '2026-09-28', dimensions: ['page'] });
    expect(a).toMatchObject({ truncated: false, requests: 2 });
    expect(a.rows).toHaveLength(ROW_LIMIT + 10);
    const b = await new GscClient(connected(), mk([full, full])).queryAll('sc-domain:e.com', { startDate: '2026-09-01', endDate: '2026-09-28', dimensions: ['page'] });
    expect(b).toMatchObject({ truncated: true, requests: 2 });
  });

  it('data e fundit me të dhëna përfundimtare = data më e vonë e kthyer; asnjë → null (pa shpikur)', async () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(await latestFinalDate(new GscClient(connected(), fakeGoogle({ dates: ['2026-09-28', '2026-09-30', '2026-09-29'] }).fetchFn), 'sc-domain:e.com', now)).toBe('2026-09-30');
    expect(await latestFinalDate(new GscClient(connected(), fakeGoogle({ dates: [] }).fetchFn), 'sc-domain:e.com', now)).toBeNull();
    expect(todayPt(new Date('2026-10-03T05:00:00Z'))).toBe('2026-10-02'); // ende 2 tetor në PT
  });

  it('periudhat: format, rendi, pas datës së fundit, më e vjetër se 16 muaj', () => {
    const now = new Date('2026-10-03T12:00:00Z');
    expect(validatePeriod('2026-09-03', '2026-09-30', '2026-09-30', now)).toBeUndefined();
    expect(validatePeriod('2026-9-3', '2026-09-30', '2026-09-30', now)).toMatch(/YYYY-MM-DD/);
    expect(validatePeriod('2026-02-30', '2026-09-30', '2026-09-30', now)).toMatch(/YYYY-MM-DD/);
    expect(validatePeriod('2026-09-30', '2026-09-01', '2026-09-30', now)).toMatch(/pas datës/);
    expect(validatePeriod('2026-09-01', '2026-10-01', '2026-09-30', now)).toMatch(/2026-09-30/);
    expect(validatePeriod('2025-01-01', '2025-02-01', '2026-09-30', now)).toMatch(/16 muaj/);
    expect(validatePeriod('2026-09-01', '2026-10-02', null, now)).toMatch(/2–3 ditë/);
  });
});

describe('GSC: normalizimi i URL-ve, property-t dhe mungesa e të dhënave', () => {
  it('normalizim pa hamendësime: host/skema të vogla, pa port parazgjedhje dhe fragment; "/" dhe www mbeten', () => {
    expect(normalizeUrl('HTTPS://E.com:443/Faq/#x')).toBe('https://e.com/Faq/');
    expect(normalizeUrl('https://e.com/faq')).not.toBe(normalizeUrl('https://e.com/faq/'));
    expect(normalizeUrl('https://www.e.com/')).not.toBe(normalizeUrl('https://e.com/'));
    expect(normalizeUrl('https://e.com/a%c3%ab')).toBe('https://e.com/a%C3%AB');
    expect(normalizeUrl('https://e.com/aë')).toBe('https://e.com/a%C3%AB');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('nuk-eshte-url')).toBeNull();
  });

  it('mbulimi: domain përfshin nën-domenet dhe protokollet; URL-prefix vetëm prefiksin e saktë', () => {
    expect(propertyCovers('sc-domain:e.com', 'http://www.e.com/x')).toBe(true);
    expect(propertyCovers('sc-domain:e.com', 'https://e.com.evil.net/')).toBe(false);
    expect(propertyCovers('https://e.com/', 'https://e.com/faq/')).toBe(true);
    expect(propertyCovers('https://e.com/', 'http://e.com/faq/')).toBe(false);
    expect(propertyCovers('https://www.e.com/', 'https://e.com/')).toBe(false);
  });

  const ds = (o: Partial<GscDataset> = {}): GscDataset => ({
    version: 1, id: '0123456789abcdef', property: 'sc-domain:e.com', propertyType: 'domain', permissionLevel: 'siteOwner',
    startDate: '2026-09-03', endDate: '2026-09-30', latestFinalDate: '2026-09-30', fetchedAt: '2026-10-03T10:00:00Z', searchType: 'web', dataState: 'final', filters: [],
    totals: { clicks: 95, impressions: 6590, ctr: 0.0144, position: 10 },
    pages: [
      { page: 'https://e.com/', clicks: 80, impressions: 5000, ctr: 0.016, position: 9 },
      { page: 'https://e.com/faq/', clicks: 10, impressions: 1000, ctr: 0.01, position: 12 },
      { page: 'https://e.com/sq/', clicks: 5, impressions: 590, ctr: 0.0085, position: 20 },
    ],
    pagesTruncated: false, queries: [], queriesTruncated: false, requests: 4, ...o,
  });

  it('ekspozimi: përputhje e saktë; URL brenda property-t pa rresht → "pa të dhëna të kthyera" (jo zero); jashtë → s\'mbulohet', () => {
    const ix = indexDataset(ds());
    expect(exposureOf(ix, 'https://E.com/faq/#top')).toMatchObject({ status: 'data', row: { impressions: 1000 } });
    expect(exposureOf(ix, 'https://e.com/faq')).toMatchObject({ status: 'no-data' }); // pa "/" s'është e njëjta URL
    expect(exposureOf(ix, 'https://tjeter.com/')).toMatchObject({ status: 'not-covered' });
    const t = taskExposure(ix, ['https://e.com/', 'https://e.com/faq/', 'https://e.com/kontakt/', 'https://e.com/', 'https://tjeter.com/']);
    expect(t).toMatchObject({ withData: 2, noData: 1, notCovered: 1 });
    expect(t.metrics).toMatchObject({ clicks: 90, impressions: 6000 });
    expect(t.metrics!.ctr).toBeCloseTo(0.015);
    expect(t.metrics!.position).toBeCloseTo((9 * 5000 + 12 * 1000) / 6000); // e ponderuar sipas impressions
  });

  it('faqet e crawl-it: vetëm URL përfundimtare e saktë; URL e GSC që ridrejton raportohet veç, pa u bashkuar', () => {
    const report = { url: 'https://e.com/', finalUrl: 'https://e.com/', site: { crawl: { pages: [{ url: 'https://e.com/sq/', finalUrl: 'https://e.com/sq/kryefaqja/' }, { url: 'https://e.com/faq/', finalUrl: 'https://e.com/faq/' }] } } };
    const m = crawlMatch(report, indexDataset(ds()));
    expect(m.withData.map((x) => x.url)).toEqual(['https://e.com/', 'https://e.com/faq/']);
    expect(m.noData).toEqual(['https://e.com/sq/kryefaqja/']);
    expect(m.redirectSources).toMatchObject([{ gscUrl: 'https://e.com/sq/', finalUrl: 'https://e.com/sq/kryefaqja/' }]);
  });

  it('krahasimi i periudhave: property, gjatësia, mbivendosja dhe lista e kufizuar → s\'krahasohen, me arsyet', () => {
    const a = ds();
    expect(compareDatasets(a, ds({ startDate: '2026-08-06', endDate: '2026-09-02' }))).toEqual({ comparable: true, reasons: [] });
    expect(compareDatasets(a, ds({ property: 'https://e.com/', startDate: '2026-08-06', endDate: '2026-09-02' })).reasons.join(' ')).toContain('property të ndryshme');
    expect(compareDatasets(a, ds({ startDate: '2026-08-01', endDate: '2026-09-02' })).reasons.join(' ')).toContain('gjatësi të ndryshme');
    expect(compareDatasets(a, ds({ startDate: '2026-09-10', endDate: '2026-10-07' })).reasons).toContain('periudhat mbivendosen');
    expect(compareDatasets(a, ds({ startDate: '2026-08-06', endDate: '2026-09-02', pagesTruncated: true })).reasons.join(' ')).toContain('kufizua');
  });
});

// ------------------------------------------------------------ dashboard-i (rrjedha e plotë me Google të simuluar)

describe('GSC në dashboard: lidhja, të dhënat, detyrat, dalja', () => {
  let server: http.Server;
  let base = '';
  let csrf = '';
  let out = '';
  let store: GscStore;
  const g = fakeGoogle();
  const REPORT = 'e.com-20261003-071803.json';
  const keep: string[] = [];

  const get = async (p: string) => {
    const r = await fetch(base + p, { redirect: 'manual' });
    return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
  };
  const post = async (p: string, form: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, token: csrf }).toString() });
    return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
  };
  const noSecrets = (body: string) => {
    for (const s of ['GOCSPX', 'test-refresh-token', 'test-access-token', 'code_verifier']) expect(body, s).not.toContain(s);
  };

  beforeAll(async () => {
    out = tmp();
    const gscDir = tmp();
    store = new GscStore(path.join(gscDir, 'gsc'), fakeProtector);
    fs.writeFileSync(path.join(out, REPORT), JSON.stringify({
      reportSchemaVersion: '4', ruleSetVersion: 'r', url: 'https://e.com/', finalUrl: 'https://e.com/', startedAt: '2026-10-03T07:18:03Z', completedAt: '2026-10-03T07:20:40Z', status: 'completed',
      health: { score: 90, status: 'EXCELLENT', missingCategories: [] }, categories: { performance: 63 },
      issues: [
        { code: 'LCP_POOR', severity: 'high', scope: 'page', module: 'performance', url: 'https://e.com/', affectedPages: ['https://e.com/'], message: 'LCP 5.0s', fix: 'x', evidence: [], priority: 30, confidence: 0.9, needsManualReview: false },
        { code: 'MISSING_CSP', severity: 'low', scope: 'site', module: 'security', url: 'https://e.com/', affectedPages: ['https://e.com/'], message: 'Mungon CSP', fix: 'x', evidence: [], priority: 5, confidence: 1, needsManualReview: false },
      ],
      site: { status: 'completed', crawl: { pagesAnalyzed: 3, urlsDiscovered: 3, pages: [{ url: 'https://e.com/faq/', finalUrl: 'https://e.com/faq/' }, { url: 'https://e.com/kontakt/', finalUrl: 'https://e.com/kontakt/' }] }, issues: [
        { code: 'DUPLICATE_TITLES', severity: 'medium', scope: 'page', module: 'duplicates', url: 'https://e.com/kontakt/', affectedPages: ['https://e.com/kontakt/', 'https://e.com/kontakt-2/'], message: 'Kontakt', fix: 'x', evidence: [], priority: 20, confidence: 1, needsManualReview: false },
        { code: 'DUPLICATE_META_DESCRIPTIONS', severity: 'medium', scope: 'page', module: 'duplicates', url: 'https://e.com/faq/', affectedPages: ['https://e.com/faq/', 'https://e.com/sq/faq/'], message: 'FAQ', fix: 'x', evidence: [], priority: 10, confidence: 1, needsManualReview: false },
      ] },
    }));
    keep.push(out, gscDir);
    const d = await startDashboard({ outputDir: out, port: 0, gsc: { store, fetch: g.fetchFn, now: () => new Date('2026-10-03T12:00:00Z') } });
    server = d.server;
    csrf = d.csrf;
    base = d.url.replace(/\/$/, '');
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const d of keep) fs.rmSync(d, { recursive: true, force: true });
  });

  it('pa konfigurim: hapat, pa sekrete; detyrat pa GSC funksionojnë si më parë', async () => {
    const r = await get('/gsc');
    expect(r.body).toContain('Desktop app');
    expect(r.body).toContain('webmasters.readonly');
    expect(r.body).toContain("s'është importuar");
    const t = await get(`/report/${REPORT}/tasks`);
    expect(t.status).toBe(200);
    // Gjendja e saktë, pa formulimin e vjetër "mjeti s'ka të dhëna Search Console"
    expect(t.body).toContain("Search Console s'është lidhur dhe s'ka periudhë të ruajtur për këtë sit");
    expect(t.body).not.toContain("mjeti s'ka të dhëna Search Console");
  });

  it('importi i klientit: JSON i gabuar refuzohet; i saktë ruhet dhe shfaqet i shkurtuar, pa sekret', async () => {
    expect((await post('/gsc/client', { json: '{"web":{}}' })).status).toBe(400);
    const r = await post('/gsc/client', { json: CLIENT_JSON });
    expect(r.location).toBe('/gsc?msg=imported');
    const page = await get('/gsc?msg=imported');
    expect(page.body).toContain('12345678…');
    noSecrets(page.body);
  });

  it('lidhja: POST → faqe me lidhje te Google (PKCE); callback me state të gabuar refuzohet; me state të saktë → e lidhur', async () => {
    const c = await post('/gsc/connect');
    expect(c.status).toBe(200);
    const auth = c.body.match(/href="(https:\/\/accounts\.google\.com\/[^"]+)"/)![1]!.replace(/&amp;/g, '&');
    const u = new URL(auth);
    expect(u.searchParams.get('redirect_uri')).toBe(`${base}/gsc/callback`);
    noSecrets(c.body);
    expect((await get('/gsc/callback?state=gabim&code=x')).status).toBe(400);
    // state i gabuar s'e konsumon lidhjen; ai i saktë po (një përdorim)
    const ok = await get(`/gsc/callback?state=${u.searchParams.get('state')}&code=4%2Ftest-code`);
    expect(ok.location).toBe('/gsc?msg=connected');
    expect((await get(`/gsc/callback?state=${u.searchParams.get('state')}&code=x`)).status).toBe(400);
    const page = await get('/gsc?msg=connected');
    expect(page.body).toContain('E lidhur</span> që nga');
    expect(page.body).toContain('sc-domain:e.com (siteOwner)');
    noSecrets(page.body);
  });

  it('marrja e të dhënave: property nga lista, 28 ditët e fundit përfundimtare; pamja tregon filtrat, kufijtë dhe datën e fundit', async () => {
    expect((await post('/gsc/fetch', { property: 'sc-domain:evil.com', preset: '28' })).status).toBe(400);
    expect((await post('/gsc/fetch', { property: 'sc-domain:e.com', preset: 'custom', start: '2026-09-01', end: '2026-10-02' })).body).toContain('2026-09-29');
    const r = await post('/gsc/fetch', { property: 'sc-domain:e.com', preset: '28' });
    expect(r.location).toMatch(/^\/gsc\/data\/[a-f0-9]{16}$/);
    const q = g.calls.filter((c) => c.url.endsWith('/searchAnalytics/query')).map((c) => JSON.parse(c.body));
    expect(q.find((b) => (b.dimensions ?? []).join() === 'page')).toMatchObject({ startDate: '2026-09-02', endDate: '2026-09-29', type: 'web', dataState: 'final', rowLimit: 25000 });
    const v = await get(`${r.location}?report=${REPORT}`);
    expect(v.body).toContain('2026-09-02 – 2026-09-29 (28 ditë');
    expect(v.body).toContain('gjendja: final');
    expect(v.body).toContain('25 000 rreshta për kërkesë');
    expect(v.body).toContain('Kërkimet anonime');
    expect(v.body).toContain('theth guesthouse');
    expect(v.body).toContain('API ktheu 4 rreshta · po shfaqen 1–4');
    expect(v.body).toContain('API ktheu 1 rreshta · po shfaqen 1–1');
    expect(v.body).not.toContain('200 të parat');
    // kreu: gjendja e lidhjes, e ruajtur lokalisht dhe katër kartat e totalit (nga kërkesa agregate)
    expect(v.body).toContain('● E lidhur');
    expect(v.body).toContain('e ruajtur lokalisht');
    expect(v.body).toContain('<div class="l">Impressions</div><div class="v">9 000</div>');
    // filtrim dhe faqe: 1 rresht për faqe → faqja 2 nga 4
    const p2 = await get(`${r.location}?n=25&page=e.com`);
    expect(p2.body).toContain('API ktheu 4 rreshta · pas filtrit 4 · po shfaqen 1–4');
    expect((await get(`${r.location}?query=asgje-nuk-perputhet`)).body).toContain('API ktheu 1 rreshta · pas filtrit 0 · po shfaqen 0');
    expect(v.body).toContain('kërkesë agregate më vete');
    expect(v.body).toContain('2 faqe me të dhëna (përputhje e saktë e URL-së përfundimtare), 1 pa të dhëna të kthyera');
    noSecrets(v.body);
  });

  it('detyrat: ekspozimi për çdo detyrë, "pa të dhëna të kthyera" (jo zero); rëndësia teknike e pandryshuar; renditja me GSC vetëm brenda së njëjtës rëndësi', async () => {
    const t = await get(`/report/${REPORT}/tasks`);
    expect(t.body).toContain('Ekspozimi në GSC');
    expect(t.body).toContain('5 000 impressions'); // LCP në faqen hyrëse
    expect(t.body).toContain('pa të dhëna të kthyera');
    // "zero trafik" del vetëm në sqarimin mohues ("s'do të thotë zero trafik"), kurrë si vlerë
    expect(t.body.match(/zero trafik/g)?.length).toBe(t.body.match(/thotë zero trafik/g)?.length);
    expect(t.body).toContain('Rëndësia teknike');
    // detyra me 2 URL: shuma e tyre, e zbërthyer, jo totali unik i property-t
    expect(t.body).toContain('GSC: Σ 1 500 impressions (2 URL)');
    expect(t.body).toContain("S'është totali unik i property-t (9 000 impressions për periudhën)");
    expect(t.body).toContain('Shuma (2 URL)</td><td class="num">12</td><td class="num">1 500</td>');
    expect(t.body).not.toContain("mjeti s'ka të dhëna Search Console");
    // filtrat: seksioni dhe rëndësia; paralajmërimi i mbulimit mbetet
    const fl = await get(`/report/${REPORT}/tasks?area=site&sev=medium`);
    expect(fl.body).toContain('Po shfaqen 2 nga 4 detyra');
    expect(fl.body).toContain('id="mbulimi"');
    expect(fl.body).not.toContain('LCP 5.0s</strong>');
    // teknike: DUPLICATE_TITLES (pa të dhëna) para FAQ (prioriteti i motorit); me GSC: FAQ (1 200 impr.) para
    const tech = await get(`/report/${REPORT}/tasks?rank=technical`);
    const gsc = await get(`/report/${REPORT}/tasks?rank=gsc`);
    const kTech = tech.body.indexOf('>Kontakt<');
    const fTech = tech.body.indexOf('>FAQ<');
    const kG = gsc.body.indexOf('>Kontakt<');
    const fG = gsc.body.indexOf('>FAQ<');
    expect(kTech).toBeLessThan(fTech);
    expect(fG).toBeLessThan(kG);
    // rëndësia e lartë (LCP) mbetet e para në të dyja renditjet
    expect(gsc.body.indexOf('LCP 5.0s')).toBeLessThan(fG);
    // pa GSC: si më parë
    expect((await get(`/report/${REPORT}/tasks?gsc=none`)).body).not.toContain('Ekspozimi në GSC');
    // raporti dhe Health s'ndryshojnë
    expect((await get(`/report/${REPORT}`)).body).toContain('EXCELLENT');
  });

  it('dalja: shkëputja revokon te Google dhe fshin token-in; fshirja e të dhënave dhe e gjithçkaje', async () => {
    const r = await post('/gsc/disconnect');
    expect(r.location).toBe('/gsc?msg=disconnected');
    const after = (await get('/gsc')).body;
    expect(after).toContain('Google konfirmoi revokimin (HTTP 200)');
    expect(after).toContain('○ E shkëputur');
    // periudhat mbeten dhe hapen pa lidhje
    expect(after).toContain('Të dhëna të ruajtura lokalisht');
    expect(after).toContain('hapen pa lidhje');
    const revoke = g.calls.find((c) => c.url === REVOKE_URL)!;
    expect(new URLSearchParams(revoke.body).get('token')).toBe(REFRESH);
    expect(store.loadToken()).toBeUndefined();
    expect(store.listDatasets()).toHaveLength(1);
    expect((await post('/gsc/delete-data')).location).toBe('/gsc?msg=data-deleted');
    expect(store.listDatasets()).toHaveLength(0);
    expect((await post('/gsc/delete-all')).location).toBe('/gsc?msg=all-deleted-none'); // token-i u hoq më sipër
    expect(fs.existsSync(store.dir)).toBe(false);
    expect((await get('/gsc')).body).toContain("s'është importuar");
  });

  it('POST pa token CSRF ose nga origjinë tjetër refuzohet', async () => {
    const r = await fetch(`${base}/gsc/disconnect`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: `token=${csrf}` });
    expect(r.status).toBe(403);
  });
});

describe('GSC: totali i property-t, ruajtja e programit të instaluar, tekstet', () => {
  const connected = () => {
    const s = newStore();
    s.saveClient(CLIENT);
    s.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: Date.now() + 3600_000, scope: GSC_SCOPE, connectedAt: 'x' });
    return s;
  };
  const SITE = { siteUrl: 'sc-domain:e.com', permissionLevel: 'siteOwner' };

  it('totali vjen nga kërkesa agregate më vete (pa dimensione, byProperty), jo nga shuma e faqeve', async () => {
    const g = fakeGoogle();
    const d = await fetchDataset(new GscClient(connected(), g.fetchFn), SITE, '2026-09-02', '2026-09-29', '2026-09-29');
    const bodies = g.calls.filter((c) => c.url.endsWith('/searchAnalytics/query')).map((c) => JSON.parse(c.body) as Record<string, unknown>);
    const agg = bodies.filter((b) => !b.dimensions || (b.dimensions as string[]).length === 0);
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ aggregationType: 'byProperty', type: 'web', dataState: 'final', startDate: '2026-09-02', endDate: '2026-09-29' });
    // Faqet mbledhin 95 klikime / 6 590 impressions; totali është ai i kthyer nga API-ja (120 / 9 000).
    expect(d.pages.reduce((s, p) => s + p.clicks, 0)).toBe(95);
    expect(d.totals).toEqual({ clicks: 120, impressions: 9000, ctr: 0.0133, position: 14.2 });
  });

  it('totali pa rreshta → null ("pa të dhëna të kthyera"), i ndryshëm nga 0 klikime me impressions', async () => {
    const none = await fetchDataset(new GscClient(connected(), fakeGoogle({ totals: [], pages: [] }).fetchFn), SITE, '2026-09-02', '2026-09-29', '2026-09-29');
    expect(none.totals).toBeNull();
    expect(none.pages).toEqual([]);
    const zero = await fetchDataset(new GscClient(connected(), fakeGoogle({ totals: [{ clicks: 0, impressions: 40, ctr: 0, position: 31 }], pages: [{ page: 'https://e.com/', clicks: 0, impressions: 40, ctr: 0, position: 31 }] }).fetchFn), SITE, '2026-09-02', '2026-09-29', '2026-09-29');
    expect(zero.totals).toEqual({ clicks: 0, impressions: 40, ctr: 0, position: 31 });
    // Faqja me 0 klikime ka të dhëna; faqja pa rresht s'ka.
    expect(exposureOf(indexDataset(zero), 'https://e.com/')).toMatchObject({ status: 'data', row: { clicks: 0, impressions: 40 } });
    expect(exposureOf(indexDataset(zero), 'https://e.com/faq/').status).toBe('no-data');
  });

  it('dosja e ruajtjes: %LOCALAPPDATA%\\SEO Tool\\gsc (ose SEO_TOOL_DATA\\gsc), jo TEMP; faqja s\'shfaq emrin e përdoruesit', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\emri\\AppData\\Local', TEMP: 'C:\\Users\\emri\\AppData\\Local\\Temp\\claude\\sesioni' };
    expect(defaultGscDir(env, 'win32')).toBe('C:\\Users\\emri\\AppData\\Local\\SEO Tool\\gsc');
    expect(defaultGscDir(env, 'win32').startsWith(env.TEMP)).toBe(false);
    expect(defaultGscDir({ ...env, SEO_TOOL_DATA: path.join(os.tmpdir(), 'seo-data') }, 'win32')).toBe(path.join(os.tmpdir(), 'seo-data', 'gsc'));
    expect(defaultGscDir({ ...env, SEO_TOOL_GSC_DIR: path.join(os.tmpdir(), 'x') }, 'win32')).toBe(path.join(os.tmpdir(), 'x'));
    expect(displayDir('C:\\Users\\emri\\AppData\\Local\\SEO Tool\\gsc', env)).toBe('%LOCALAPPDATA%\\SEO Tool\\gsc');
    expect(displayDir('D:\\diku\\tjeter\\SEO Tool\\gsc', env)).not.toContain('diku');
  });

  it('tabelat: sa ktheu API-ja, sa mbetën pas filtrit dhe sa shfaqen; faqet e tabelës', () => {
    expect(countText(4, 4, false, 1, 4)).toBe('API ktheu 4 rreshta · po shfaqen 1–4');
    expect(countText(1234, 0, true, 0, 0)).toBe('API ktheu 1 234 rreshta · pas filtrit 0 · po shfaqen 0');
    const rows = Array.from({ length: 130 }, (_, i) => i);
    expect(paginate(rows, '3', 50)).toMatchObject({ page: 3, pages: 3, from: 101, to: 130 });
    expect(paginate(rows, '3', 50).slice).toHaveLength(30);
    expect(paginate(rows, '99', 50).page).toBe(3);
    expect(paginate(rows, 'x', 50)).toMatchObject({ page: 1, from: 1, to: 50 });
    expect(paginate([], '1', 50)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
  });
});

describe('GSC në dashboard: revokimi i pakonfirmuar dhe etiketa Demo', () => {
  const start = async (o: { revokeStatus?: number; demo?: boolean }) => {
    const out = tmp();
    dirsKeep.push(out);
    const store = new GscStore(path.join(out, 'gsc'), fakeProtector);
    const g = fakeGoogle({ revokeStatus: o.revokeStatus });
    const d = await startDashboard({ outputDir: out, port: 0, gsc: { store, fetch: g.fetchFn, now: () => new Date('2026-10-03T12:00:00Z'), demo: o.demo } });
    servers.push(d.server);
    const base = d.url.replace(/\/$/, '');
    const get = async (p: string) => (await fetch(base + p)).text();
    const post = async (p: string, form: Record<string, string> = {}) => {
      const r = await fetch(base + p, { method: 'POST', redirect: 'manual', headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, token: d.csrf }).toString() });
      return { status: r.status, location: r.headers.get('location') ?? '', body: await r.text() };
    };
    return { store, g, get, post };
  };
  const servers: http.Server[] = [];
  const dirsKeep: string[] = [];
  afterAll(async () => {
    for (const s of servers) await new Promise((r) => s.close(r));
    for (const d of dirsKeep) fs.rmSync(d, { recursive: true, force: true });
  });
  const withToken = (store: GscStore) => {
    store.saveClient(CLIENT);
    store.saveToken({ refreshToken: REFRESH, accessToken: ACCESS, expiresAt: Date.now() + 3600_000, scope: GSC_SCOPE, connectedAt: '2026-10-03T12:00:00Z' });
  };

  it('Google s\'e konfirmon revokimin → token-i fshihet lokalisht dhe mesazhi s\'thotë "u revokua"', async () => {
    const t = await start({ revokeStatus: 400 });
    withToken(t.store);
    const r = await t.post('/gsc/disconnect');
    expect(r.location).toBe('/gsc?msg=disconnected-local');
    expect(t.store.loadToken()).toBeUndefined();
    const page = await t.get(r.location);
    expect(page).toContain('revokimi te Google NUK u konfirmua');
    // përgjigjja reale e Google ruhet (pa token) dhe shihet edhe më vonë
    expect(t.store.loadRevokeResult()).toMatchObject({ confirmed: false, httpStatus: 400, error: 'invalid_token' });
    expect(page).toContain("revokimi <strong>s'u konfirmua</strong> (HTTP 400 invalid_token)");
    expect(JSON.stringify(t.store.loadRevokeResult())).not.toContain('refresh');
    expect(page).not.toContain('Google konfirmoi revokimin');
    // pa token: asnjë kërkesë te Google
    const before = t.g.calls.filter((c) => c.url === REVOKE_URL).length;
    expect((await t.post('/gsc/disconnect')).location).toBe('/gsc?msg=disconnected-none');
    expect(t.g.calls.filter((c) => c.url === REVOKE_URL)).toHaveLength(before);
    // fshi gjithçka me revokim të pakonfirmuar
    withToken(t.store);
    expect((await t.post('/gsc/delete-all')).location).toBe('/gsc?msg=all-deleted-local');
    expect(fs.existsSync(t.store.dir)).toBe(false);
  });

  it('revokimi i konfirmuar (200) → "Google konfirmoi revokimin"', async () => {
    const t = await start({});
    withToken(t.store);
    const r = await t.post('/gsc/disconnect');
    expect(r.location).toBe('/gsc?msg=disconnected');
    expect(await t.get(r.location)).toContain('Google konfirmoi revokimin');
  });

  it('demo: çdo faqe GSC dhe periudha e marrë etiketohen "Demo"; marrja reale kurrë', async () => {
    const t = await start({ demo: true });
    withToken(t.store);
    expect(await t.get('/gsc')).toContain('<strong>DEMO</strong>');
    const f = await t.post('/gsc/fetch', { property: 'sc-domain:e.com', preset: '7' });
    const ds = t.store.listDatasets<GscDataset>()[0]!;
    expect(ds.demo).toBe(true);
    expect(await t.get(f.location)).toContain('Demo</span>');
    const real = await start({});
    withToken(real.store);
    expect(await real.get('/gsc')).not.toContain('DEMO');
    await real.post('/gsc/fetch', { property: 'sc-domain:e.com', preset: '7' });
    expect(real.store.listDatasets<GscDataset>()[0]!.demo).toBeUndefined();
  });
});

describe('GSC: renditja opsionale e detyrave', () => {
  const task = (id: string, severity: Task['severity']) => ({ id, severity }) as Task;
  const ex = (impressions: number | null) => ({ metrics: impressions === null ? null : { clicks: 0, impressions, ctr: 0, position: 1 }, withData: impressions === null ? 0 : 1, noData: impressions === null ? 1 : 0, notCovered: 0, pages: [] });

  it('e njëjta rëndësi, ekspozim i ndryshëm → ndërrojnë vend vetëm me GSC; teknike → rendi origjinal', () => {
    const ts = [task('a', 'medium'), task('b', 'medium')];
    const m = new Map([['a', ex(10)], ['b', ex(500)]]);
    expect(orderTasks(ts, m, 'technical').map((t) => t.id)).toEqual(['a', 'b']);
    expect(orderTasks(ts, m, 'gsc').map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('rëndësia më e ulët s\'kalon përpara vetëm nga impressions', () => {
    const ts = [task('high', 'high'), task('low', 'low'), task('med', 'medium')];
    const m = new Map([['high', ex(1)], ['low', ex(100_000)], ['med', ex(null)]]);
    expect(orderTasks(ts, m, 'gsc').map((t) => t.id)).toEqual(['high', 'med', 'low']);
  });

  it('"pa të dhëna të kthyera" del pas detyrave me të dhëna (edhe me 0 impressions), barazimet ruajnë rendin', () => {
    const ts = [task('nd1', 'low'), task('zero', 'low'), task('nd2', 'low'), task('some', 'low')];
    const m = new Map([['nd1', ex(null)], ['zero', ex(0)], ['nd2', ex(null)], ['some', ex(3)]]);
    expect(orderTasks(ts, m, 'gsc').map((t) => t.id)).toEqual(['some', 'zero', 'nd1', 'nd2']);
    // pa periudhë të zgjedhur: s'ndryshon asgjë
    expect(orderTasks(ts, new Map(), 'gsc').map((t) => t.id)).toEqual(['nd1', 'zero', 'nd2', 'some']);
    // rëndësia e detyrave s'preket
    expect(ts.map((t) => t.severity)).toEqual(['low', 'low', 'low', 'low']);
  });
});
