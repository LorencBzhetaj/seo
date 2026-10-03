import crypto from 'node:crypto';
import { MAX_HISTORY_DAYS, type GscClient, type GscSite, type Row } from './gsc-api.js';
import { arr, obj, str, type Obj } from './store.js';

/**
 * Modeli i të dhënave të Search Console në dashboard (faza 5). Të dhënat ruhen veç nga raportet e auditit
 * dhe s'ndryshojnë Health Score, pikët apo severity-n e gjetjeve: shërbejnë vetëm për të treguar ekspozimin
 * e matur në Google Search dhe, kur përdoruesi e zgjedh, për renditjen e detyrave brenda së njëjtës rëndësi.
 */

export interface Metrics {
  clicks: number;
  impressions: number;
  /** 0–1 */
  ctr: number;
  /** Pozicioni mesatar (i ponderuar sipas impressions kur bashkohen rreshta). */
  position: number;
}

export interface PageRow extends Metrics {
  page: string;
}

export interface QueryRow extends Metrics {
  page: string;
  query: string;
}

export interface GscDataset {
  version: 1;
  id: string;
  property: string;
  propertyType: 'domain' | 'url-prefix';
  permissionLevel: string;
  startDate: string;
  endDate: string;
  /** Data e fundit me të dhëna përfundimtare (dataState=final), e gjetur gjatë marrjes. */
  latestFinalDate: string | null;
  fetchedAt: string;
  searchType: 'web';
  dataState: 'final';
  /** Filtrat e aplikuar në kërkesë (bosh: asnjë filtër vendi/pajisjeje/query). */
  filters: string[];
  /**
   * Totali i property-t nga një kërkesë agregate më vete (pa dimensione, aggregationType=byProperty), jo nga
   * mbledhja e rreshtave të faqeve/kërkimeve (ato mund të jenë të kufizuara ose pa kërkimet anonime).
   * null = API-ja s'ktheu asnjë rresht ("pa të dhëna të kthyera"), që s'është e njëjtë me 0 klikime.
   */
  totals: Metrics | null;
  pages: PageRow[];
  pagesTruncated: boolean;
  queries: QueryRow[];
  queriesTruncated: boolean;
  requests: number;
  /** Vetëm për demonstrim (Google i simuluar, të dhëna fiktive); s'vendoset kurrë nga marrja reale. */
  demo?: true;
}

// ------------------------------------------------------------ datat (GSC përdor orën e Paqësorit, PT)

