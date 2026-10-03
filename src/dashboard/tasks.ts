import { checkedPages, SEVERITIES, type IssueView, type Section, type Sev } from './model.js';
import { arr, num, obj, str, type Obj } from './store.js';

/**
 * "Detyrat e rekomanduara": gjetjet e raportit të bashkuara sipas problemit, vetëm kur ka provë të arsyeshme
 * për të njëjtin shkak. Model pamjeje, i nxjerrë nga JSON-i; s'ndryshon gjetjet, pikët ose Health Score-in.
 *
 * Rregullat e bashkimit (të shpjegueshme, konservative):
 * - Gjetje me scope "template": motori i grupoi faqet sipas të njëjtit çelës template-i (klasat e body-t pa
 *   numra, ose hash i skeletit të DOM-it). Një gjetje = një detyrë; dy gjetje me të njëjtin kod por template
 *   tjetër mbeten detyra të ndara.
 * - Gjetje që lidhin vetë faqet (titull/description identik, përmbajtje e ngjashme): një detyrë me të gjitha URL-të,
 *   pa e quajtur defekt template-i.
 * - Sinjali LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT në faqe të ndryshme me saktësisht të njëjtin emër linku: një
 *   detyrë "mund të jenë të lidhura — verifiko" (komponenti s'identifikohet nga raporti).
 * - Çdo gjë tjetër: një detyrë për gjetje. I njëjti kod vetëm s'mjafton për bashkim; lidhjet e mundshme
 *   shfaqen si "të lidhura", pa u bashkuar.
 */

export type TaskArea = Section;
export type TaskBasis = 'template' | 'linked-pages' | 'separate-pages' | 'possibly-related' | 'single-page' | 'site-wide';

export const AREA_LABELS: Record<TaskArea, string> = {
  homepage: 'Faqja hyrëse',
  site: 'Shumë faqe të sitit',
  business: 'Biznes & privatësi',
  quality: 'Sinjale cilësie (shqyrtim njerëzor)',
};

export const BASIS_LABELS: Record<TaskBasis, string> = {
  template: 'strukturë e ngjashme — verifiko komponentin',
  'linked-pages': 'faqe të lidhura nga vetë gjetja',
  'separate-pages': 'faqe të veçanta',
  'possibly-related': 'mund të jenë të lidhura — verifiko',
  'single-page': 'një faqe',
  'site-wide': 'konfigurim i sitit/serverit',
};

/** Përmbajtje e secilës faqe (description, titull…): struktura e ngjashme s'e bën rregullim të përbashkët. */
type Nature = 'per-page-content' | 'structure' | 'mixed';
const NATURE: Record<string, Nature> = {
  MISSING_META_DESCRIPTION: 'per-page-content',
  META_DESCRIPTION_LENGTH: 'per-page-content',
  MISSING_TITLE: 'per-page-content',
  TITLE_LENGTH: 'per-page-content',
  THIN_CONTENT_POSSIBLE: 'per-page-content',
  IMAGES_MISSING_ALT: 'per-page-content',
  HEADING_LEVEL_SKIP: 'structure',
  MULTIPLE_H1: 'structure',
  MULTIPLE_TITLES: 'structure',
  MULTIPLE_META_DESCRIPTIONS: 'structure',
  MISSING_HTML_LANG: 'structure',
  MISSING_H1: 'mixed',
};

const SEO_PLUGIN_CODES = new Set(['MISSING_META_DESCRIPTION', 'META_DESCRIPTION_LENGTH', 'MISSING_TITLE', 'TITLE_LENGTH']);
const LINKED_PAGE_CODES = new Set(['DUPLICATE_TITLES', 'DUPLICATE_META_DESCRIPTIONS', 'SIMILAR_CONTENT_POSSIBLE', 'DUPLICATES_WITHOUT_CONSISTENT_CANONICAL', 'CONFLICTING_CANONICALS']);
const LH_MODULES = new Set(['performance', 'accessibility', 'best-practices']);
/** Rreshti përmbledhës që motori shton pas shembujve; s'është provë për një faqe. */
const MORE_NOTE = /^… dhe \d+ faqe të tjera/;

