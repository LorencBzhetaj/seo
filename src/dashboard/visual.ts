import { captures, type IssueView } from './model.js';
import { arr, num, obj, str, type Obj } from './store.js';

/**
 * Pamjet e renderuara të një raporti URL (quality.visual.captures) dhe lidhja e tyre me sinjalet.
 * Vetëm lexim i raportit: s'shpiket asnjë e dhënë që mungon. Madhësia e viewport-it s'ruhet në raportet
 * para metadatave të kapjes (vetëm desktop/mobile), prandaj pamja e tregon si "s'është ruajtur".
 */
export type ShotState = 'ok' | 'missing' | 'invalid';

export interface Size {
  width: number;
  height: number;
}

/** Metadatat e kapjes, siç i ruajti motori (null/'' = s'janë ruajtur: raport i vjetër). */
export interface CaptureMeta {
  viewportSize: (Size & { deviceScaleFactor: number; isMobile: boolean | null }) | null;
  measuredViewport: Size | null;
  clip: (Size & { documentHeight: number; clipped: boolean }) | null;
  screenshotSize: Size | null;
  capturedAt: string;
}

const size = (v: unknown): Size | null => {
  const o = obj(v);
  const width = num(o.width);
  const height = num(o.height);
  return width !== null && height !== null ? { width, height } : null;
};

export function captureMeta(o: Obj): CaptureMeta {
  const vs = size(o.viewportSize);
  const vso = obj(o.viewportSize);
  const cl = size(o.clip);
  const clo = obj(o.clip);
  return {
    viewportSize: vs && { ...vs, deviceScaleFactor: num(vso.deviceScaleFactor) ?? 1, isMobile: typeof vso.isMobile === 'boolean' ? vso.isMobile : null },
    measuredViewport: size(o.measuredViewport),
    clip: cl && typeof clo.clipped === 'boolean' && num(clo.documentHeight) !== null ? { ...cl, documentHeight: num(clo.documentHeight)!, clipped: clo.clipped } : null,
    screenshotSize: size(o.screenshotSize),
    capturedAt: str(o.capturedAt),
  };
}

/** Si e shikon dashboard-i një shteg screenshot-i: i vlefshëm dhe ekziston në output/visual, mungon, ose i pavlefshëm. */
export type ShotStateOf = (rel: string) => ShotState;

export interface Shot {
  /** Indeksi në quality.visual.captures (identifikon pamjen në URL-në e galerisë). */
  index: number;
  url: string;
  finalUrl: string;
  pageType: string;
  device: string;
  status: string;
  reason: string;
  screenshot: string;
  state: ShotState;
  /** Lartësia e faqes së renderuar (px), nga matjet e raportit. */
  documentHeight: number | null;
  meta: CaptureMeta;
}

export interface Gallery {
  /** Raporti ka seksion quality.visual (raportet e vjetra s'e kanë). */
  available: boolean;
  /** Arsyeja kur s'ka pamje (seksion i anashkaluar/mungon). */
  reason: string;
  auditDate: string;
  screenshotsDir: string;
  maxScreenshotHeight: number | null;
  /** Gjendja e çdo shtegu (edhe i atyre që s'janë pamje të raportit, p.sh. në prova). */
  stateOf: ShotStateOf;
  shots: Shot[];
  pages: string[];
  devices: string[];
  /** Chrome-i që renderoi pamjet ('' = s'është ruajtur). */
  browserVersion: string;
}

export function gallery(r: Obj, stateOf: ShotStateOf): Gallery {
  const q = obj(r.quality);
  const v = obj(q.visual);
  const auditDate = str(r.completedAt) || str(r.startedAt);
  if (!r.quality) return { available: false, reason: "Ky raport s'ka seksionin e cilësisë/pamjes (raport i vjetër ose auditi pa këtë modul).", auditDate, screenshotsDir: '', maxScreenshotHeight: null, stateOf, shots: [], pages: [], devices: [], browserVersion: '' };
  if (!q.visual) {
    const why = q.status === 'skipped' ? str(q.reason) : obj(obj(q.statuses).visualIdentity).reason;
    return { available: false, reason: `Ky raport s'ka pamje të renderuara${str(why) ? `: ${str(why)}` : '.'}`, auditDate, screenshotsDir: '', maxScreenshotHeight: null, stateOf, shots: [], pages: [], devices: [], browserVersion: '' };
  }
  const raw = arr(v.captures).map(obj);
  const shots = captures(r).map((c, index): Shot => {
    const o = raw[index] ?? {};
    return {
      index,
      url: c.url,
      finalUrl: str(o.finalUrl),
      pageType: c.pageType,
      device: c.viewport,
      status: c.status,
      reason: c.reason,
      screenshot: c.screenshot,
      state: c.screenshot ? stateOf(c.screenshot) : 'missing',
      documentHeight: num(obj(o.summary).documentHeight) ?? num(obj(o.probe).documentHeight),
      meta: captureMeta(o),
    };
  });
  return {
    available: true,
    reason: '',
    auditDate,
    screenshotsDir: str(v.screenshotsDir),
    maxScreenshotHeight: num(obj(v.limits).maxScreenshotHeight),
    stateOf,
    shots,
    pages: [...new Set(shots.map((s) => s.url).filter(Boolean))],
    devices: [...new Set(shots.map((s) => s.device).filter(Boolean))],
    browserVersion: str(v.browserVersion),
  };
}

