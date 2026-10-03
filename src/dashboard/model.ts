import { arr, num, obj, str, type Obj } from './store.js';

export type Section = 'homepage' | 'site' | 'business' | 'quality';
export type Sev = 'critical' | 'high' | 'medium' | 'low';

export const SECTION_LABELS: Record<Section, string> = {
  homepage: 'Faqja hyrëse',
  site: 'Siti (crawl i kufizuar)',
  business: 'Biznes & privatësi',
  quality: 'Cilësia & pamja (sinjale)',
};
export const SEVERITIES: Sev[] = ['critical', 'high', 'medium', 'low'];
export const SEV_LABELS: Record<Sev, string> = { critical: 'Kritike', high: 'E lartë', medium: 'Mesatare', low: 'E ulët' };

export interface EvidenceView {
  type: string;
  url: string;
  detected: string;
  expected: string;
  /** Për type=screenshot: shtegu relativ (visual/...). Për të tjerat: fragment i papërpunuar (HTML/header), vetëm si tekst. */
  raw: string;
}

export interface IssueView {
  /** Çelës i qëndrueshëm për krahasim: seksioni + kodi + faqja. */
  key: string;
  /** Pozicioni në urlIssues(r): identifikon gjetjen brenda raportit (ankora #gjetja-N). */
  index: number;
  /** page | template | site ('' në raportet e vjetra). */
  scope: string;
  /** Çelësi i plotë i template-it, vetëm në raportet e reja ('' kur s'ruhet). */
  templateKey: string;
  /** Prova për çdo faqe (raportet e reja); bosh në të vjetrat, ku evidence ka vetëm disa shembuj. */
  occurrences: { url: string; detected: string; expected: string }[];
  section: Section;
  code: string;
  module: string;
  severity: Sev;
  priority: number;
  confidence: number | null;
  needsManualReview: boolean;
  message: string;
  whyItMatters: string;
  fix: string;
  url: string;
  pages: string[];
  evidence: EvidenceView[];
}

const sev = (x: unknown): Sev => (SEVERITIES.includes(x as Sev) ? (x as Sev) : 'low');

function toIssue(raw: unknown, section: Section, index = 0): IssueView {
  const i = obj(raw);
  const pages = arr(i.affectedPages).map(str).filter(Boolean);
  const url = str(i.url) || pages[0] || '';
  return {
    key: `${section}|${str(i.code)}|${url}`,
    index,
    scope: str(i.scope),
    templateKey: str(i.templateKey),
    occurrences: arr(i.occurrences).map((e) => {
      const o = obj(e);
      return { url: str(o.url), detected: str(o.detected), expected: str(o.expected) };
    }).filter((o) => o.url),
    section,
    code: str(i.code) || 'UNKNOWN',
    module: str(i.module),
    severity: sev(i.severity),
    priority: num(i.priority) ?? 0,
    confidence: num(i.confidence),
    needsManualReview: i.needsManualReview === true,
    message: str(i.message),
    whyItMatters: str(i.whyItMatters),
    fix: str(i.fix),
    url,
    pages: pages.length ? pages : url ? [url] : [],
    evidence: arr(i.evidence).map((e) => {
      const o = obj(e);
      return { type: str(o.type), url: str(o.url), detected: str(o.detected), expected: str(o.expected), raw: str(o.raw) };
    }),
  };
}

/** Të gjitha issue-t e një raporti URL, me seksionin. Versionet e vjetra kanë vetëm faqen hyrëse. */
export function urlIssues(r: Obj): IssueView[] {
  return [
    ...arr(r.issues).map((i) => toIssue(i, 'homepage')),
    ...arr(obj(r.site).issues).map((i) => toIssue(i, 'site')),
    ...arr(obj(r.business).issues).map((i) => toIssue(i, 'business')),
    ...arr(obj(r.quality).issues).map((i) => toIssue(i, 'quality')),
  ].map((i, index) => ({ ...i, index }));
}

/** Seksionet që ekzistojnë në raport (schema 1 s'ka site; 1–2 s'kanë business; 1–3 s'kanë quality). */
export function sectionsPresent(r: Obj): Set<Section> {
  const s = new Set<Section>(['homepage']);
  for (const k of ['site', 'business', 'quality'] as const) if (r[k] && obj(r[k]).status !== 'skipped') s.add(k);
  return s;
}

/** Faqet që u kontrolluan realisht (faqja hyrëse + faqet e crawl-it). */
export function checkedPages(r: Obj): Set<string> {
  const pages = new Set<string>([str(r.url), str(r.finalUrl)].filter(Boolean));
  for (const p of arr(obj(obj(r.site).crawl).pages)) {
    const o = obj(p);
    for (const u of [str(o.url), str(o.finalUrl)]) if (u) pages.add(u);
  }
  return pages;
}

export interface Capture {
  url: string;
  viewport: string;
  status: string;
  reason: string;
  screenshot: string;
  pageType: string;
}

export function captures(r: Obj): Capture[] {
  return arr(obj(obj(r.quality).visual).captures).map((c) => {
    const o = obj(c);
    return { url: str(o.url), viewport: str(o.viewport), status: str(o.status), reason: str(o.reason), screenshot: str(o.screenshot), pageType: str(o.pageType) };
  });
}

export interface SourceFindingView {
  code: string;
  category: string;
  severity: Sev;
  confidence: number | null;
  needsManualReview: boolean;
  message: string;
  file: string;
  line: number | null;
  evidence: string;
  suggestion: string;
  whyItMatters: string;
  related: string[];
}

export function sourceFindings(r: Obj): SourceFindingView[] {
  return arr(r.findings).map((f) => {
    const o = obj(f);
    return {
      code: str(o.code) || 'UNKNOWN',
      category: str(o.category),
      severity: sev(o.severity),
      confidence: num(o.confidence),
      needsManualReview: o.needsManualReview === true,
      message: str(o.message),
      file: str(o.file),
      line: num(o.line),
      evidence: str(o.evidence),
      suggestion: str(o.suggestion),
      whyItMatters: str(o.whyItMatters),
      related: arr(o.related).map((x) => str(obj(x).file) || str(x)).filter(Boolean),
    };
  });
}

/** "path:line" kur rreshti dihet; përndryshe vetëm path (rreshti s'shpiket). */
export const fileRef = (f: { file: string; line: number | null }) => (f.line ? `${f.file}:${f.line}` : f.file);