export interface PageEvidence {
  url: string;
  /** Provat për këtë faqe nga gjetjet e detyrës. Bosh: prova individuale s'është ruajtur. */
  items: { finding: number; detected: string; expected: string }[];
}

export interface Task {
  id: string;
  area: TaskArea;
  code: string;
  basis: TaskBasis;
  /** Problemi, me fjalë të kuptueshme. */
  problem: string;
  /** Veprimi i propozuar. */
  action: string;
  /** Pse u bashkuan gjetjet (ose pse kjo është një detyrë më vete). */
  why: string;
  /** Emri teknik i template-it, vetëm për detaje ('' kur s'dihet). */
  templateLabel: string;
  /** true vetëm kur raporti ruan çelësin e plotë të template-it. */
  templateKeyStored: boolean;
  severity: Sev;
  confidence: { min: number | null; max: number | null };
  needsManualReview: boolean;
  /** Shënime kujdesi (Lighthouse një matje, sinjal jashtë Health, iframe…). */
  cautions: string[];
  findings: IssueView[];
  /** URL unike (një herë secila), sipas renditjes së gjetjeve. */
  pages: string[];
  /** Sa nga URL-të janë mes faqeve të kontrolluara nga crawl-i/faqja hyrëse. */
  pagesInChecked: number;
  evidence: PageEvidence[];
  /** Detyra të tjera që mund të lidhen, pa u bashkuar. */
  related: { id: string; why: string }[];
  /**
   * Rëndësia vjen nga një raport historik (pa fushën access) dhe s'është vlerësimi aktual i mjetit:
   * shfaqet me shënimin "rëndësi historike e raportit; kërkon verifikim".
   */
  historicalSeverity?: boolean;
  /** Pse është në këtë vend të renditjes. */
  rankWhy: string;
  priority: number;
}

export interface Coverage {
  hasCrawl: boolean;
  /** Faqet e analizuara nga crawl-i (ose 1: vetëm faqja hyrëse). */
  checked: number;
  discovered: number | null;
  partial: boolean;
}

/** Përgjigje bllokimi për faqen hyrëse (401/403/429), e provuar nga të dhënat e raportit. */
export interface BlockedResponse {
  status: number;
  /** Nga cila e dhënë e raportit u nxor. */
  source: string;
}

export interface TaskList {
  tasks: Task[];
  coverage: Coverage;
  /** Faqja hyrëse u bllokua për tool-in (null: s'ka provë të mjaftueshme). */
  blocked: BlockedResponse | null;
  /** Gjetje të faqes hyrëse të matura te përgjigjja e bllokimit: s'janë detyra. */
  measuredOnBlock: IssueView[];
  /** Seria e Lighthouse (faza 4), kur raporti e ka: nga cila matje vijnë gjetjet. */
  lighthouseSeries: { planned: number; valid: number; representativeRun: number | null } | null;
  /** Indeksi i gjetjes (në urlIssues) → id e detyrës. */
  taskOfFinding: Map<number, string>;
}

export const RANKING_NOTE =
  'Renditja: rëndësia → gjetjet e konfirmuara para atyre që kërkojnë verifikim → numri i faqeve të prekura → prioriteti i motorit. ' +
  "Numri i faqeve tregon shtrirjen brenda faqeve të kontrolluara; s'është masë e trafikut apo e renditjes në kërkim (mjeti s'ka të dhëna Search Console) dhe asnjë detyrë s'garanton fitim SEO.";

export function coverageOf(r: Obj): Coverage {
  const site = obj(r.site);
  const crawl = obj(site.crawl);
  const analyzed = num(crawl.pagesAnalyzed);
  if (!r.site || site.status === 'skipped' || analyzed === null) return { hasCrawl: false, checked: 1, discovered: null, partial: false };
  const discovered = num(crawl.urlsDiscovered);
  // I pjesshëm vetëm kur kufijtë e ndalën crawl-in; skedarët dhe URL-të e pasigurta të anashkaluara s'e bëjnë të tillë.
  const stopped = ['max-pages', 'time-budget', 'crawl-stopped'].some((k) => (num(obj(obj(crawl.notCheckedByReason)[k]).count) ?? 0) > 0);
  return { hasCrawl: true, checked: analyzed, discovered, partial: crawl.truncated === true || stopped };
}

