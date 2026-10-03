import { arr, num, obj, str, type Obj } from './store.js';

/**
 * Seria e matjeve Lighthouse në një raport (faza 4), e lexuar në mënyrë defensive nga JSON-i.
 * Raportet e vjetra (ose me 1 matje) s'kanë `lighthouse.series`: për krahasim trajtohen si seri me 1 matje,
 * me vlerat që raporti tashmë ka (categories + metrikat e modulit performance), pa shpikur interval.
 */

export type SeriesKey = 'performance' | 'accessibility' | 'bestPractices' | 'seo' | 'lcpMs' | 'cls' | 'tbtMs' | 'fcpMs' | 'speedIndexMs';

export const SERIES_KEYS: { key: SeriesKey; label: string; better: 'higher' | 'lower'; unit: 'score' | 'ms' | 'cls' }[] = [
  { key: 'performance', label: 'Performance', better: 'higher', unit: 'score' },
  { key: 'accessibility', label: 'Accessibility', better: 'higher', unit: 'score' },
  { key: 'bestPractices', label: 'Best Practices', better: 'higher', unit: 'score' },
  { key: 'seo', label: 'SEO (Lighthouse)', better: 'higher', unit: 'score' },
  { key: 'lcpMs', label: 'LCP', better: 'lower', unit: 'ms' },
  { key: 'cls', label: 'CLS', better: 'lower', unit: 'cls' },
  { key: 'tbtMs', label: 'TBT', better: 'lower', unit: 'ms' },
  { key: 'fcpMs', label: 'FCP', better: 'lower', unit: 'ms' },
  { key: 'speedIndexMs', label: 'Speed Index', better: 'lower', unit: 'ms' },
];

export interface RunView {
  run: number;
  status: string;
  startedAt: string;
  durationMs: number | null;
  values: Partial<Record<SeriesKey, number | null>>;
  technicalRetries: { attempt: number; code: string }[];
  error: string;
  errorCode: string;
  lhrFile: string;
  benchmarkIndex: number | null;
}

export interface StatView {
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface ConfigView {
  lighthouseVersion: string;
  formFactor: string;
  throttlingMethod: string;
  screenWidth: number | null;
  chromeMajor: string;
}

export interface SeriesView {
  /** false: raport pa seri (1 matje), i ndërtuar nga vlerat ekzistuese të raportit. */
  real: boolean;
  /** Seri e planifikuar (≥ 2) me < 2 matje të vlefshme: rezultati ruhet, por s'ka interval. */
  insufficient: boolean;
  planned: number;
  valid: number;
  failed: number;
  representativeRun: number | null;
  rule: string;
  runs: RunView[];
  stats: Record<SeriesKey, StatView>;
  config: ConfigView | null;
  configConsistent: boolean;
  configNotes: string[];
  totalMs: number | null;
  benchmark: StatView;
}

/** Mediana (çift → mesatarja e dy të mesit); e njëjta si te motori, për seritë sintetike. */
function statOf(values: (number | null | undefined)[]): StatView {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, min: null, max: null };
  const mid = Math.floor(v.length / 2);
  return { n: v.length, median: v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2, min: v[0]!, max: v[v.length - 1]! };
}

function configOf(o: Obj): ConfigView | null {
  if (!str(o.lighthouseVersion) && !str(o.version)) return null;
  const screen = obj(o.screenEmulation);
  return {
    lighthouseVersion: str(o.lighthouseVersion) || str(o.version),
    formFactor: str(o.formFactor),
    throttlingMethod: str(o.throttlingMethod),
    screenWidth: num(o.screenWidth) ?? num(screen.width),
    chromeMajor: str(o.chromeMajor) || (str(o.hostUserAgent).match(/Chrome\/(\d+)/)?.[1] ?? ''),
  };
}