/** Data e sotme në PT (YYYY-MM-DD). */
export function todayPt(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Data e fundit me të dhëna përfundimtare: kërkesë me dimensionin "date" për 10 ditët e fundit (PT).
 * null kur s'ka asnjë ditë me të dhëna (property pa trafik ose e re) — s'shpiket datë.
 */
export async function latestFinalDate(client: GscClient, siteUrl: string, now = new Date()): Promise<string | null> {
  const end = todayPt(now);
  const r = await client.query(siteUrl, { startDate: addDays(end, -10), endDate: end, dimensions: ['date'], type: 'web', dataState: 'final', rowLimit: 20 });
  const dates = r.rows.map((x) => x.keys[0]!).filter(validDate).sort();
  return dates.length ? dates[dates.length - 1]! : null;
}

export const PERIOD_PRESETS = [7, 28, 90] as const;

/** Validon periudhën: data të vlefshme, fillimi ≤ fundi, fundi ≤ data e fundit përfundimtare, brenda 16 muajve. */
export function validatePeriod(start: string, end: string, latest: string | null, now = new Date()): string | undefined {
  if (!validDate(start) || !validDate(end)) return 'Datat duhet të jenë në formatin YYYY-MM-DD.';
  if (start > end) return 'Data e fillimit është pas datës së mbarimit.';
  if (latest && end > latest) return `Data e fundit me të dhëna përfundimtare është ${latest}; zgjidh një datë mbarimi deri atëherë.`;
  if (!latest && end > addDays(todayPt(now), -3)) return 'Të dhënat e fundit zakonisht vonohen 2–3 ditë; zgjidh një datë mbarimi më të hershme.';
  if (daysBetween(start, todayPt(now)) > MAX_HISTORY_DAYS) return 'Search Console ruan rreth 16 muaj të dhëna; data e fillimit është më e vjetër.';
  return undefined;
}

export function presetPeriod(days: number, latest: string): { startDate: string; endDate: string } {
  return { startDate: addDays(latest, -(days - 1)), endDate: latest };
}

// ------------------------------------------------------------ marrja e të dhënave

const metrics = (r: Row): Metrics => ({ clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });

export async function fetchDataset(client: GscClient, site: GscSite, startDate: string, endDate: string, latest: string | null, now = new Date(), demo = false): Promise<GscDataset> {
  const base = { startDate, endDate, type: 'web' as const, dataState: 'final' as const };
  const totals = await client.query(site.siteUrl, { ...base, aggregationType: 'byProperty' });
  const pages = await client.queryAll(site.siteUrl, { ...base, dimensions: ['page'], aggregationType: 'byPage' });
  const queries = await client.queryAll(site.siteUrl, { ...base, dimensions: ['page', 'query'], aggregationType: 'byPage' });
  const fetchedAt = now.toISOString();
  return {
    version: 1,
    id: crypto.createHash('sha256').update(`${site.siteUrl}|${startDate}|${endDate}|${fetchedAt}`).digest('hex').slice(0, 16),
    property: site.siteUrl,
    propertyType: site.siteUrl.startsWith('sc-domain:') ? 'domain' : 'url-prefix',
    permissionLevel: site.permissionLevel,
    startDate, endDate, latestFinalDate: latest, fetchedAt,
    searchType: 'web', dataState: 'final', filters: [],
    totals: totals.rows[0] ? metrics(totals.rows[0]) : null,
    pages: pages.rows.map((r) => ({ page: r.keys[0] ?? '', ...metrics(r) })).filter((r) => r.page),
    pagesTruncated: pages.truncated,
    queries: queries.rows.map((r) => ({ page: r.keys[0] ?? '', query: r.keys[1] ?? '', ...metrics(r) })).filter((r) => r.page),
    queriesTruncated: queries.truncated,
    requests: 1 + pages.requests + queries.requests,
    ...(demo ? { demo: true as const } : {}),
  };
}

// ------------------------------------------------------------ URL-të dhe property-t

/**
 * Normalizim i sigurt, pa hamendësime: skema/hosti me shkronja të vogla, pa port parazgjedhje, pa fragment,
 * percent-encoding me shkronja të mëdha. Rruga, "/" në fund, www dhe query mbeten siç janë (janë URL të ndryshme).
 */
export function normalizeUrl(u: string): string | null {
  let url: URL;
  try {
    url = new URL(u.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}

/** A e mbulon property-ja këtë URL? Domain: hosti ose nën-domenet; URL-prefix: URL-ja fillon me prefiksin. */
export function propertyCovers(property: string, url: string): boolean {
  const n = normalizeUrl(url);
  if (!n) return false;
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length).toLowerCase();
    const host = new URL(n).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  }
  const prefix = normalizeUrl(property);
  return !!prefix && n.startsWith(prefix);
}

export type ExposureStatus = 'data' | 'no-data' | 'not-covered' | 'invalid';

export interface UrlExposure {
  url: string;
  status: ExposureStatus;
  row?: PageRow;
}

export interface GscIndex {
  dataset: GscDataset;
  byPage: Map<string, PageRow>;
}

export function indexDataset(ds: GscDataset): GscIndex {
  const byPage = new Map<string, PageRow>();
  for (const r of ds.pages) {
    const n = normalizeUrl(r.page);
    if (n && !byPage.has(n)) byPage.set(n, r);
  }
  return { dataset: ds, byPage };
}

/** Ekspozimi i një URL-je: vetëm përputhje e saktë pas normalizimit (e verifikueshme). */
export function exposureOf(ix: GscIndex, url: string): UrlExposure {
  const n = normalizeUrl(url);
  if (!n) return { url, status: 'invalid' };
  if (!propertyCovers(ix.dataset.property, n)) return { url, status: 'not-covered' };
  const row = ix.byPage.get(n);
  return row ? { url, status: 'data', row } : { url, status: 'no-data' };
}

/** Bashkon metrikat e disa faqeve: klikime dhe impressions shumë; CTR = klikime/impressions; pozicioni i ponderuar. */
export function sumMetrics(rows: Metrics[]): Metrics | null {
  if (!rows.length) return null;
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const position = impressions ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / impressions : rows.reduce((s, r) => s + r.position, 0) / rows.length;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

export interface TaskExposure {
  metrics: Metrics | null;
  withData: number;
  noData: number;
  notCovered: number;
  pages: UrlExposure[];
}

export function taskExposure(ix: GscIndex, pages: string[]): TaskExposure {
  const ex = [...new Set(pages)].map((p) => exposureOf(ix, p));
  return {
    metrics: sumMetrics(ex.filter((e) => e.status === 'data').map((e) => e.row!)),
    withData: ex.filter((e) => e.status === 'data').length,
    noData: ex.filter((e) => e.status === 'no-data').length,
    notCovered: ex.filter((e) => e.status === 'not-covered' || e.status === 'invalid').length,
    pages: ex,
  };
}

// ------------------------------------------------------------ raporti ↔ dataset-i

/** Faqet e kontrolluara nga auditi (faqja hyrëse + crawl-i), për përputhjen me faqet e GSC. */
export function auditedPages(r: Obj): { url: string; finalUrl: string }[] {
  const out = [{ url: str(r.url), finalUrl: str(r.finalUrl) || str(r.url) }];
  for (const p of arr(obj(obj(r.site).crawl).pages).map(obj)) out.push({ url: str(p.url), finalUrl: str(p.finalUrl) || str(p.url) });
  return out.filter((p) => p.url);
}

/** Dataset-et që mbulojnë faqen hyrëse të raportit, nga më i fundit. */
export function datasetsForReport(r: Obj, all: GscDataset[]): GscDataset[] {
  const home = str(r.finalUrl) || str(r.url);
  return all.filter((d) => propertyCovers(d.property, home)).sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

/** Shënime për lidhjen raport ↔ periudhë: auditi para/pas periudhës, lista e kufizuar. */
export function overlayNotes(r: Obj, ds: GscDataset): string[] {
  const notes: string[] = [];
  const audit = (str(r.completedAt) || str(r.startedAt)).slice(0, 10);
  if (audit && audit > addDays(ds.endDate, 14)) notes.push(`Auditi (${audit}) është ${daysBetween(ds.endDate, audit)} ditë pas fundit të periudhës GSC: faqet mund të kenë ndryshuar ndërkohë.`);
  if (audit && audit < ds.startDate) notes.push(`Auditi (${audit}) është para periudhës GSC: gjetjet e tij mund të jenë rregulluar gjatë periudhës.`);
  if (ds.pagesTruncated) notes.push(`Lista e faqeve u kufizua te ${ds.pages.length} rreshta: "pa të dhëna të kthyera" mund të jetë faqe jashtë listës.`);
  return notes;
}

/** Kur dy dataset-e s'krahasohen drejtpërdrejt (property, lloji, gjendja, gjatësia ose mbivendosja e periudhës). */
export function compareDatasets(a: GscDataset, b: GscDataset): { comparable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (a.property !== b.property) reasons.push(`property të ndryshme (${a.property} ↔ ${b.property})`);
  if (a.searchType !== b.searchType || a.dataState !== b.dataState) reasons.push('lloj kërkimi ose gjendje të dhënash e ndryshme');
  const la = daysBetween(a.startDate, a.endDate) + 1;
  const lb = daysBetween(b.startDate, b.endDate) + 1;
  if (la !== lb) reasons.push(`periudha me gjatësi të ndryshme (${la} ↔ ${lb} ditë)`);
  if (a.startDate <= b.endDate && b.startDate <= a.endDate) reasons.push('periudhat mbivendosen');
  if (a.pagesTruncated || b.pagesTruncated) reasons.push('njëra listë faqesh u kufizua nga API-ja');
  return { comparable: reasons.length === 0, reasons };
}

export interface CrawlMatch {
  /** Faqet e kontrolluara me përputhje të saktë (URL përfundimtare = URL e GSC). */
  withData: { url: string; row: PageRow }[];
  /** Faqet e kontrolluara (brenda property-t) pa rresht në përgjigjen e GSC. */
  noData: string[];
  /** URL të GSC që crawl-i i pa të ridrejtojnë te një faqe e kontrolluar: s'u bashkuan me faqen fundore. */
  redirectSources: { gscUrl: string; finalUrl: string; row: PageRow }[];
  notCovered: number;
}

/**
 * Përputhja faqe e kontrolluar ↔ URL e GSC: vetëm e saktë (pas normalizimit) me URL-në përfundimtare të crawl-it.
 * Kur GSC ka të dhëna për URL-në e kërkuar që ridrejtoi, ajo raportohet veç (e verifikuar nga crawl-i), pa u
 * mbledhur te faqja fundore: impressions i përkasin URL-së që u shfaq në kërkim.
 */
export function crawlMatch(r: Obj, ix: GscIndex): CrawlMatch {
  const out: CrawlMatch = { withData: [], noData: [], redirectSources: [], notCovered: 0 };
  const seen = new Set<string>();
  for (const p of auditedPages(r)) {
    const fin = normalizeUrl(p.finalUrl);
    if (!fin || seen.has(fin)) continue;
    seen.add(fin);
    const e = exposureOf(ix, fin);
    if (e.status === 'data') out.withData.push({ url: fin, row: e.row! });
    else if (e.status === 'no-data') out.noData.push(fin);
    else out.notCovered++;
    const req = normalizeUrl(p.url);
    if (req && req !== fin) {
      const row = ix.byPage.get(req);
      if (row) out.redirectSources.push({ gscUrl: req, finalUrl: fin, row });
    }
  }
  return out;
}