/** "N faqe të prekura mes M faqeve të kontrolluara" — kurrë si numër për gjithë sitin. */
/** Shënimi i mbulimit për krye të faqes. */
export function coverageNote(c: Coverage): string {
  if (!c.hasCrawl) return "Ky raport s'ka crawl: detyrat vlejnë vetëm për faqen hyrëse dhe faqet e përmendura në gjetje.";
  const scope = `U kontrolluan ${c.checked} faqe${c.discovered !== null ? ` nga ${c.discovered} URL të zbuluara (pjesa tjetër: skedarë, URL të pasigurta, ridrejtime ose gabime)` : ''}.`;
  return c.partial
    ? `${scope} Crawl-i u ndal nga kufijtë (i pjesshëm): numrat e faqeve vlejnë vetëm për faqet e kontrolluara; faqet e pakontrolluara mund ta kenë problemin ose jo.`
    : `${scope} Numrat e faqeve vlejnë për faqet e kontrolluara, jo për gjithë sitin.`;
}

export function coverageText(t: Task, c: Coverage): string {
  const n = t.pages.length;
  const unit = n === 1 ? 'faqe e prekur' : 'faqe të prekura';
  if (t.area === 'homepage' && n <= 1) return 'faqja hyrëse';
  if (!c.hasCrawl) return `${n} ${unit} (pa crawl: u kontrollua vetëm faqja hyrëse)`;
  return t.pagesInChecked === n
    ? `${n} ${unit} mes ${c.checked} faqeve të kontrolluara`
    : `${n} URL të prekura (${t.pagesInChecked} prej tyre mes ${c.checked} faqeve të kontrolluara)`;
}

function templateLabelOf(i: IssueView): string {
  if (i.templateKey) return i.templateKey.replace(/^(body|dom):/, '');
  return i.message.match(/— i njëjti template \(([^)]*)\)/)?.[1] ?? '';
}

/** Emri i aksesueshëm i linkut nga prova e sinjalit (për bashkimin "mund të jenë të lidhura"). */
function linkNameOf(i: IssueView): string {
  return i.evidence.map((e) => e.detected.match(/emri i aksesueshëm: "([^"]*)"/)?.[1]).find((x): x is string => x !== undefined) ?? '';
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

function pageEvidence(findings: IssueView[], pages: string[]): PageEvidence[] {
  return pages.map((url) => ({
    url,
    items: findings.flatMap((f) => {
      const occ = f.occurrences.filter((o) => o.url === url);
      const src = occ.length ? occ : f.evidence.filter((e) => e.url === url && e.type !== 'screenshot' && !MORE_NOTE.test(e.detected));
      return src.map((e) => ({ finding: f.index, detected: e.detected, expected: e.expected }));
    }),
  }));
}

/** Elementi konkret që emërton prova (tekst në thonjëza jashtë tag-eve HTML), p.sh. H2 → H4 ("Explore") → Explore. */
export function elementOf(detected: string): string {
  return detected.replace(/<[^>]*>/g, '').match(/"([^"]+)"/)?.[1] ?? '';
}

/**
 * Veprimi për faqe me strukturë të ngjashme (klasa të njëjta të body-t). Rregullim i përbashkët sugjerohet vetëm
 * kur çdo faqe ka provë dhe të gjitha emërtojnë të njëjtin element; përndryshe faqet kontrollohen veçmas.
 */
