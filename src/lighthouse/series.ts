import { AbortedError, isAborting } from '../core/cleanup.js';
import type { AuditConfig } from '../core/config.js';
import { LighthouseRunError, type LighthouseAttempt, type LighthouseData } from './run-lighthouse.js';

/**
 * Seri matjesh Lighthouse për të njëjtën URL dhe të njëjtin konfigurim mobile (faza 4).
 * Crawl-i dhe kontrollet e tjera bëhen një herë; vetëm Lighthouse përsëritet, çdo matje me Chrome dhe
 * profil të ri. Riprovimi teknik (NO_NAVSTART/NO_TRACING_STARTED) ndodh brenda një matjeje të planifikuar
 * dhe regjistrohet si i tillë; s'numërohet si matje e re.
 *
 * Rregulli i vetëm për burimin e vlerave: Health Score, kategoritë dhe issue-t e Lighthouse vijnë nga
 * MATJA PËRFAQËSUESE — matja e vlefshme me Performance mediane (numër çift: më e ulëta nga dy të mesit;
 * barazim: matja më e hershme). Mediana dhe min–max e serisë janë informative dhe s'hyjnë në Health.
 */

export const DEFAULT_LIGHTHOUSE_RUNS = 1;
/** Kufiri për përdorim lokal: çdo matje nis Chrome-in nga e para (~30–60 s secila). */
export const MAX_LIGHTHOUSE_RUNS = 5;

export const REPRESENTATIVE_RULE =
  'Health Score, kategoritë dhe issue-t e Lighthouse vijnë nga matja përfaqësuese: matja e vlefshme me Performance mediane (për numër çift, më e ulëta nga dy të mesit; për barazim, më e hershmja). Mediana dhe min–max e serisë janë informative dhe s\'hyjnë në Health Score.';

export type SeriesKey = 'performance' | 'accessibility' | 'bestPractices' | 'seo' | 'lcpMs' | 'cls' | 'tbtMs' | 'fcpMs' | 'speedIndexMs';

export const SERIES_LABELS: Record<SeriesKey, string> = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  bestPractices: 'Best Practices',
  seo: 'SEO (Lighthouse)',
  lcpMs: 'LCP (ms)',
  cls: 'CLS',
  tbtMs: 'TBT (ms)',
  fcpMs: 'FCP (ms)',
  speedIndexMs: 'Speed Index (ms)',
};

/** Konfigurimi i një matjeje: duhet të jetë i njëjtë brenda serisë dhe mes serive që krahasohen. */
export interface LhRunConfig {
  lighthouseVersion: string;
  formFactor: string;
  throttlingMethod?: string;
  screenWidth?: number;
  chromeMajor?: string;
  benchmarkIndex?: number;
}

export interface LhRunRecord {
  /** Numri i matjes së planifikuar (1…N). */
  run: number;
  status: 'ok' | 'failed';
  startedAt: string;
  durationMs: number;
  fetchTime?: string;
  config?: LhRunConfig;
  values?: Partial<Record<SeriesKey, number | null>>;
  /** Riprovime teknike brenda kësaj matjeje (p.sh. NO_NAVSTART), jo matje të reja. */
  technicalRetries: LighthouseAttempt[];
  error?: { code?: string; message: string };
  /** LHR-ja e kësaj matjeje (vetëm me --save-lhr), vendoset nga writeReport. */
  lhrFile?: string;
}

