import { CATEGORY_LABELS, SITE_CATEGORY_LABELS } from '../core/schemas.js';
import { checkedPages, sectionsPresent, sourceFindings, urlIssues, type IssueView, type Section, type SourceFindingView } from './model.js';
import { arr, num, obj, str, summarize, type Obj, type ReportSummary } from './store.js';

/**
 * Krahasimi i dy raporteve të të njëjtit sit. Një ndryshim quhet "përmirësim/përkeqësim" vetëm kur
 * të dyja anët janë të krahasueshme; përndryshe del "s'krahasohet" me arsyen (mbulim i ndryshëm,
 * konfigurim tjetër i Lighthouse, rregulla të tjera, seksion që mungon, modul i anashkaluar).
 */

/**
 * measured-increase/-decrease: ndryshim i matur nga një ekzekutim i vetëm Lighthouse për raport — s'quhet
 * përmirësim/përkeqësim pa konfirmim me disa ekzekutime.
 */
export type Verdict = 'improved' | 'worsened' | 'measured-increase' | 'measured-decrease' | 'same' | 'noise' | 'not-comparable';

/** Pragje PROVIZORE, të pakalibruara: variacioni i Lighthouse dhe mbivendosja minimale e faqeve të crawl-it. */
export const PROVISIONAL_THRESHOLDS = 'Pragjet ±5 pikë (Lighthouse) dhe ≥ 90% faqe të përbashkëta (crawl) janë provizore, të pakalibruara.';

const measured = (v: Verdict): Verdict => (v === 'improved' ? 'measured-increase' : v === 'worsened' ? 'measured-decrease' : v);

export interface ScoreRow {
  key: string;
  label: string;
  group: 'health' | 'homepage' | 'site';
  a: number | null;
  b: number | null;
  delta: number | null;
  verdict: Verdict;
  note?: string;
}

export interface IssueChange {
  key: string;
  section: Section;
  code: string;
  url: string;
  severity: string;
  message: string;
  reason?: string;
}

export interface CompareResult {
  a: ReportSummary;
  b: ReportSummary;
  /** false: sitet/llojet ndryshojnë — asgjë s'krahasohet. */
  sameTarget: boolean;
  reason?: string;
  caveats: string[];
  lighthouse: { comparable: boolean; differences: string[] };
  scores: ScoreRow[];
  resolved: IssueChange[];
  /** Gjetje Lighthouse që mungojnë te B: një matje e vetme, s'quhen të zgjidhura pa konfirmim. */
  notRedetected: IssueChange[];
  added: IssueChange[];
  persisted: IssueChange[];
  notComparable: IssueChange[];
  /** Sinjalet e cilësisë: vetëm numërim sipas kodit, jashtë Health. */
  quality?: { code: string; a: number; b: number }[];
}

/** Lighthouse e faqes hyrëse: ndryshon mes ekzekutimeve; ndryshime të vogla s'janë provë përmirësimi. */
export const LH_NOISE = 5;
const LH_CATEGORIES = new Set(['performance', 'accessibility', 'bestPractices']);

function chromeMajor(ua: string): string {
  return ua.match(/Chrome\/(\d+)/)?.[1] ?? '';
}

export function lighthouseComparability(a: Obj, b: Obj): { comparable: boolean; differences: string[] } {
  const la = obj(a.lighthouse);
  const lb = obj(b.lighthouse);
  const d: string[] = [];
  const scoreA = num(obj(a.categories).performance);
  const scoreB = num(obj(b.categories).performance);
  if (!str(la.version) || scoreA === null) d.push('Lighthouse s\'ka rezultat në raportin A');
  if (!str(lb.version) || scoreB === null) d.push('Lighthouse s\'ka rezultat në raportin B');
  if (d.length) return { comparable: false, differences: d };
  const same = (label: string, x: string, y: string) => x !== y && d.push(`${label}: ${x || '?'} → ${y || '?'}`);
  same('Versioni i Lighthouse', str(la.version), str(lb.version));
  same('Form factor', str(la.formFactor), str(lb.formFactor));
  same('Throttling', str(la.throttlingMethod), str(lb.throttlingMethod));
  same('Gjerësia e ekranit', str(obj(la.screenEmulation).width), str(obj(lb.screenEmulation).width));
  same('Chrome', chromeMajor(str(la.hostUserAgent)), chromeMajor(str(lb.hostUserAgent)));
  const ba = num(la.benchmarkIndex);
  const bb = num(lb.benchmarkIndex);
  const cmp = d.length === 0;
  // Pa ndryshim konfigurimi, këto s'e bëjnë krahasimin të pamundur, por e dobësojnë.
  if (ba && bb && (bb / ba > 1.5 || bb / ba < 0.67)) d.push(`Fuqia e makinës (benchmarkIndex) ndryshon shumë: ${Math.round(ba)} → ${Math.round(bb)}`);
  if (arr(la.failedAttempts).length || arr(lb.failedAttempts).length) d.push('Një nga ekzekutimet u përsërit pas dështimi (failedAttempts)');
  return { comparable: cmp, differences: d };
}