function templateAction(code: string, fix: string, ev: PageEvidence[]): string {
  const n = ev.length;
  const withEv = ev.filter((e) => e.items.length);
  const byEl = new Map<string, number>();
  for (const e of withEv) for (const el of new Set(e.items.map((x) => elementOf(x.detected)).filter(Boolean))) byEl.set(el, (byEl.get(el) ?? 0) + 1);
  const allSame = withEv.length === n && byEl.size === 1 && [...byEl.values()][0] === n;
  if (allSame) {
    const el = [...byEl.keys()][0]!;
    return `${fix} Të ${n} faqet kanë provë për të njëjtin element ("${el}"): ka gjasa të jetë një komponent i përbashkët. Gjeje komponentin që e përmban dhe kontrolloje aty; pas ndryshimit verifiko disa nga faqet.`;
  }
  const repeated = [...byEl].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0];
  const perPage = NATURE[code] !== 'per-page-content'
    ? ''
    : SEO_PLUGIN_CODES.has(code)
      ? ' Kjo është përmbajtje e secilës faqe; nëse përdor plugin SEO, kontrollo edhe vlerën e tij të parazgjedhur.'
      : ' Kjo është përmbajtje e secilës faqe.';
  return `${fix} Kontrollo faqet veçmas: struktura e ngjashme s'provon një komponent ose një rregullim të vetëm.${perPage}${repeated ? ` Elementi "${repeated[0]}" përsëritet në ${repeated[1]} faqe — mund të jetë komponent i përbashkët, verifikoje.` : ''}${withEv.length < n ? ` Raporti ka provë individuale vetëm për ${withEv.length} nga ${n} faqe.` : ''}`;
}

function actionFor(code: string, basis: TaskBasis, f: IssueView, n: number): string {
  const fix = f.fix;
  if (basis === 'separate-pages') return `${fix} Faqet s'ndajnë template të identifikuar: rregulloje veç për secilën.`;
  return fix;
}

const ACCESS_CODES = new Set(['HOMEPAGE_HTTP_ERROR', 'HOMEPAGE_ACCESS_DENIED']);
const BLOCK_STATUSES = [401, 403, 429];
const BLOCK_IN_TEXT = /\bHTTP (401|403|429)\b/;

/**
 * A u bllokua faqja hyrëse për tool-in? Vetëm nga matje të drejtpërdrejta të raportit:
 * - raportet e reja: fusha `access` (state "blocked"); kur ekziston dhe s'është "blocked", s'supozohet asgjë;
 * - raportet e vjetra (pa `access`): gjetja HOMEPAGE_HTTP_ERROR/HOMEPAGE_ACCESS_DENIED me provë "HTTP 401/403/429",
 *   ose metrika http-status e modulit availability me një nga këto kode.
 * Gabimi i Lighthouse ("Status code: 403") vetëm s'mjafton: mund të jetë specifik për Lighthouse.
 */
export function blockedResponse(r: Obj, issues: IssueView[]): BlockedResponse | null {
  if (r.access !== undefined) {
    const a = obj(r.access);
    return a.state === 'blocked' ? { status: num(a.httpStatus) ?? 0, source: 'fusha "access" e raportit (state: blocked)' } : null;
  }
  const avail = arr(r.modules).map(obj).find((m) => str(m.module) === 'availability');
  const metric = num(arr(avail?.metrics).map(obj).find((x) => str(x.id) === 'http-status')?.value);
  const diag = issues.find((i) => i.section === 'homepage' && ACCESS_CODES.has(i.code) && i.evidence.some((e) => BLOCK_IN_TEXT.test(e.detected)));
  if (diag) {
    const status = Number(diag.evidence.map((e) => e.detected.match(BLOCK_IN_TEXT)?.[1]).find(Boolean));
    return { status, source: `gjetja ${diag.code} (provë: HTTP ${status})${metric === status ? ' dhe metrika http-status e availability' : ''}` };
  }
  if (metric !== null && BLOCK_STATUSES.includes(metric)) return { status: metric, source: 'metrika http-status e modulit availability' };
  return null;
}