/** Seria e raportit, ose null kur raporti s'ka seri (raport i vjetër ose 1 matje). */
export function seriesOf(r: Obj): SeriesView | null {
  const s = obj(obj(r.lighthouse).series);
  if (!obj(r.lighthouse).series) return null;
  const runs = arr(s.runs).map(obj).map((x): RunView => ({
    run: num(x.run) ?? 0,
    status: str(x.status),
    startedAt: str(x.startedAt),
    durationMs: num(x.durationMs),
    values: Object.fromEntries(SERIES_KEYS.map(({ key }) => [key, num(obj(x.values)[key])])),
    technicalRetries: arr(x.technicalRetries).map(obj).map((t) => ({ attempt: num(t.attempt) ?? 0, code: str(t.code) })),
    error: str(obj(x.error).message),
    errorCode: str(obj(x.error).code),
    lhrFile: str(x.lhrFile),
    benchmarkIndex: num(obj(x.config).benchmarkIndex),
  }));
  const st = obj(s.stats);
  const planned = num(s.planned) ?? runs.length;
  const valid = num(s.valid) ?? runs.filter((x) => x.status === 'ok').length;
  return {
    real: true,
    insufficient: planned >= 2 && valid < 2,
    planned,
    valid,
    failed: num(s.failed) ?? runs.filter((x) => x.status !== 'ok').length,
    representativeRun: num(s.representativeRun),
    rule: str(s.rule),
    runs,
    stats: Object.fromEntries(SERIES_KEYS.map(({ key }) => {
      const o = obj(st[key]);
      return [key, { n: num(o.n) ?? 0, median: num(o.median), min: num(o.min), max: num(o.max) }];
    })) as Record<SeriesKey, StatView>,
    config: configOf(obj(s.config)),
    configConsistent: s.configConsistent !== false,
    configNotes: arr(s.configNotes).map(str),
    totalMs: num(s.totalMs),
    benchmark: statOf(runs.filter((x) => x.status === 'ok').map((x) => x.benchmarkIndex)),
  };
}

/** Për krahasim: seria reale, ose një "seri" me 1 matje nga vlerat ekzistuese të raportit (kur ka Lighthouse). */
export function seriesForCompare(r: Obj): SeriesView | null {
  const real = seriesOf(r);
  if (real) return real;
  const lh = obj(r.lighthouse);
  if (!str(lh.version)) return null;
  const cat = obj(r.categories);
  const perfMetrics = new Map(arr(arr(r.modules).map(obj).find((m) => str(m.module) === 'performance')?.metrics).map(obj).map((m) => [str(m.id), num(m.value)]));
  const values: Partial<Record<SeriesKey, number | null>> = {
    performance: num(cat.performance), accessibility: num(cat.accessibility), bestPractices: num(cat.bestPractices), seo: null,
    lcpMs: perfMetrics.get('lcp') ?? null, cls: perfMetrics.get('cls') ?? null, tbtMs: perfMetrics.get('tbt') ?? null,
    fcpMs: perfMetrics.get('fcp') ?? null, speedIndexMs: perfMetrics.get('speed-index') ?? null,
  };
  return {
    real: false, insufficient: false, planned: 1, valid: 1, failed: 0, representativeRun: 1, rule: '', totalMs: null,
    runs: [{ run: 1, status: 'ok', startedAt: str(lh.fetchTime), durationMs: null, values, technicalRetries: arr(lh.failedAttempts).map(obj).map((t) => ({ attempt: num(t.attempt) ?? 0, code: str(t.code) })), error: '', errorCode: '', lhrFile: str(lh.lhrFile), benchmarkIndex: num(lh.benchmarkIndex) }],
    stats: Object.fromEntries(SERIES_KEYS.map(({ key }) => [key, statOf([values[key]])])) as Record<SeriesKey, StatView>,
    config: configOf(lh), configConsistent: true, configNotes: [],
    benchmark: statOf([num(lh.benchmarkIndex)]),
  };
}

export function configDiff(a: ConfigView | null, b: ConfigView | null): string[] {
  if (!a || !b) return ['konfigurimi i Lighthouse mungon në njërin raport'];
  const d: string[] = [];
  const cmp = (label: string, x: unknown, y: unknown) => String(x ?? '') !== String(y ?? '') && d.push(`${label}: ${String(x ?? '?') || '?'} → ${String(y ?? '?') || '?'}`);
  cmp('Versioni i Lighthouse', a.lighthouseVersion, b.lighthouseVersion);
  cmp('Form factor', a.formFactor, b.formFactor);
  cmp('Throttling', a.throttlingMethod, b.throttlingMethod);
  cmp('Gjerësia e ekranit', a.screenWidth, b.screenWidth);
  cmp('Chrome', a.chromeMajor, b.chromeMajor);
  return d;
}

export type SeriesVerdict = 'no-data' | 'single' | 'overlap' | 'outside';

