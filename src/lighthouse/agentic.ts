import type { LhAudit, LhCategory } from './run-lighthouse.js';

/**
 * Kategoritë e Lighthouse që raporti ruan veç, jashtë Health Score:
 * - "Agentic Browsing" (eksperimentale në Lighthouse 13.x, id `agentic-browsing`, categoryScoreDisplayMode
 *   `fraction`): rezultati ruhet si "kontrolle të kaluara / të vlerësueshme", me të njëjtin rregull si raporti i
 *   Lighthouse (report-utils.js `calculateCategoryFraction` + `showAsPassed`), jo si pikë 0–100;
 * - "Lighthouse SEO" (`seo`): pika e Lighthouse, e ndarë nga SEO teknik i mjetit.
 * S'krijojnë gjetje dhe s'hyjnë në Health; s'janë matje trafiku, renditjeje në Google apo përmendjesh nga AI.
 */

export const AGENTIC_CATEGORY_ID = 'agentic-browsing';
/** Pragu "kaluar" i Lighthouse (RATINGS.PASS.minScore). */
const PASS_MIN_SCORE = 0.9;

export type AgenticResult = 'pass' | 'fail' | 'not-applicable' | 'informative' | 'manual' | 'error';

export interface AgenticAudit {
  id: string;
  title: string;
  group?: string;
  weight: number;
  scoreDisplayMode: string;
  score: number | null;
  result: AgenticResult;
  displayValue?: string;
  explanation?: string;
  errorMessage?: string;
  /** Provat (rreshtat e tabelës së Lighthouse), të shkurtuara: deri në 10, secila ≤ 240 karaktere. */
  items: string[];
  itemsTotal: number;
}

export type AgenticBrowsing =
  | {
      status: 'ok';
      experimental: true;
      lighthouseVersion?: string;
      title: string;
      /** Si e paraqet Lighthouse kategorinë (13.x: "fraction"). */
      displayMode: string;
      passed: number;
      /** Kontrolle që Lighthouse i numëron (pa N/A, manual dhe informative). */
      passable: number;
      notApplicable: number;
      /** Informative që s'kaluan (Lighthouse i tregon veç, jo te thyesa). */
      informativeNotPassed: number;
      errors: number;
      audits: AgenticAudit[];
    }
  | { status: 'skipped'; experimental: true; lighthouseVersion?: string; reason: string };

export interface LhSeoCategory {
  title: string;
  /** Pika e Lighthouse 0–100 (score × 100, e rrumbullakuar si në raportin e Lighthouse); null kur s'u llogarit. */
  score: number | null;
  /** Auditet me peshë që s'kaluan (id), për referencë. */
  failedAudits: string[];
}

interface LhLike {
  lighthouseVersion?: string;
  categories: Record<string, LhCategory | undefined>;
  audits: Record<string, (LhAudit & { explanation?: string; errorMessage?: string }) | undefined>;
}

/** Si Lighthouse `showAsPassed`: manual/N/A kalojnë, error/informative jo, të tjerat me score ≥ 0.9. */
export function showAsPassed(mode: string, score: number | null): boolean {
  if (mode === 'manual' || mode === 'notApplicable') return true;
  if (mode === 'error' || mode === 'informative') return false;
  return Number(score) >= PASS_MIN_SCORE;
}

function resultOf(mode: string, score: number | null): AgenticResult {
  if (mode === 'notApplicable') return 'not-applicable';
  if (mode === 'manual') return 'manual';
  if (mode === 'error') return 'error';
  if (mode === 'informative') return 'informative';
  return showAsPassed(mode, score) ? 'pass' : 'fail';
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Teksti i një rreshti të tabelës së Lighthouse (fushat tekst + elementi), pa HTML të interpretuar. */
function rowText(row: unknown): string {
  if (!row || typeof row !== 'object') return typeof row === 'string' ? row : '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') parts.push(`${k}: ${String(v)}`);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'node') parts.push(`${k}: ${[o.selector, o.snippet ?? o.nodeLabel].filter((x) => typeof x === 'string' && x).join(' ')}`);
      else if (typeof o.formattedDefault === 'string') parts.push(`${k}: ${o.formattedDefault}`);
    }
  }
  return parts.join(' · ');
}