function verdictOf(a: number | null, b: number | null, noise = 0): { delta: number | null; verdict: Verdict } {
  if (a === null || b === null) return { delta: null, verdict: 'not-comparable' };
  const delta = b - a;
  if (delta === 0) return { delta, verdict: 'same' };
  if (Math.abs(delta) <= noise) return { delta, verdict: 'noise' };
  return { delta, verdict: delta > 0 ? 'improved' : 'worsened' };
}

function overlap(a: Set<string>, b: Set<string>): { common: number; ratio: number } {
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  const union = a.size + b.size - common;
  return { common, ratio: union ? common / union : 1 };
}

const change = (i: IssueView, reason?: string): IssueChange => ({ key: i.key, section: i.section, code: i.code, url: i.url, severity: i.severity, message: i.message, ...(reason ? { reason } : {}) });

function skippedModules(r: Obj): Set<string> {
  return new Set(arr(r.modules).map(obj).filter((m) => m.status === 'skipped').map((m) => str(m.module)));
}

export function compareReports(fileA: string, a: Obj, fileB: string, b: Obj): CompareResult {
  const sa = summarize(fileA, a);
  const sb = summarize(fileB, b);
  const base: CompareResult = { a: sa, b: sb, sameTarget: true, caveats: [], lighthouse: { comparable: false, differences: [] }, scores: [], resolved: [], notRedetected: [], added: [], persisted: [], notComparable: [] };
  if (sa.siteKey !== sb.siteKey) return { ...base, sameTarget: false, reason: `Raporte për objekte të ndryshme (${sa.target} ↔ ${sb.target}) ose lloje të ndryshme auditi.` };
  if (sa.kind !== 'url') return compareSource(base, a, b);

  const caveats: string[] = [];
  if ((sa.date ?? '') > (sb.date ?? '')) caveats.push('Raporti A është më i ri se B: "përmirësim" do të thotë ndryshim nga A te B.');
  if (str(a.ruleSetVersion) !== str(b.ruleSetVersion) || !str(a.ruleSetVersion)) caveats.push(`Rregullat e tool-it ndryshuan (${str(a.ruleSetVersion) || '?'} → ${str(b.ruleSetVersion) || '?'}): gjetjet që u shfaqën ose u zhdukën dalin "s'krahasohen", sepse s'mund të provohet që rregulli është i njëjtë. Pikët krahasohen, por mund të ndikohen nga tool-i.`);
  if (str(a.reportSchemaVersion) !== str(b.reportSchemaVersion)) caveats.push(`Versione të ndryshme raporti (${str(a.reportSchemaVersion)} → ${str(b.reportSchemaVersion)}): seksionet që mungojnë në njërin s'krahasohen.`);

  // --- Health (faqja hyrëse) dhe kategoritë ---
  const lh = lighthouseComparability(a, b);
  const sameRules = !!str(a.ruleSetVersion) && str(a.ruleSetVersion) === str(b.ruleSetVersion);
  const benchA = num(obj(a.lighthouse).benchmarkIndex) === null ? null : Math.round(num(obj(a.lighthouse).benchmarkIndex)!);
  const benchB = num(obj(b.lighthouse).benchmarkIndex) === null ? null : Math.round(num(obj(b.lighthouse).benchmarkIndex)!);
  const scores: ScoreRow[] = [];
  const ha = obj(a.health);
  const hb = obj(b.health);
  const healthOk = str(a.scoringVersion) === str(b.scoringVersion) && lh.comparable && str(ha.status) !== 'PARTIAL' && str(hb.status) !== 'PARTIAL';
  const hv = verdictOf(num(ha.score), num(hb.score), LH_NOISE);
  scores.push({
    key: 'health', label: 'Health Score (faqja hyrëse)', group: 'health', a: num(ha.score), b: num(hb.score), ...hv,
    ...(healthOk ? (hv.verdict === 'noise' ? { note: `ndryshim ≤ ${LH_NOISE}: mund të jetë variacion i Lighthouse mes ekzekutimeve` } : hv.verdict === 'improved' || hv.verdict === 'worsened' ? { verdict: measured(hv.verdict), note: 'Health përfshin Lighthouse nga një ekzekutim i vetëm — konfirmoje me disa ekzekutime' } : {}) : { verdict: 'not-comparable' as Verdict, note: str(a.scoringVersion) !== str(b.scoringVersion) ? 'versione të ndryshme pikëzimi' : !lh.comparable ? 'Lighthouse s\'është i krahasueshëm (shih më poshtë)' : 'njëri raport është PARTIAL' }),
  });
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const x = num(obj(a.categories)[key]);
    const y = num(obj(b.categories)[key]);
    const isLh = LH_CATEGORIES.has(key);
    const v = verdictOf(x, y, isLh ? LH_NOISE : 0);
    const row: ScoreRow = { key, label, group: 'homepage', a: x, b: y, ...v };
    if (isLh && !lh.comparable && v.verdict !== 'not-comparable') Object.assign(row, { verdict: 'not-comparable', note: 'ekzekutime Lighthouse me konfigurim/mjedis të ndryshëm' });
    else if (v.verdict === 'noise') row.note = `ndryshim ≤ ${LH_NOISE}: brenda variacionit të zakonshëm të Lighthouse; konfirmoje me disa ekzekutime`;
    else if (isLh && (v.verdict === 'improved' || v.verdict === 'worsened')) Object.assign(row, { verdict: measured(v.verdict), note: `një ekzekutim Lighthouse për raport (benchmarkIndex ${benchA ?? '?'} → ${benchB ?? '?'}); rezultati ndryshon mes ekzekutimeve — konfirmoje me disa para se ta quash ${v.verdict === 'improved' ? 'përmirësim' : 'përkeqësim'}` });
    else if (v.verdict === 'not-comparable') row.note = 'mungon në njërin raport (skipped/pa të dhëna)';
    scores.push(row);
  }

  // --- Siti: vetëm kur faqet e kontrolluara janë (pothuajse) të njëjta ---
  const pa = checkedPages(a);
  const pb = checkedPages(b);
  const ov = overlap(pa, pb);
  const sitePresent = sectionsPresent(a).has('site') && sectionsPresent(b).has('site');
  const siteComparable = sitePresent && ov.ratio >= 0.9;
  if (sitePresent) {
    const ca = obj(obj(a.site).crawl);
    const cb = obj(obj(b.site).crawl);
    caveats.push(`Mbulimi i sitit: A ${num(ca.pagesAnalyzed) ?? '?'}/${num(ca.urlsDiscovered) ?? '?'} faqe, B ${num(cb.pagesAnalyzed) ?? '?'}/${num(cb.urlsDiscovered) ?? '?'}; ${ov.common} faqe të përbashkëta (${Math.round(ov.ratio * 100)}%).`);
  }
  for (const [key, label] of Object.entries(SITE_CATEGORY_LABELS)) {
    const x = num(obj(obj(a.site).categories)[key]);
    const y = num(obj(obj(b.site).categories)[key]);
    const v = verdictOf(x, y);
    const row: ScoreRow = { key, label, group: 'site', a: x, b: y, ...v };
    if (!sitePresent) Object.assign(row, { verdict: 'not-comparable', note: 'njëri raport s\'ka crawl (versioni ose --no-crawl)' });
    else if (!siteComparable && v.verdict !== 'not-comparable') Object.assign(row, { verdict: 'not-comparable', note: `faqe të ndryshme të kontrolluara (${Math.round(ov.ratio * 100)}% të përbashkëta)` });
    scores.push(row);
  }

  // --- Issue-t: të zgjidhura, të reja, të mbetura, ose të pakrahasueshme ---
  const ia = urlIssues(a);
  const ib = urlIssues(b);
  const keysA = new Set(ia.map((i) => i.key));
  const keysB = new Set(ib.map((i) => i.key));
  const secA = sectionsPresent(a);
  const secB = sectionsPresent(b);
  const skipA = skippedModules(a);
  const skipB = skippedModules(b);
  const why = (i: IssueView, other: 'A' | 'B'): string | undefined => {
    const sec = other === 'A' ? secA : secB;
    const pages = other === 'A' ? pa : pb;
    const skip = other === 'A' ? skipA : skipB;
    if (!sec.has(i.section)) return `raporti ${other} s'ka seksionin "${i.section}"`;
    if (i.module && skip.has(i.module)) return `moduli "${i.module}" u anashkalua te ${other}`;
    if (i.module && LH_MODULES.has(i.module) && !lh.comparable) return 'Lighthouse s\'është i krahasueshëm mes ekzekutimeve';
    if (i.section !== 'homepage' && i.url && !pages.has(i.url)) return `faqja s'u kontrollua te ${other}`;
    // Raportet s'mbajnë version për çdo rregull: kur ruleSetVersion ndryshon (ose mungon), s'mund të provohet
    // që gjetja u zhduk/u shfaq nga siti dhe jo nga një rregull i ndryshuar.
    if (!sameRules) return `rregullat e tool-it ndryshuan (${str(a.ruleSetVersion) || '?'} → ${str(b.ruleSetVersion) || '?'}): s'mund të provohet që rregulli ${i.code} është i njëjtë`;
    // Gjetjet e sitit (dyfishime, sitemap, linke) varen nga cilat faqe u kontrolluan, jo vetëm nga faqja e tyre.
    if (i.section !== 'homepage' && !siteComparable) return `crawl me faqe të ndryshme (${Math.round(ov.ratio * 100)}% të përbashkëta)`;
    return undefined;
  };
  const out = { resolved: [] as IssueChange[], notRedetected: [] as IssueChange[], added: [] as IssueChange[], persisted: [] as IssueChange[], notComparable: [] as IssueChange[] };
  for (const i of ia) {
    if (keysB.has(i.key)) out.persisted.push(change(i));
    else {
      const r = why(i, 'B');
      if (r) out.notComparable.push(change(i, r));
      // Lighthouse: një ekzekutim për raport — mungesa te B s'provon që u zgjidh.
      else if (LH_MODULES.has(i.module)) out.notRedetected.push(change(i, 'nuk u rilevua në matjen e fundit të Lighthouse (një ekzekutim), kërkon konfirmim'));
      else out.resolved.push(change(i));
    }
  }
  for (const i of ib) {
    if (keysA.has(i.key)) continue;
    const r = why(i, 'A');
    (r ? out.notComparable : out.added).push(change(i, r));
  }

  // --- Cilësia: sinjale për shqyrtim, jashtë Health; vetëm numërim ---
  let quality: CompareResult['quality'];
  if (secA.has('quality') && secB.has('quality')) {
    const count = (xs: IssueView[]) => xs.filter((i) => i.section === 'quality').reduce<Record<string, number>>((m, i) => ({ ...m, [i.code]: (m[i.code] ?? 0) + 1 }), {});
    const qa = count(ia);
    const qb = count(ib);
    quality = [...new Set([...Object.keys(qa), ...Object.keys(qb)])].sort().map((code) => ({ code, a: qa[code] ?? 0, b: qb[code] ?? 0 }));
  }

  return { ...base, caveats, lighthouse: lh, scores, ...out, ...(quality ? { quality } : {}) };
}