export interface SeriesRow {
  key: SeriesKey;
  label: string;
  a: StatView;
  b: StatView;
  verdict: SeriesVerdict;
  /** Drejtimi i ndryshimit të medianës (neutral: rritje/ulje), jo vlerësim. */
  direction: 'up' | 'down' | 'same' | null;
  note: string;
}

export interface SeriesCompare {
  comparable: boolean;
  /** Fuqia e makinës (benchmarkIndex) ndryshoi shumë mes serive: ndryshimet mund të vijnë nga ngarkesa e kompjuterit. */
  machineWarning?: string;
  differences: string[];
  notes: string[];
  rows: SeriesRow[];
  a: SeriesView;
  b: SeriesView;
}

export const SERIES_VERDICT_LABELS: Record<SeriesVerdict, string> = {
  'no-data': 'pa të dhëna',
  single: "s'ka interval (1 matje)",
  overlap: 'intervalet e vëzhguara mbivendosen — pa përfundim',
  outside: 'ndryshim jashtë intervaleve — kërkon konfirmim',
};

/**
 * Krahasimi i dy serive. Vetëm kur konfigurimi është i njëjtë; edhe atëherë një ndryshim jashtë intervaleve
 * min–max quhet "ndryshim i matur, kërkon konfirmim", kurrë "përmirësim i konfirmuar": dy seri të vogla
 * laboratorike në kohë dhe gjendje të ndryshme të rrjetit/makinës s'e provojnë shkakun.
 */
export function compareSeries(a: SeriesView, b: SeriesView): SeriesCompare {
  const differences = configDiff(a.config, b.config);
  const notes: string[] = [];
  let machineWarning: string | undefined;
  if (!a.configConsistent || !b.configConsistent) notes.push('Njëra seri ka konfigurim të ndryshëm brenda saj (shih raportin).');
  if (a.benchmark.median && b.benchmark.median) {
    const ratio = b.benchmark.median / a.benchmark.median;
    if (ratio > 1.5 || ratio < 0.67) machineWarning = `Fuqia e makinës (benchmarkIndex, mediana) ndryshon shumë mes serive: ${Math.round(a.benchmark.median)} → ${Math.round(b.benchmark.median)}. Kompjuteri ishte i ngarkuar ndryshe (p.sh. programe të tjera gjatë njërës seri); TBT dhe Performance ndikohen më shumë. Përsërite serinë në kushte të ngjashme para se të nxjerrësh përfundime.`;
  }
  if (a.valid < 2 || b.valid < 2) notes.push(`Matje të vlefshme: A ${a.valid}, B ${b.valid}. Me 1 matje s'ka interval; ndryshimi s'mund të dallohet nga variacioni.`);
  if (a.failed || b.failed) notes.push(`Matje të dështuara: A ${a.failed}, B ${b.failed} (s'hyjnë në statistika).`);
  const rows = SERIES_KEYS.map(({ key, label }): SeriesRow => {
    const x = a.stats[key];
    const y = b.stats[key];
    const base = { key, label, a: x, b: y };
    if (!x.n || !y.n || x.median === null || y.median === null) return { ...base, verdict: 'no-data', direction: null, note: "mungon në njërën seri" };
    const direction = y.median > x.median ? 'up' : y.median < x.median ? 'down' : 'same';
    if (x.n < 2 || y.n < 2) return { ...base, verdict: 'single', direction, note: 'duhen ≥ 2 matje të vlefshme në secilën seri për interval' };
    const overlap = x.min! <= y.max! && y.min! <= x.max!;
    return overlap
      ? { ...base, verdict: 'overlap', direction, note: "intervalet min–max të vëzhguara mbivendosen; janë orientuese (pak matje), jo interval statistikor — pa përfundim" }
      : {
          ...base, verdict: 'outside', direction,
          note: machineWarning
            ? "intervalet s'mbivendosen, por fuqia e makinës ndryshoi shumë mes serive: ndryshimi mund të vijë nga ngarkesa e kompjuterit — përsërite në kushte të ngjashme"
            : "intervalet s'mbivendosen; seri të vogla laboratorike — konfirmoje me matje të tjera para se ta quash përmirësim/përkeqësim",
        };
  });
  return { comparable: differences.length === 0, differences, notes, rows, a, b, ...(machineWarning ? { machineWarning } : {}) };
}
