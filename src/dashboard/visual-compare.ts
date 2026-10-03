import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { imageFileSize } from '../core/image-size.js';
import { isShotRel, summarize, type Obj, type ReportSummary } from './store.js';
import { gallery, type Gallery, type Shot, type Size } from './visual.js';

/**
 * Krahasimi vizual i së njëjtës faqe (URL e njëjtë) dhe pajisjes mes dy auditeve.
 * Para çdo krahasimi verifikohen: URL-ja (e kërkuar dhe përfundimtare), pajisja, madhësia e viewport-it,
 * prerja e screenshot-it dhe përmasat reale të skedarëve. Raportet e vjetra pa këto metadata dalin
 * "me kufizime"; mospërputhjet që e bëjnë krahasimin piksel-për-piksel të pakuptimtë dalin "s'krahasohet".
 * Ndryshimi i pikselëve është matje, jo vlerësim "më mirë/më keq", dhe s'hyn në Health Score.
 */

export type CheckState = 'ok' | 'limited' | 'blocked';
export type PairStatus = 'full' | 'limited' | 'not-comparable';

export interface Check {
  key: 'url' | 'finalUrl' | 'device' | 'viewport' | 'measured' | 'clip' | 'file' | 'browser';
  label: string;
  a: string;
  b: string;
  state: CheckState;
  note: string;
}

export interface VisualPair {
  url: string;
  device: string;
  a?: Shot;
  b?: Shot;
  status: PairStatus;
  /** Viewport-i i njërës anë s'dihet (raport i vjetër): matja e pikselëve është vetëm orientuese. */
  orientative: boolean;
  checks: Check[];
  /** Përmasat reale të skedarëve, të lexuara nga header-i (null: mungon/s'lexohet). */
  fileA: Size | null;
  fileB: Size | null;
}

export interface VisualSide {
  file: string;
  date: string;
  g: Gallery;
}

export interface VisualCompare {
  a: VisualSide;
  b: VisualSide;
  sa: ReportSummary;
  sb: ReportSummary;
  sameTarget: boolean;
  reason?: string;
  caveats: string[];
  pairs: VisualPair[];
}

export const PAIR_STATUS_LABELS: Record<PairStatus, string> = {
  full: 'krahasim i plotë',
  limited: 'krahasim me kufizime',
  'not-comparable': "s'krahasohet",
};

/** Lexuesi i screenshot-eve: kthen shtegun absolut vetëm për shtegje të vlefshme brenda output/visual. */
export type ShotPath = (rel: string) => string | undefined;

const sz = (s: Size | null | undefined) => (s ? `${s.width} × ${s.height}` : '');
const NOT_STORED = "s'është ruajtur";

function stateOfPath(shotPath: ShotPath) {
  return (rel: string) => (!isShotRel(rel) ? ('invalid' as const) : shotPath(rel) ? ('ok' as const) : ('missing' as const));
}

/** Prerja e një pamjeje: e ruajtur nga motori, ose e nxjerrë nga lartësia (raport i vjetër). */
function clipOf(s: Shot, g: Gallery): { clipped: boolean | null; height: number | null; stored: boolean } {
  if (s.meta.clip) return { clipped: s.meta.clip.clipped, height: s.meta.clip.height, stored: true };
  if (s.documentHeight !== null && g.maxScreenshotHeight !== null) return { clipped: s.documentHeight > g.maxScreenshotHeight, height: Math.min(s.documentHeight, g.maxScreenshotHeight), stored: false };
  return { clipped: null, height: null, stored: false };
}

