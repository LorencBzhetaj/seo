import fs from 'node:fs';
import path from 'node:path';

/**
 * Leximi i raporteve nga dosja output/. Raportet trajtohen si të dhëna të pabesuara: emrat validohen,
 * shtegu s'del jashtë dosjes (as me symlink), madhësia kufizohet dhe forma e JSON-it s'supozohet —
 * çdo fushë lexohet me kontroll tipi (versionet e vjetra 1–3 s'kanë site/business/quality).
 */

export const MAX_REPORT_BYTES = 25 * 1024 * 1024;

export type ReportKind = 'url' | 'folder' | 'repo';
export type RunStatus = 'complete' | 'partial' | 'unknown';

export interface ReportSummary {
  file: string;
  kind: ReportKind;
  /** Hosti (URL) ose emri i dosjes/repo-s. */
  target: string;
  /** Çelësi për krahasim: vetëm raporte me të njëjtin çelës krahasohen. */
  siteKey: string;
  date?: string;
  schema: string;
  status: RunStatus;
  /** Health Score vlen vetëm për faqen hyrëse (auditi i URL-së). */
  health?: { score: number | null; status: string };
  /** Mbulimi i crawl-it (gjithë siti): i pjesshëm kur discovered > checked. */
  siteCoverage?: { checked: number; discovered: number; truncated: boolean };
  issueCount: number;
  lhrFile?: string;
}

export interface ListResult {
  reports: ReportSummary[];
  /** Skedarë .json që s'u lexuan (JSON i pavlefshëm, tepër i madh, formë e panjohur). */
  invalid: { file: string; reason: string }[];
}

// --- lexues të sigurt fushash ---
export type Obj = Record<string, unknown>;
export const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
export const obj = (x: unknown): Obj => (isObj(x) ? x : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const str = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '');
export const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}._-]{0,200}$/u;

/** Emër raporti i vlefshëm: pa ndarës shtegu, pa "..", vetëm .json (jo .lhr.json). */
export function isReportName(name: string): boolean {
  return NAME.test(name) && name.endsWith('.json') && !name.endsWith('.lhr.json') && !name.includes('..');
}

export function isLhrName(name: string): boolean {
  return NAME.test(name) && name.endsWith('.lhr.json') && !name.slice(0, -'.lhr.json'.length).includes('..');
}

/** Shtegu real brenda `root` (pas symlink-eve), ose undefined. */
export function resolveInside(root: string, rel: string): string | undefined {
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(root, rel));
    const r = path.relative(realRoot, real);
    return r && !r.startsWith('..') && !path.isAbsolute(r) ? real : undefined;
  } catch {
    return undefined;
  }
}

/** Screenshot i një raporti: vetëm output/visual/<dosje>/<skedar>.jpg|png, që ekziston. */
export function screenshotPath(outputDir: string, rel: string): string | undefined {
  if (!/^visual\/[\p{L}\p{N}_][\p{L}\p{N}._-]*\/[\p{L}\p{N}_][\p{L}\p{N}._-]*\.(jpe?g|png)$/u.test(rel) || rel.includes('..')) return undefined;
  const p = resolveInside(path.join(outputDir, 'visual'), rel.slice('visual/'.length));
  return p && fs.statSync(p).isFile() ? p : undefined;
}

export function lhrPath(outputDir: string, name: string): string | undefined {
  if (!isLhrName(name)) return undefined;
  const p = resolveInside(outputDir, name);
  return p && fs.statSync(p).isFile() ? p : undefined;
}

export function readReport(outputDir: string, name: string): { ok: true; report: Obj } | { ok: false; reason: string } {
  if (!isReportName(name)) return { ok: false, reason: 'Emër raporti i pavlefshëm' };
  const p = resolveInside(outputDir, name);
  if (!p) return { ok: false, reason: 'Raporti s\'u gjet në dosjen e raporteve' };
  const size = fs.statSync(p).size;
  if (size > MAX_REPORT_BYTES) return { ok: false, reason: `Tepër i madh (${Math.round(size / 1048576)} MB > ${MAX_REPORT_BYTES / 1048576} MB)` };
  try {
    const report: unknown = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!isObj(report) || !str(report.reportSchemaVersion)) return { ok: false, reason: 'S\'është raport i këtij tool-i (mungon reportSchemaVersion)' };
    return { ok: true, report };
  } catch (e) {
    return { ok: false, reason: `JSON i pavlefshëm: ${(e as Error).message.slice(0, 80)}` };
  }
}

export function kindOf(r: Obj): ReportKind {
  if (str(r.reportType) !== 'source-audit') return 'url';
  return str(obj(r.source).kind) === 'repo' ? 'repo' : 'folder';
}

export function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

export function summarize(file: string, r: Obj): ReportSummary {
  const kind = kindOf(r);
  const status: RunStatus = r.status === 'completed' ? 'complete' : r.status === 'partial' ? 'partial' : 'unknown';
  const date = str(r.completedAt) || str(r.startedAt) || undefined;
  if (kind !== 'url') {
    const source = obj(r.source);
    const target = str(obj(source.repo).url) || str(source.name) || file;
    return { file, kind, target, siteKey: `${kind}:${target}`, date, schema: str(r.reportSchemaVersion), status, issueCount: arr(r.findings).length };
  }
  const target = hostOf(str(r.url) || str(r.finalUrl)) || file;
  const health = obj(r.health);
  const crawl = obj(obj(r.site).crawl);
  const checked = num(crawl.pagesAnalyzed);
  const discovered = num(crawl.urlsDiscovered);
  const issueCount = [r.issues, obj(r.site).issues, obj(r.business).issues, obj(r.quality).issues].reduce<number>((n, x) => n + arr(x).length, 0);
  const lhr = str(obj(r.lighthouse).lhrFile);
  return {
    file,
    kind,
    target,
    siteKey: `url:${target}`,
    date,
    schema: str(r.reportSchemaVersion),
    status,
    health: { score: num(health.score), status: str(health.status) || 'UNKNOWN' },
    ...(checked !== null && discovered !== null ? { siteCoverage: { checked, discovered, truncated: crawl.truncated === true || discovered > checked } } : {}),
    issueCount,
    ...(lhr ? { lhrFile: lhr } : {}),
  };
}

/** Raportet në output/ (vetëm niveli i parë), më të rejat në krye. */
export function listReports(outputDir: string): ListResult {
  const reports: ReportSummary[] = [];
  const invalid: ListResult['invalid'] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(outputDir);
  } catch {
    return { reports, invalid };
  }
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.lhr.json')) continue;
    if (!isReportName(name)) {
      invalid.push({ file: name, reason: 'Emër i pavlefshëm' });
      continue;
    }
    const r = readReport(outputDir, name);
    if (r.ok) reports.push(summarize(name, r.report));
    else invalid.push({ file: name, reason: r.reason });
  }
  reports.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.file.localeCompare(a.file));
  return { reports, invalid };
}