export interface SeriesStat {
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface LhSeries {
  planned: number;
  valid: number;
  failed: number;
  /** Matja nga e cila vijnë Health dhe issue-t (null kur s'ka asnjë të vlefshme). */
  representativeRun: number | null;
  rule: string;
  runs: LhRunRecord[];
  stats: Record<SeriesKey, SeriesStat>;
  /** Konfigurimi i përbashkët; configConsistent=false kur matjet e serisë ndryshojnë (s'duhet të ndodhë). */
  config?: LhRunConfig;
  configConsistent: boolean;
  configNotes: string[];
  totalMs: number;
}

/** Mediana: numër tek → vlera e mesit; numër çift → mesatarja e dy vlerave të mesit. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stat(values: (number | null | undefined)[]): SeriesStat {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return { n: v.length, median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
}

const score100 = (s: number | null | undefined) => (typeof s === 'number' ? Math.round(s * 100) : null);

export function runValues(lh: LighthouseData): Partial<Record<SeriesKey, number | null>> {
  const num = (id: string) => (typeof lh.audits[id]?.numericValue === 'number' ? lh.audits[id]!.numericValue! : null);
  const ms = (id: string) => {
    const v = num(id);
    return v === null ? null : Math.round(v);
  };
  const cls = num('cumulative-layout-shift');
  return {
    performance: score100(lh.categories.performance?.score),
    accessibility: score100(lh.categories.accessibility?.score),
    bestPractices: score100(lh.categories['best-practices']?.score),
    seo: score100(lh.categories.seo?.score),
    lcpMs: ms('largest-contentful-paint'),
    cls: cls === null ? null : Number(cls.toFixed(3)),
    tbtMs: ms('total-blocking-time'),
    fcpMs: ms('first-contentful-paint'),
    speedIndexMs: ms('speed-index'),
  };
}

export function runConfig(lh: LighthouseData): LhRunConfig {
  const width = (lh.screenEmulation as { width?: number } | undefined)?.width;
  return {
    lighthouseVersion: lh.lighthouseVersion,
    formFactor: lh.formFactor,
    throttlingMethod: lh.throttlingMethod,
    screenWidth: typeof width === 'number' ? width : undefined,
    chromeMajor: lh.hostUserAgent?.match(/Chrome\/(\d+)/)?.[1],
    benchmarkIndex: lh.benchmarkIndex,
  };
}

/** Fushat e konfigurimit që duhet të jenë të njëjta (benchmarkIndex jo: është masë e makinës). */
export function configDifferences(a: LhRunConfig | undefined, b: LhRunConfig | undefined): string[] {
  if (!a || !b) return ['konfigurimi mungon'];
  const d: string[] = [];
  const cmp = (label: string, x: unknown, y: unknown) => x !== y && d.push(`${label}: ${String(x ?? '?')} → ${String(y ?? '?')}`);
  cmp('Versioni i Lighthouse', a.lighthouseVersion, b.lighthouseVersion);
  cmp('Form factor', a.formFactor, b.formFactor);
  cmp('Throttling', a.throttlingMethod, b.throttlingMethod);
  cmp('Gjerësia e ekranit', a.screenWidth, b.screenWidth);
  cmp('Chrome', a.chromeMajor, b.chromeMajor);
  return d;
}

/** Matja përfaqësuese: Performance mediane (çift → më e ulëta e dy të mesit), barazim → më e hershmja. */
export function pickRepresentative(runs: LhRunRecord[]): number | null {
  const ok = runs.filter((r) => r.status === 'ok' && typeof r.values?.performance === 'number');
  if (!ok.length) return runs.find((r) => r.status === 'ok')?.run ?? null;
  const sorted = [...ok].sort((a, b) => a.values!.performance! - b.values!.performance! || a.run - b.run);
  return sorted[Math.floor((sorted.length - 1) / 2)]!.run;
}

export function summarizeSeries(planned: number, runs: LhRunRecord[], totalMs: number): LhSeries {
  const ok = runs.filter((r) => r.status === 'ok');
  const keys = Object.keys(SERIES_LABELS) as SeriesKey[];
  const stats = Object.fromEntries(keys.map((k) => [k, stat(ok.map((r) => r.values?.[k]))])) as Record<SeriesKey, SeriesStat>;
  const first = ok[0]?.config;
  const notes = ok.slice(1).flatMap((r) => configDifferences(first, r.config).map((d) => `matja ${r.run}: ${d}`));
  return {
    planned,
    valid: ok.length,
    failed: runs.length - ok.length,
    representativeRun: pickRepresentative(runs),
    rule: REPRESENTATIVE_RULE,
    runs,
    stats,
    config: first,
    configConsistent: notes.length === 0,
    configNotes: notes,
    totalMs,
  };
}

export type SeriesData = LighthouseData;

/**
 * Ekzekuton N matje të planifikuara. Dështimi i një matjeje regjistrohet dhe seria vazhdon; anulimi
 * ndalon menjëherë (pa matje të tjera). Kthen të dhënat e matjes përfaqësuese + seria; kur s'ka asnjë
 * matje të vlefshme hedh LighthouseRunError me serinë (pa shpikur rezultat).
 */
export async function runLighthouseSeries(
  url: string,
  config: AuditConfig,
  runOnce: (url: string, config: AuditConfig) => Promise<LighthouseData>,
  onProgress?: (msg: string) => void,
): Promise<SeriesData> {
  const planned = Math.min(Math.max(1, Math.trunc(config.lighthouse.runs ?? DEFAULT_LIGHTHOUSE_RUNS)), MAX_LIGHTHOUSE_RUNS);
  if (planned === 1) return runOnce(url, config);

  const t0 = Date.now();
  const runs: LhRunRecord[] = [];
  const data = new Map<number, LighthouseData>();
  for (let run = 1; run <= planned; run++) {
    if (isAborting()) throw new AbortedError();
    onProgress?.(`Lighthouse (mobile): matja ${run}/${planned}`);
    const startedAt = new Date().toISOString();
    const t = Date.now();
    try {
      const lh = await runOnce(url, config);
      data.set(run, lh);
      runs.push({ run, status: 'ok', startedAt, durationMs: Date.now() - t, fetchTime: lh.fetchTime, config: runConfig(lh), values: runValues(lh), technicalRetries: lh.failedAttempts ?? [] });
    } catch (err) {
      if (err instanceof AbortedError || isAborting()) throw err instanceof AbortedError ? err : new AbortedError();
      const e = err as Error & { code?: string; attempts?: LighthouseAttempt[] };
      runs.push({
        run, status: 'failed', startedAt, durationMs: Date.now() - t,
        // Përpjekjet e dështuara para gabimit përfundimtar janë riprovime teknike; e fundit është vetë dështimi.
        technicalRetries: e instanceof LighthouseRunError ? e.attempts.slice(0, -1) : [],
        error: { code: e.code, message: e.message.split('\n')[0]!.slice(0, 300) },
      });
      onProgress?.(`Lighthouse: matja ${run}/${planned} dështoi (${e.code ?? 'gabim'})`);
    }
  }
  const series = summarizeSeries(planned, runs, Date.now() - t0);
  const rep = series.representativeRun;
  if (rep === null) {
    const last = runs[runs.length - 1]!;
    throw Object.assign(new LighthouseRunError(`Asnjë nga ${planned} matjet Lighthouse s'dha rezultat (${runs.map((r) => r.error?.code ?? 'gabim').join(', ')})`, last.error?.code, runs.flatMap((r) => r.technicalRetries)), { series });
  }
  const lh = data.get(rep)!;
  const seriesLhrs = config.lighthouse.saveLhr ? [...data].filter(([, d]) => d.rawLhr).map(([run, d]) => ({ run, lhr: d.rawLhr })) : undefined;
  return { ...lh, series, ...(seriesLhrs ? { seriesLhrs } : {}) };
}