/** Ndërton detyrat nga gjetjet e raportit (urlIssues). */
export function buildTasks(r: Obj, issues: IssueView[]): TaskList {
  const coverage = coverageOf(r);
  const checked = checkedPages(r);
  type Draft = Omit<Task, 'id' | 'pages' | 'pagesInChecked' | 'evidence' | 'related' | 'rankWhy' | 'severity' | 'confidence' | 'needsManualReview' | 'priority'>;
  const drafts: Draft[] = [];
  const used = new Set<number>();

  // 0) Faqja hyrëse e bllokuar: gjetjet e saj (header-a, SEO, TTFB…) u matën te përgjigjja e bllokimit → s'janë detyra.
  const blocked = blockedResponse(r, issues);
  const measuredOnBlock = blocked ? issues.filter((i) => i.section === 'homepage' && !ACCESS_CODES.has(i.code)) : [];
  measuredOnBlock.forEach((i) => used.add(i.index));
  if (blocked) {
    for (const i of issues.filter((x) => x.section === 'homepage' && ACCESS_CODES.has(x.code))) {
      used.add(i.index);
      drafts.push({
        area: 'homepage', code: i.code, basis: 'single-page', findings: [i],
        problem: `Auditi u bllokua: faqja hyrëse ktheu HTTP ${blocked.status} për tool-in`,
        action: `Diagnozë e qasjes, jo rregullim i faqes. Hape faqen në browser: nëse hapet, bllokimi ka gjasa të jetë për këtë klient (IP, VPN, mbrojtje nga bot-ët/WAF). Mos i çaktivizo mbrojtjet; nis një audit të ri kur faqja hyrëse i përgjigjet tool-it me HTTP 200 dhe përdor atë raport për detyrat.`,
        why: `Kodi HTTP ${blocked.status} u mat drejtpërdrejt (${blocked.source}). Kontrollet e header-ave dhe të SEO-s në këtë raport u bënë mbi përgjigjen e bllokimit, jo mbi faqen reale.`,
        templateLabel: '', templateKeyStored: false, cautions: [],
        historicalSeverity: r.access === undefined,
      });
    }
  }

  // 1) Sinjalet e linkeve me të njëjtin emër në faqe të ndryshme: "mund të jenë të lidhura".
  const byName = new Map<string, IssueView[]>();
  for (const i of issues.filter((x) => x.section === 'quality' && x.code === 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT')) {
    const name = linkNameOf(i);
    if (name) byName.set(name, [...(byName.get(name) ?? []), i]);
  }
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    list.forEach((i) => used.add(i.index));
    drafts.push({
      area: 'quality', code: list[0]!.code, basis: 'possibly-related', findings: list,
      problem: `Linke me emrin "${name}" brenda kartave me titull, në ${uniq(list.flatMap((i) => i.pages)).length} faqe: të qarta brenda kartës, të paqarta kur lexohen veçmas (p.sh. në listën e linkeve të një lexuesi ekrani)`,
      action: `Shqyrto komponentin e kartave: jepi çdo linku "${name}" një emër që përfshin titullin e kartës (p.sh. tekst i fshehur vizualisht ose aria-label), ose bëje titullin vetë link. Verifiko me lexues ekrani.`,
      why: `Të njëjtin kod dhe saktësisht të njëjtin emër linku ("${name}") brenda kartave me titull në ${list.length} faqe. Kjo sugjeron të njëjtin komponent kartash, por raporti s'e identifikon komponentin — mund të jenë të lidhura, verifiko.`,
      templateLabel: '', templateKeyStored: false,
      cautions: [],
    });
  }

  // 2) Çdo gjetje tjetër: një detyrë.
  for (const i of issues) {
    if (used.has(i.index)) continue;
    const pages = uniq(i.pages);
    let basis: TaskBasis;
    let why: string;
    if (i.scope === 'template' && pages.length >= 2) {
      basis = 'template';
      why = `Motori i grupoi këto ${pages.length} faqe sepse kanë të njëjtat klasa të body-t (pa numrat e faqes): strukturë e ngjashme. Kjo s'provon të njëjtin komponent ose një rregullim të vetëm; faqet dhe provat mbeten individuale.${i.templateKey ? '' : " Raporti s'ruan çelësin e plotë të template-it (vetëm një emër të shkurtuar), ndaj template-i s'krahasohet me gjetjet e tjera."}`;
    } else if (LINKED_PAGE_CODES.has(i.code) && pages.length >= 2) {
      basis = 'linked-pages';
      why = `Vetë gjetja i lidh këto ${pages.length} faqe (p.sh. vlerë identike ose përmbajtje e ngjashme). S'ka provë që shkaku është template-i.`;
    } else if (i.scope === 'site') {
      basis = 'site-wide';
      why = 'Gjetje e nivelit të sitit/serverit: një ndryshim konfigurimi (header, sitemap, ridrejtime) mbulon të gjitha URL-të e listuara.';
    } else if (pages.length >= 2) {
      basis = 'separate-pages';
      why = `I njëjti problem në ${pages.length} faqe pa template të përbashkët të identifikuar: shkaku mund të jetë i ndryshëm për secilën.`;
    } else {
      basis = 'single-page';
      why = 'Një gjetje në një faqe.';
    }
    const cautions: string[] = [];
    if (i.section === 'homepage' && LH_MODULES.has(i.module)) cautions.push('Matje e vetme Lighthouse: konfirmoje me disa ekzekutime para dhe pas ndryshimit.');
    if (/iframe/i.test(i.message) || i.evidence.some((e) => /iframe/i.test(e.detected))) cautions.push("Përmbajtja kryesore duket në iframe dhe s'u kontrollua.");
    drafts.push({
      area: i.section, code: i.code, basis, findings: [i],
      // Titulli pa emrin teknik të template-it (ai mbetet te detajet).
      problem: (i.message || i.code).replace(/ — i njëjti template \([^)]*\)$/, '') + (basis === 'template' ? ', me strukturë të ngjashme faqeje' : ''),
      action: actionFor(i.code, basis, i, pages.length),
      why, cautions,
      templateLabel: basis === 'template' ? templateLabelOf(i) : '',
      templateKeyStored: basis === 'template' && !!i.templateKey,
    });
  }

  // Plotësimi: faqet unike, provat, rëndësia, confidence, verifikimi.
  const tasks: Task[] = drafts.map((d) => {
    const pages = uniq(d.findings.flatMap((f) => f.pages));
    const conf = d.findings.map((f) => f.confidence).filter((c): c is number => c !== null);
    const severity = SEVERITIES[Math.min(...d.findings.map((f) => SEVERITIES.indexOf(f.severity)))]!;
    const signal = d.area === 'quality';
    const cautions = [...d.cautions];
    let action = d.action;
    // Brenda të njëjtit template: kur provat emërtojnë elemente të ndryshme, shkaku s'është domosdoshmërisht i njëjtë.
    if (d.basis === 'template') {
      const ev = pageEvidence(d.findings, pages);
      const counts = new Map<string, number>();
      for (const e of ev) for (const el of new Set(e.items.map((x) => elementOf(x.detected)).filter(Boolean))) counts.set(el, (counts.get(el) ?? 0) + 1);
      action = templateAction(d.code, d.findings[0]!.fix, ev);
      if (counts.size > 1) {
        const list = [...counts].sort((x, y) => y[1] - x[1]);
        const withEv = ev.filter((e) => e.items.length).length;
        cautions.push(`Provat emërtojnë elemente të ndryshme: ${list.slice(0, 5).map(([el, c]) => `"${el}" (${c} faqe)`).join(', ')}${list.length > 5 ? ' …' : ''}${withEv < pages.length ? ` — vetëm ${withEv} nga ${pages.length} faqe kanë provë në raport` : ''}. S'ka një shkak të vetëm të provuar: kontrollo faqet veçmas.`);
      }
    }
    if (signal) cautions.unshift("Sinjal për shqyrtim njerëzor, jashtë Health Score; s'është shkelje e konfirmuar e WCAG dhe s'vlerëson autorësinë e përmbajtjes.");
    return {
      ...d,
      id: `detyra-${d.findings.map((f) => f.index).sort((a, b) => a - b).join('-')}`,
      pages,
      pagesInChecked: pages.filter((p) => checked.has(p)).length,
      evidence: pageEvidence(d.findings, pages),
      related: [],
      rankWhy: '',
      cautions,
      action,
      severity,
      confidence: { min: conf.length ? Math.min(...conf) : null, max: conf.length ? Math.max(...conf) : null },
      needsManualReview: signal || d.findings.some((f) => f.needsManualReview) || d.basis === 'possibly-related',
      priority: Math.max(...d.findings.map((f) => f.priority)),
    };
  });

  // Lidhje të mundshme, pa bashkim.
  const norm = (s: string) => s.trim().toLowerCase();
  // Vetëm prova që emërtojnë një element konkret (tekst në thonjëza, p.sh. H2 → H4 ("Explore")); prova e mungesës
  // ("Nuk u gjet <meta …>") është e njëjtë kudo dhe s'tregon shkak të përbashkët.
  const evidenceSet = (t: Task) => new Set(t.evidence.flatMap((p) => p.items.map((x) => norm(x.detected)).filter((d) => /"[^"]+"/.test(d.replace(/<[^>]*>/g, '')))));
  for (const t of tasks) {
    for (const o of tasks) {
      if (o === t) continue;
      if (o.code === t.code && t.code === 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT') {
        const name = linkNameOf(o.findings[0]!);
        t.related.push({ id: o.id, why: `I njëjti sinjal me emër tjetër linku${name ? ` ("${name}")` : ''} në ${o.pages.length} faqe — mund të jetë i njëjti komponent (p.sh. përkthimi); s'u bashkuan sepse emri ndryshon.` });
      } else if (o.code === t.code) {
        const shared = [...evidenceSet(t)].filter((x) => evidenceSet(o).has(x));
        // Shfaqet me shkronjat origjinale të provës
        const shown = shared.length ? t.evidence.flatMap((p) => p.items).find((x) => norm(x.detected) === shared[0])!.detected : '';
        const why = shared.length
          ? `E njëjta gjetje me të njëjtin element në provë (${shown.slice(0, 80)}) në ${o.pages.length} faqe të tjera${o.basis === 'template' ? ' me template tjetër' : ''} — mund të jenë të lidhura (p.sh. një seksion i përbashkët); verifiko.`
          : `E njëjta gjetje në ${o.pages.length} faqe të tjera${o.basis === 'template' || t.basis === 'template' ? ' me template tjetër' : ''}; s'u bashkuan sepse s'ka provë për të njëjtin shkak.`;
        t.related.push({ id: o.id, why });
      } else if (t.pages.length >= 2 && t.pages.length === o.pages.length && t.pages.every((p) => o.pages.includes(p))) {
        t.related.push({ id: o.id, why: `Të njëjtat ${t.pages.length} faqe kanë edhe gjetjen ${o.code}; mund të rregullohen bashkë.` });
      }
    }
  }

  // Renditja e shpjegueshme.
  tasks.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || Number(a.needsManualReview) - Number(b.needsManualReview) || b.pages.length - a.pages.length || b.priority - a.priority);
  for (const t of tasks) t.rankWhy = `rëndësia ${t.severity} · ${t.needsManualReview ? 'kërkon verifikim' : 'e konfirmuar nga motori'} · ${t.pages.length} faqe · prioriteti i motorit ${t.priority}`;

  const taskOfFinding = new Map<number, string>();
  for (const t of tasks) for (const f of t.findings) taskOfFinding.set(f.index, t.id);
  const ls = obj(obj(r.lighthouse).series);
  const lighthouseSeries = obj(r.lighthouse).series ? { planned: num(ls.planned) ?? 0, valid: num(ls.valid) ?? 0, representativeRun: num(ls.representativeRun) } : null;
  return { tasks, coverage, taskOfFinding, blocked, measuredOnBlock, lighthouseSeries };
}