/** Rreshtat e detajeve (tabelë, ose listë seksionesh me tabela). */
export function detailRows(details: unknown, out: string[] = []): string[] {
  if (!details || typeof details !== 'object') return out;
  const d = details as { type?: string; items?: unknown[] };
  // debugdata: të dhëna të brendshme të Lighthouse, jo provë për përdoruesin.
  if (d.type === 'debugdata' || !Array.isArray(d.items)) return out;
  for (const it of d.items) {
    const t = it && typeof it === 'object' ? (it as { type?: string }).type : undefined;
    if (t === 'table' || t === 'list') detailRows(it, out);
    else if (t === 'list-section') detailRows((it as { value?: unknown }).value, out);
    else {
      const s = rowText(it);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Agentic Browsing nga LHR; "skipped" me arsye kur kjo version/ambient s'e ka kategorinë. */
export function summarizeAgentic(lh: LhLike): AgenticBrowsing {
  const cat = lh.categories[AGENTIC_CATEGORY_ID] as (LhCategory & { manualDescription?: string }) | undefined;
  if (!cat) return { status: 'skipped', experimental: true, lighthouseVersion: lh.lighthouseVersion, reason: `Lighthouse ${lh.lighthouseVersion ?? ''} s'ktheu kategorinë "${AGENTIC_CATEGORY_ID}" (s'mbështetet në këtë version ose u çaktivizua).`.replace('  ', ' ') };
  const audits: AgenticAudit[] = cat.auditRefs.map((ref) => {
    const a = lh.audits[ref.id];
    const mode = a?.scoreDisplayMode ?? 'error';
    const rows = a ? detailRows(a.details) : [];
    return {
      id: ref.id,
      title: a?.title ?? ref.id,
      ...(ref.group ? { group: ref.group } : {}),
      weight: ref.weight,
      scoreDisplayMode: mode,
      score: a?.score ?? null,
      result: a ? resultOf(mode, a.score) : 'error',
      ...(a?.displayValue ? { displayValue: clip(String(a.displayValue), 200) } : {}),
      ...(a?.explanation ? { explanation: clip(String(a.explanation), 400) } : {}),
      ...(a?.errorMessage ? { errorMessage: clip(String(a.errorMessage), 400) } : a ? {} : { errorMessage: 'Auditi mungon në LHR' }),
      items: rows.slice(0, 10).map((r) => clip(r, 240)),
      itemsTotal: rows.length,
    };
  });
  // E njëjta numërim si Lighthouse calculateCategoryFraction (grupi "hidden", manual, N/A dhe informative jashtë thyesës).
  let passed = 0;
  let passable = 0;
  let informativeNotPassed = 0;
  for (const a of audits) {
    if (a.group === 'hidden' || a.scoreDisplayMode === 'manual' || a.scoreDisplayMode === 'notApplicable') continue;
    if (a.scoreDisplayMode === 'informative') {
      if (!showAsPassed(a.scoreDisplayMode, a.score)) informativeNotPassed++;
      continue;
    }
    passable++;
    if (showAsPassed(a.scoreDisplayMode, a.score)) passed++;
  }
  return {
    status: 'ok',
    experimental: true,
    lighthouseVersion: lh.lighthouseVersion,
    title: cat.title,
    displayMode: String((cat as { categoryScoreDisplayMode?: string }).categoryScoreDisplayMode ?? 'gauge'),
    passed,
    passable,
    notApplicable: audits.filter((a) => a.result === 'not-applicable').length,
    informativeNotPassed,
    errors: audits.filter((a) => a.result === 'error').length,
    audits,
  };
}

/** Kategoria SEO e Lighthouse (e ndarë nga SEO teknik i mjetit); undefined kur LHR s'e ka. */
export function summarizeLhSeo(lh: LhLike): LhSeoCategory | undefined {
  const cat = lh.categories.seo;
  if (!cat) return undefined;
  return {
    title: 'Lighthouse SEO',
    score: typeof cat.score === 'number' ? Math.round(cat.score * 100) : null,
    failedAudits: cat.auditRefs.filter((r) => r.weight > 0 && lh.audits[r.id] && !showAsPassed(lh.audits[r.id]!.scoreDisplayMode, lh.audits[r.id]!.score)).map((r) => r.id),
  };
}