/** Arsyeja pse s'u renderua, pa prefiksin "S'u renderua:" që motori e shton vetë. */
export function renderReason(s: Shot): string {
  return s.reason.replace(/^S'u renderua:s*/i, '').trim() || 'pa arsye në raport';
}

function chromeMajor(v: string): string {
  return v.match(/Chrome\/(\d+)/)?.[1] ?? '';
}

export function pairChecks(a: Shot, b: Shot, ga: Gallery, gb: Gallery, fileA: Size | null, fileB: Size | null): Check[] {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add({ key: 'url', label: 'URL e kërkuar', a: a.url, b: b.url, state: a.url === b.url ? 'ok' : 'blocked', note: a.url === b.url ? 'e njëjtë' : 'faqe të ndryshme' });

  const fa = a.finalUrl;
  const fb = b.finalUrl;
  if (!a.finalUrl || !b.finalUrl) add({ key: 'finalUrl', label: 'URL përfundimtare', a: a.finalUrl || NOT_STORED, b: b.finalUrl || NOT_STORED, state: 'limited', note: "s'mund të vërtetohet që faqja s'u ridrejtua ndryshe" });
  else add({ key: 'finalUrl', label: 'URL përfundimtare', a: fa, b: fb, state: fa === fb ? 'ok' : 'limited', note: fa === fb ? 'e njëjtë' : 'ridrejtim i ndryshëm: mund të jetë renderuar faqe tjetër' });

  // Pajisja: e njëjtë nga çiftimi; kontrollohet edhe me isMobile të ruajtur, kur ekziston.
  const mobileConflict = [a, b].some((s) => s.meta.viewportSize?.isMobile !== undefined && s.meta.viewportSize?.isMobile !== null && s.meta.viewportSize.isMobile !== (s.device === 'mobile'));
  add({ key: 'device', label: 'Pajisja', a: a.device, b: b.device, state: a.device !== b.device || mobileConflict ? 'blocked' : 'ok', note: mobileConflict ? 'emulimi i ruajtur s\'përputhet me pajisjen' : a.device === b.device ? 'e njëjtë' : 'pajisje të ndryshme' });

  const va = a.meta.viewportSize;
  const vb = b.meta.viewportSize;
  const vText = (v: typeof va) => (v ? `${sz(v)}${v.deviceScaleFactor !== 1 ? ` · DPR ${v.deviceScaleFactor}` : ''}` : NOT_STORED);
  if (!va || !vb) add({ key: 'viewport', label: 'Madhësia e viewport-it', a: vText(va), b: vText(vb), state: 'limited', note: 'raport i vjetër: madhësia s\'mund të vërtetohet (vetëm desktop/mobile)' });
  else if (va.width !== vb.width || va.deviceScaleFactor !== vb.deviceScaleFactor) add({ key: 'viewport', label: 'Madhësia e viewport-it', a: vText(va), b: vText(vb), state: 'blocked', note: 'gjerësi/DPR e ndryshme: piksel-për-piksel s\'krahasohet' });
  else add({ key: 'viewport', label: 'Madhësia e viewport-it', a: vText(va), b: vText(vb), state: va.height === vb.height ? 'ok' : 'limited', note: va.height === vb.height ? 'e njëjtë' : 'lartësi e ndryshme e ekranit: pjesa "above the fold" ndryshon' });

  const ma = a.meta.measuredViewport;
  const mb = b.meta.measuredViewport;
  if (!ma || !mb) add({ key: 'measured', label: 'Viewport-i i matur në faqe', a: sz(ma) || NOT_STORED, b: sz(mb) || NOT_STORED, state: 'limited', note: "s'mund të vërtetohet si e pa faqja ekranin" });
  else add({ key: 'measured', label: 'Viewport-i i matur në faqe', a: sz(ma), b: sz(mb), state: ma.width === mb.width && ma.height === mb.height ? 'ok' : 'limited', note: ma.width === mb.width && ma.height === mb.height ? 'i njëjtë' : 'faqja e pa ekranin ndryshe (p.sh. ndryshoi meta viewport)' });

  const ca = clipOf(a, ga);
  const cb = clipOf(b, gb);
  const cText = (c: ReturnType<typeof clipOf>) => (c.clipped === null ? NOT_STORED : `${c.clipped ? `prerë te ${c.height} px` : 'e plotë'}${c.stored ? '' : ' (nxjerrë nga lartësia)'}`);
  let clipState: CheckState = 'ok';
  let clipNote = 'asnjëra s\'është prerë';
  if (ca.clipped === null || cb.clipped === null) [clipState, clipNote] = ['limited', 'prerja s\'mund të vërtetohet'];
  else if (!ca.stored || !cb.stored) [clipState, clipNote] = ['limited', 'prerja s\'është ruajtur: u nxorr nga lartësia e faqes'];
  if (ca.clipped && cb.clipped) [clipState, clipNote] = ['limited', `të dyja të prera: krahasohet vetëm pjesa e sipërme (${Math.min(ca.height!, cb.height!)} px)`];
  else if (ca.clipped !== cb.clipped && ca.clipped !== null && cb.clipped !== null) [clipState, clipNote] = ['limited', 'njëra është e prerë: krahasohet vetëm pjesa e përbashkët'];
  add({ key: 'clip', label: 'Prerja e screenshot-it', a: cText(ca), b: cText(cb), state: clipState, note: clipNote });

  // Skedarët: duhet të ekzistojnë dhe përmasat reale të përputhen me ato që raporti pretendon.
  const fileCheck = (s: Shot, f: Size | null): { text: string; state: CheckState; note: string } => {
    if (s.state === 'invalid') return { text: 'shteg i pavlefshëm', state: 'blocked', note: 'shteg i pavlefshëm (s\'shërbehet)' };
    if (s.state === 'missing') return { text: 'mungon', state: 'blocked', note: 'screenshot-i mungon lokalisht' };
    if (!f) return { text: 's\'lexohet', state: 'blocked', note: 'skedari s\'është JPEG/PNG i lexueshëm' };
    const expected = s.meta.screenshotSize;
    const dpr = s.meta.viewportSize?.deviceScaleFactor ?? 1;
    const fromClip = s.meta.clip ? { width: Math.round(s.meta.clip.width * dpr), height: Math.round(s.meta.clip.height * dpr) } : null;
    const want = expected ?? fromClip;
    if (!want) return { text: sz(f), state: 'limited', note: 'përmasat s\'janë ruajtur: u lexuan vetëm nga skedari' };
    if (want.width !== f.width || want.height !== f.height) return { text: `${sz(f)} (raporti: ${sz(want)})`, state: 'blocked', note: 'skedari s\'përputhet me raportin (mund të jetë zëvendësuar)' };
    return { text: sz(f), state: 'ok', note: 'përputhet me raportin' };
  };
  const xa = fileCheck(a, fileA);
  const xb = fileCheck(b, fileB);
  const worst: CheckState = [xa.state, xb.state].includes('blocked') ? 'blocked' : [xa.state, xb.state].includes('limited') ? 'limited' : 'ok';
  let fileNote = worst === 'ok' ? 'të dy përputhen me raportet' : ([['A', xa], ['B', xb]] as const).filter(([, x]) => x.state !== 'ok').map(([side, x]) => `${side}: ${x.note}`).join('; ');
  let fileState = worst;
  if (worst !== 'blocked' && fileA && fileB && fileA.width !== fileB.width) [fileState, fileNote] = ['blocked', 'gjerësi të ndryshme skedarësh: piksel-për-piksel s\'krahasohet'];
  add({ key: 'file', label: 'Skedari (përmasat reale)', a: xa.text, b: xb.text, state: fileState, note: fileNote });

  const ba = chromeMajor(ga.browserVersion);
  const bb = chromeMajor(gb.browserVersion);
  if (!ba || !bb) add({ key: 'browser', label: 'Chrome', a: ga.browserVersion || NOT_STORED, b: gb.browserVersion || NOT_STORED, state: 'limited', note: "versioni s'mund të vërtetohet: renderimi (fontet, antialiasing) mund të ndryshojë" });
  else add({ key: 'browser', label: 'Chrome', a: `Chrome ${ba}`, b: `Chrome ${bb}`, state: ba === bb ? 'ok' : 'limited', note: ba === bb ? 'i njëjti version kryesor' : 'versione të ndryshme: renderimi mund të ndryshojë pa ndryshim në sit' });
  return checks;
}

function statusOf(checks: Check[]): PairStatus {
  if (checks.some((c) => c.state === 'blocked')) return 'not-comparable';
  return checks.some((c) => c.state === 'limited') ? 'limited' : 'full';
}

export function compareVisual(fileA: string, a: Obj, fileB: string, b: Obj, shotPath: ShotPath): VisualCompare {
  const sa = summarize(fileA, a);
  const sb = summarize(fileB, b);
  const stateOf = stateOfPath(shotPath);
  const ga = gallery(a, stateOf);
  const gb = gallery(b, stateOf);
  const base: VisualCompare = { a: { file: fileA, date: ga.auditDate, g: ga }, b: { file: fileB, date: gb.auditDate, g: gb }, sa, sb, sameTarget: true, caveats: [], pairs: [] };
  if (sa.siteKey !== sb.siteKey || sa.kind !== 'url') return { ...base, sameTarget: false, reason: sa.kind !== 'url' || sb.kind !== 'url' ? 'Auditet e skedarëve s\'kanë pamje të renderuara.' : `Raporte për site të ndryshme (${sa.target} ↔ ${sb.target}): pamjet s'krahasohen.` };
  const caveats: string[] = [];
  if ((sa.date ?? '') > (sb.date ?? '')) caveats.push('Raporti A është më i ri se B: ndryshimet lexohen nga A te B.');
  if (!ga.available) caveats.push(`A: ${ga.reason}`);
  if (!gb.available) caveats.push(`B: ${gb.reason}`);

  const size = (s: Shot | undefined) => {
    if (!s || s.status !== 'ok' || s.state !== 'ok') return null;
    const p = shotPath(s.screenshot);
    return p ? imageFileSize(p) : null;
  };
  const keyOf = (s: Shot) => `${s.device}\u0000${s.url}`;
  const byA = new Map(ga.shots.map((s) => [keyOf(s), s]));
  const byB = new Map(gb.shots.map((s) => [keyOf(s), s]));
  const keys = [...new Set([...byA.keys(), ...byB.keys()])];
  const devOrder = (d: string) => (d === 'desktop' ? 0 : d === 'mobile' ? 1 : 2);
  const pairs = keys.map((k): VisualPair => {
    const sa2 = byA.get(k);
    const sb2 = byB.get(k);
    const s0 = (sa2 ?? sb2)!;
    const fA = size(sa2);
    const fB = size(sb2);
    const pair: VisualPair = { url: s0.url, device: s0.device, a: sa2, b: sb2, status: 'not-comparable', orientative: false, checks: [], fileA: fA, fileB: fB };
    const missing = (s: Shot | undefined, side: 'A' | 'B'): Check | null => {
      if (!s) return { key: 'url', label: 'Pamja', a: side === 'A' ? 'mungon' : '', b: side === 'B' ? 'mungon' : '', state: 'blocked', note: `faqja s'u kap në këtë pajisje te ${side} (renderohen vetëm disa faqe përfaqësuese)` };
      if (s.status !== 'ok') return { key: 'url', label: 'Pamja', a: side === 'A' ? 'pa pamje' : '', b: side === 'B' ? 'pa pamje' : '', state: 'blocked', note: `s'u renderua te ${side}: ${renderReason(s)}` };
      return null;
    };
    const m = [missing(sa2, 'A'), missing(sb2, 'B')].filter((c): c is Check => !!c);
    if (m.length) return { ...pair, checks: m };
    const checks = pairChecks(sa2!, sb2!, ga, gb, fA, fB);
    const vp = checks.find((x) => x.key === 'viewport');
    const orientative = !!vp && (vp.a === NOT_STORED || vp.b === NOT_STORED);
    return { ...pair, checks, status: statusOf(checks), orientative };
  });
  pairs.sort((x, y) => x.url.localeCompare(y.url) || devOrder(x.device) - devOrder(y.device));
  return { ...base, caveats, pairs };
}

// ---------------------------------------------------------------- Ndryshimi i pikselëve

/** Toleranca për zhurmën e JPEG (q70): diferenca maksimale e një kanali (0–255). PROVIZORE, e pakalibruar. */
export const PIXEL_TOLERANCE = 40;
/** Brezat horizontalë (px CSS) për të treguar ku përqendrohet ndryshimi. */
export const BAND_PX = 200;

export interface PixelDiff {
  ok: true;
  width: number;
  /** Lartësia e zonës së përbashkët (px të skedarit). */
  commonHeight: number;
  heightA: number;
  heightB: number;
  changedPct: number;
  /** Diferenca më e madhe e një kanali ngjyre në zonën e përbashkët (0–255). */
  maxChannelDiff: number;
  bands: { from: number; to: number; pct: number }[];
}

export type PixelDiffResult = PixelDiff | { ok: false; reason: string };

const cache = new Map<string, PixelDiffResult>();

/** Përqindja e pikselëve që ndryshojnë përtej tolerancës në zonën e përbashkët (nga maja), sipas brezave. */
export function pixelDiff(fileA: string, fileB: string, dpr = 1): PixelDiffResult {
  let key = '';
  try {
    key = `${fileA}|${fs.statSync(fileA).mtimeMs}|${fileB}|${fs.statSync(fileB).mtimeMs}|${dpr}`;
  } catch {
    return { ok: false, reason: "Skedari s'u lexua" };
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const res = computeDiff(fileA, fileB, dpr);
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, res);
  return res;
}

function computeDiff(fileA: string, fileB: string, dpr: number): PixelDiffResult {
  if (!/\.jpe?g$/i.test(fileA) || !/\.jpe?g$/i.test(fileB)) return { ok: false, reason: 'Matja e pikselëve mbështet vetëm screenshot-e JPEG.' };
  let a: { width: number; height: number; data: Uint8Array };
  let b: typeof a;
  try {
    const opts = { useTArray: true as const, formatAsRGBA: true, maxResolutionInMP: 30, maxMemoryUsageInMB: 512 };
    a = jpeg.decode(fs.readFileSync(fileA), opts);
    b = jpeg.decode(fs.readFileSync(fileB), opts);
  } catch (e) {
    return { ok: false, reason: `S'u dekodua: ${(e as Error).message.slice(0, 120)}` };
  }
  if (a.width !== b.width) return { ok: false, reason: `Gjerësi të ndryshme (${a.width} ↔ ${b.width} px): s'krahasohen piksel-për-piksel.` };
  const w = a.width;
  const h = Math.min(a.height, b.height);
  const bandH = Math.max(1, Math.round(BAND_PX * dpr));
  const bandCounts: number[] = [];
  let changed = 0;
  let maxD = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    const off = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = off + x * 4;
      const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!));
      if (d > maxD) maxD = d;
      if (d > PIXEL_TOLERANCE) row++;
    }
    changed += row;
    const band = Math.floor(y / bandH);
    bandCounts[band] = (bandCounts[band] ?? 0) + row;
  }
  const total = w * h;
  const bands = bandCounts.map((c, i) => {
    const from = i * bandH;
    const to = Math.min(h, from + bandH);
    return { from: Math.round(from / dpr), to: Math.round(to / dpr), pct: Math.round((c / (w * (to - from))) * 1000) / 10 };
  });
  return { ok: true, width: w, commonHeight: h, heightA: a.height, heightB: b.height, changedPct: total ? Math.round((changed / total) * 1000) / 10 : 0, maxChannelDiff: maxD, bands };
}