export function filterShots(g: Gallery, page?: string, device?: string): Shot[] {
  return g.shots.filter((s) => (!page || s.url === page) && (!device || s.device === device));
}

/** Provë e një sinjali që është screenshot. */
export interface ProofLink {
  /** Shtegu siç është në provë (raw). */
  rel: string;
  state: ShotState;
  /** Pamja e galerisë me të njëjtin shteg, faqe dhe pajisje — vetëm kur përputhja vërtetohet. */
  shot?: Shot;
  /** Pse përputhja s'u vërtetua (kur shot mungon). */
  unverified?: string;
}

export interface SignalShots {
  proof: ProofLink[];
  /** Pamje të së njëjtës faqe (URL e njëjtë), që s'janë provë e sinjalit. */
  context: Shot[];
  /** Faqet e sinjalit pa asnjë pamje të renderuar në raport. */
  pagesWithoutShots: string[];
}

/**
 * Lidhja sinjal → screenshot.
 * - Provë: vetëm kur shtegu në provë përputhet saktësisht me një pamje të raportit dhe faqja e asaj pamjeje
 *   është faqja e sinjalit (ose URL-ja e vetë provës). Pajisja merret nga ajo pamje, s'hamendësohet nga emri i skedarit.
 * - Kontekst: pamjet e renderuara (status ok) me URL saktësisht të njëjtë me një faqe të sinjalit.
 */
export function signalShots(i: IssueView, g: Gallery): SignalShots {
  const pages = new Set([...i.pages, i.url].filter(Boolean));
  const proof: ProofLink[] = i.evidence
    .filter((e) => e.type === 'screenshot' && e.raw)
    .map((e) => {
      const byPath = g.shots.find((s) => s.screenshot === e.raw);
      const state = byPath?.state ?? 'missing';
      if (!byPath) return { rel: e.raw, state: g.stateOf(e.raw), unverified: "Shtegu s'gjendet te pamjet e këtij raporti: faqja dhe pajisja s'vërtetohen." };
      const pageOk = pages.has(byPath.url) || (!!e.url && e.url === byPath.url);
      if (!pageOk) return { rel: e.raw, state, unverified: `Pamja i përket një faqeje tjetër (${byPath.url}): s'lidhet si provë e këtij sinjali.` };
      return { rel: e.raw, state, shot: byPath };
    });
  const proofPaths = new Set(proof.filter((p) => p.shot).map((p) => p.rel));
  const context = g.shots.filter((s) => s.status === 'ok' && s.screenshot && pages.has(s.url) && !proofPaths.has(s.screenshot));
  const covered = new Set(g.shots.filter((s) => s.status === 'ok' && s.screenshot).map((s) => s.url));
  return { proof, context, pagesWithoutShots: [...pages].filter((p) => !covered.has(p)) };
}

/** Sinjalet e cilësisë që lidhen me një pamje: provë (shtegu i saj) ose të së njëjtës faqe. */
export function signalsForShot(shot: Shot, issues: IssueView[], g: Gallery): { proof: IssueView[]; samePage: IssueView[] } {
  const proof: IssueView[] = [];
  const samePage: IssueView[] = [];
  for (const i of issues.filter((x) => x.section === 'quality')) {
    const s = signalShots(i, g);
    if (s.proof.some((p) => p.shot?.index === shot.index)) proof.push(i);
    else if (new Set([...i.pages, i.url]).has(shot.url)) samePage.push(i);
  }
  return { proof, samePage };
}