const LH_MODULES = new Set(['performance', 'accessibility', 'best-practices']);

function compareSource(base: CompareResult, a: Obj, b: Obj): CompareResult {
  const caveats: string[] = [];
  const ca = obj(a.coverage);
  const cb = obj(b.coverage);
  if (num(ca.filesSeen) !== num(cb.filesSeen)) caveats.push(`Numri i skedarëve ndryshon: ${num(ca.filesSeen) ?? '?'} → ${num(cb.filesSeen) ?? '?'}.`);
  if (ca.truncated === true || cb.truncated === true) caveats.push('Njëri audit u ndërpre nga kufijtë (truncated): gjetjet që mungojnë s\'janë domosdoshmërisht të zgjidhura.');
  if (str(obj(obj(a.source).repo).commit) && str(obj(obj(a.source).repo).commit) === str(obj(obj(b.source).repo).commit)) caveats.push('I njëjti commit në të dyja: ndryshimet vijnë nga tool-i, jo nga kodi.');
  const key = (f: SourceFindingView) => `${f.code}|${f.file}|${f.message}`;
  const fa = sourceFindings(a);
  const fb = sourceFindings(b);
  const ka = new Set(fa.map(key));
  const kb = new Set(fb.map(key));
  const truncated = cb.truncated === true;
  const ch = (f: SourceFindingView, reason?: string): IssueChange => ({ key: key(f), section: 'site', code: f.code, url: f.line ? `${f.file}:${f.line}` : f.file, severity: f.severity, message: f.message, ...(reason ? { reason } : {}) });
  return {
    ...base,
    caveats,
    resolved: fa.filter((f) => !kb.has(key(f)) && !truncated).map((f) => ch(f)),
    notComparable: fa.filter((f) => !kb.has(key(f)) && truncated).map((f) => ch(f, 'auditi B u ndërpre nga kufijtë')),
    added: fb.filter((f) => !ka.has(key(f))).map((f) => ch(f)),
    persisted: fb.filter((f) => ka.has(key(f))).map((f) => ch(f)),
  };
}
