import type { GenericLink } from '../parse/page.js';
import { NOT_AUTHORSHIP, signal, type QualitySignal } from './signals.js';

/** Hyrja për analizën e tekstit: e njëjtë për faqet e crawl-it dhe për skedarët HTML. */
export interface TextPage {
  /** URL ose path relativ i skedarit. */
  id: string;
  lang?: string;
  title?: string;
  h1s: string[];
  mainText: string;
  wordCount: number;
  contentBlocks: { tag: string; text: string }[];
  genericLinks: GenericLink[];
  /** CTA-të e faqes (nga sinjalet e biznesit): për përsëritje brenda faqes; context = produkti/plani/karta. */
  ctas: { text: string; region: 'header' | 'footer' | 'main'; href?: string; context?: string }[];
  iframes: string[];
  noindex: boolean;
  templateKey?: string;
  /** Burimi HTML (vetëm auditi i skedarëve): për rreshtin e provës. */
  source?: string;
}

export interface TextAnalysis {
  signals: QualitySignal[];
  observations: string[];
}

/** Blloku duket shabllon kur shfaqet në kaq pjesë të faqeve të së njëjtës gjuhë. */
export const TEMPLATE_SHARE = 0.6;
const MIN_BLOCK_WORDS = 12;
const MIN_REPEAT_PAGES = 3;
const MAX_REPEAT_SIGNALS = 8;

/** Fraza marketingu të përgjithshme (EN/SQ). Më vete s'janë problem; vetëm e dendur + pa detaje. */
/**
 * Kufi fjale Unicode: \\b i JavaScript-it njeh vetëm ASCII, ndaj "tonë" ose "çmime" s'do të kapeshin.
 */
const phrase = (src: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'iu');
const GENERIC_PHRASES: RegExp[] = [
  phrase("welcome to our (website|site)"),
  phrase("we are passionate about"),
  phrase("high[- ]quality"),
  phrase("best[- ]in[- ]class"),
  phrase("unforgettable experience"),
  phrase("look no further"),
  phrase("in today'?s fast[- ]paced world"),
  phrase("elevate your"),
  phrase("seamless(ly)?"),
  phrase("cutting[- ]edge"),
  phrase("state[- ]of[- ]the[- ]art"),
  phrase("one[- ]stop"),
  phrase("we pride ourselves"),
  phrase("tailored to your needs"),
  phrase("next level"),
  phrase("unlock (the|your) (full )?potential"),
  phrase("embark on a journey"),
  phrase("hidden gem"),
  phrase("nestled in"),
  phrase("a testament to"),
  phrase("rich tapestry"),
  phrase("delve into"),
  phrase("world[- ]class"),
  phrase("exceptional (service|experience|quality)"),
  phrase("second to none"),
  phrase("whether you'?re"),
  phrase("game[- ]changer"),
  phrase("mirë se vini në faqen tonë"),
  phrase("cilësi(në)? e lartë"),
  phrase("përvojë (e|të) paharrueshme"),
  phrase("shërbim(e)? cilësor(e)?"),
  phrase("me pasion"),
  phrase("çmime konkurruese"),
  phrase("zgjidhja ideale"),
  phrase("ekipi (ynë )?profesional"),
  phrase("më të mirët në treg"),
  phrase("përvojë unike"),
  phrase("gjithçka që ju nevojitet"),
];
/** Sinjale detajesh konkrete: numra, çmime, orare, data. */
const SPECIFIC = /(\b\d+([.,:]\d+)?\b|€|\$|£|\blek(ë|u)?\b|\bALL\b|\bEUR\b)/g;
const STOP = new Set(['dhe', 'për', 'nga', 'në', 'me', 'një', 'të', 'the', 'and', 'for', 'with', 'your', 'our', 'from', 'this', 'that', 'home', 'page', 'faqja', 'kreu']);

const normWord = (w: string) => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const stem = (w: string) => normWord(w).slice(0, 5);
const words = (t: string) => t.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w));
const langOf = (p: TextPage) => (p.lang ?? '').toLowerCase().slice(0, 2) || 'unknown';
const quote = (t: string, n = 120) => `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`;

/** Rreshti i një teksti në burimin HTML (kërkim i fillimit të tij); undefined kur s'gjendet njëherë në mënyrë të sigurt. */
export function lineInSource(source: string | undefined, text: string): number | undefined {
  if (!source) return undefined;
  const probe = text.slice(0, 40);
  const i = source.indexOf(probe);
  if (i < 0) return undefined;
  let line = 1;
  for (let k = 0; k < i; k++) if (source.charCodeAt(k) === 10) line++;
  return line;
}

/**
 * Emrat e markës në tituj: segmenti (pas "|", "—", "-", "·", ":") që përsëritet në ≥ 50% të titujve.
 * Hiqet para krahasimit titull ↔ përmbajtje, që "| Emri i sitit" të mos numërohet si fjalë kyçe.
 */
function brandSegments(pages: TextPage[]): Set<string> {
  const count = new Map<string, number>();
  for (const p of pages) for (const s of new Set(splitTitle(p.title ?? ''))) count.set(s, (count.get(s) ?? 0) + 1);
  const min = Math.max(2, pages.length * 0.5);
  return new Set([...count].filter(([, n]) => n >= min).map(([s]) => s));
}
const splitTitle = (t: string) => t.split(/\s[|–—\-·:]\s|\s[|·]|[|·]\s/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export function analyzeText(pages: TextPage[]): TextAnalysis {
  const signals: QualitySignal[] = [];
  const observations: string[] = [];
  const eligible = pages.filter((p) => !p.noindex);

  // --- 1. Blloqe identike mes faqeve të së njëjtës gjuhë (përkthimet s'krahasohen me njëra-tjetrën) ---
  const byLang = new Map<string, TextPage[]>();
  for (const p of eligible) byLang.set(langOf(p), [...(byLang.get(langOf(p)) ?? []), p]);
  let templateBlocks = 0;
  const repeats: { text: string; pages: TextPage[]; lang: string }[] = [];
  for (const [lang, group] of byLang) {
    if (group.length < MIN_REPEAT_PAGES) continue;
    const where = new Map<string, TextPage[]>();
    for (const p of group) {
      for (const b of p.contentBlocks) {
        if (b.tag.startsWith('h') || words(b.text).length < MIN_BLOCK_WORDS) continue;
        where.set(b.text, [...(where.get(b.text) ?? []), p]);
      }
    }
    for (const [text, ps] of where) {
      if (ps.length < MIN_REPEAT_PAGES) continue;
      // Në shumicën e faqeve = pjesë e shabllonit (seksion i përbashkët), s'penalizohet
      if (group.length >= 4 && ps.length / group.length >= TEMPLATE_SHARE) templateBlocks++;
      else repeats.push({ text, pages: ps, lang });
    }
  }
  repeats.sort((a, b) => b.pages.length * words(b.text).length - a.pages.length * words(a.text).length);
  for (const r of repeats.slice(0, MAX_REPEAT_SIGNALS)) {
    const first = r.pages[0]!;
    signals.push(signal({
      code: 'REPEATED_CONTENT_BLOCK', kind: 'content', severity: 'low', confidence: 0.5,
      message: `I njëjti paragraf (${words(r.text).length} fjalë) në ${r.pages.length} faqe — kërkon verifikim`,
      target: first.id, line: lineInSource(first.source, r.text), related: r.pages.slice(1).map((p) => p.id),
      evidence: [quote(r.text), `gjuha: ${r.lang}; faqet: ${r.pages.slice(0, 4).map((p) => p.id).join(', ')}${r.pages.length > 4 ? ' …' : ''}`, 'jashtë header/nav/footer; në < 60% të faqeve (jo shabllon i përbashkët)'],
      whyItMatters: `Teksti i njëjtë në shumë faqe të ndryshme i bën ato të duken të përgjithshme dhe u heq vlerë unike për vizitorin. ${NOT_AUTHORSHIP}`,
      suggestion: 'Përshtate paragrafin me detaje të faqes (çfarë e dallon këtë shërbim/produkt), ose mbaje vetëm në një faqe dhe lidhu atje.',
    }));
  }
  if (repeats.length > MAX_REPEAT_SIGNALS) observations.push(`${repeats.length - MAX_REPEAT_SIGNALS} blloqe të tjera të përsëritura s'u listuan veç.`);
  observations.push(`${templateBlocks} blloqe teksti shfaqen në ≥ ${TEMPLATE_SHARE * 100}% të faqeve të së njëjtës gjuhë — trajtohen si shabllon, s'penalizohen.`);
  const langs = [...byLang.keys()].filter((l) => l !== 'unknown');
  if (langs.length > 1) observations.push(`Gjuhë: ${langs.join(', ')} — versionet e përkthyera s'krahasohen me njëra-tjetrën.`);

  // --- 2. Fraza të përgjithshme pa detaje konkrete ---
  for (const p of eligible) {
    if (p.wordCount < 80 || p.iframes.length) continue;
    const found = GENERIC_PHRASES.map((re) => p.mainText.match(re)?.[0]).filter((x): x is string => !!x);
    const specifics = (p.mainText.match(SPECIFIC) ?? []).length;
    const perHundred = (specifics / p.wordCount) * 100;
    // Kërkon njëkohësisht: ≥ 3 fraza të ndryshme, dendësi të lartë dhe pak detaje konkrete.
    if (found.length >= 3 && found.length / p.wordCount >= 1 / 150 && perHundred < 1.5) {
      signals.push(signal({
        code: 'GENERIC_COPY', kind: 'content', severity: 'low', confidence: 0.4,
        message: `Tekst me fraza të përgjithshme dhe pak detaje konkrete (${found.length} fraza, ${specifics} detaje numerike në ${p.wordCount} fjalë) — kërkon verifikim`,
        target: p.id, line: lineInSource(p.source, found[0]!),
        evidence: [`fraza: ${found.slice(0, 6).map((f) => `"${f}"`).join(', ')}`, `detaje konkrete (numra, çmime, orare): ${perHundred.toFixed(1)} për 100 fjalë`],
        whyItMatters: `Pretendimet e përgjithshme ("cilësi e lartë", "përvojë e paharrueshme") pa fakte e bëjnë faqen të ngjajë me shumë të tjera dhe ulin besimin. ${NOT_AUTHORSHIP}`,
        suggestion: 'Zëvendëso pretendimet me fakte: emra, vende, çmime, orare, numra, shembuj realë.',
      }));
    }
  }

  // --- 3. Titulli që s'përputhet me përmbajtjen ---
  const brands = brandSegments(eligible);
  for (const p of eligible) {
    if (!p.title || p.wordCount < 80 || p.iframes.length) continue;
    // Pa markë të njohur (p.sh. një faqe e vetme): vetëm segmenti i parë, tema e faqes.
    const all = splitTitle(p.title);
    const segs = brands.size ? all.filter((s) => !brands.has(s)) : all.slice(0, 1);
    const keywords = [...new Set(segs.flatMap((s) => s.split(/\s+/)).map(normWord).filter((w) => w.length >= 4 && !STOP.has(w)))];
    if (keywords.length < 2) continue;
    const content = new Set(words(`${p.h1s.join(' ')} ${p.mainText}`).map(stem));
    const matched = keywords.filter((k) => content.has(k.slice(0, 5)));
    if (matched.length === 0) {
      signals.push(signal({
        code: 'TITLE_CONTENT_MISMATCH', kind: 'content', severity: 'low', confidence: 0.5,
        message: 'Asnjë fjalë kyçe e titullit s\'del në H1 ose në përmbajtjen kryesore — kërkon verifikim',
        target: p.id, line: lineInSource(p.source, p.title),
        evidence: [`titulli: ${quote(p.title, 90)}`, `fjalë kyçe (pa emrin e markës): ${keywords.slice(0, 6).join(', ')}`, `H1: ${p.h1s[0] ? quote(p.h1s[0], 60) : 'mungon'}`],
        whyItMatters: 'Kur titulli premton diçka që faqja s\'e trajton, vizitori nga kërkimi zhgënjehet dhe largohet.',
        suggestion: 'Përputh titullin me temën reale të faqes, ose shto përmbajtjen që titulli premton.',
      }));
    }
  }

  // --- 4. Linke/CTA të përsëritura (vetëm në përmbajtje, jo në menu/footer) ---
  // Konteksti (titulli i kartës, produkti, plani, koka e kolonës) i bën veprimet të dallueshme: pa të, është sinjal;
  // me të, "Details" mbetet vetëm vërejtje aksesueshmërie për emrin e linkut kur lexohet veçmas.
  let ctaWithEntities = 0;
  for (const p of eligible) {
    const main = p.genericLinks.filter((l) => l.region === 'main');
    const by = new Map<string, GenericLink[]>();
    for (const l of main) by.set(l.name.toLowerCase(), [...(by.get(l.name.toLowerCase()) ?? []), l]);
    // Vetëm kur i njëjti emër çon në ≥ 3 destinacione; 8× "Read more" → e njëjta faqe s'e ngatërron vizitorin.
    const groups = [...by.values()]
      .map((links) => ({ links, dests: [...new Set(links.map((l) => l.href ?? '(pa href)'))] }))
      .filter((g) => g.dests.length >= 3)
      .sort((a, b) => b.links.length - a.links.length);
    for (const g of groups.slice(0, 2)) {
      const first = g.links[0]!;
      const contexts = g.links.map((l) => l.context);
      const distinct = new Set(contexts.filter(Boolean).map((c) => c!.toLowerCase())).size;
      const withContext = contexts.every(Boolean) && distinct >= g.dests.length;
      const dests = `destinacione: ${g.dests.slice(0, 4).join(', ')}${g.dests.length > 4 ? ' …' : ''}`;
      if (withContext) {
        signals.push(signal({
          code: 'LINK_NAME_AMBIGUOUS_OUT_OF_CONTEXT', kind: 'accessibility', severity: 'low', confidence: 0.6,
          message: `${g.links.length} linke me emrin e aksesueshëm "${first.name}" drejt ${g.dests.length} faqeve — të qarta brenda kartës, të paqarta kur lexohen veçmas`,
          target: p.id,
          evidence: [
            `emri i aksesueshëm: "${first.name}" (burimi: ${NAME_SOURCE[first.nameSource]}; pa aria-label/aria-labelledby përshkrues)`,
            `konteksti pranë: ${contexts.slice(0, 3).map((c) => quote(c!, 50)).join(', ')}`,
            dests,
          ],
          whyItMatters: `Konteksti i kartës (titulli, përshkrimi) zakonisht e bën linkun të kuptueshëm për vizitorin që e sheh. Kur lexuesit e ekranit i listojnë linket veçmas, "${first.name}" mund të përsëritet pa u dalluar. Emri i aksesueshëm llogaritet me një përafrim të thjeshtuar: kjo s'është vlerësim përputhshmërie me WCAG — verifiko me një lexues ekrani. Vërejtje aksesueshmërie, jo sinjal "AI slop" dhe jo provë shablloni.`,
          suggestion: `Pamja mund të mbetet e njëjtë. Shto emrin e plotë për lexuesit e ekranit, p.sh. aria-label="${first.name.replace(/[\s.…→›»>]+$/u, '')}: ${contexts[0]}", ose tekst të fshehur vizualisht brenda linkut.`,
        }));
      } else {
        signals.push(signal({
          code: 'GENERIC_LINK_TEXT_REPEATED', kind: 'content', severity: 'low', confidence: 0.6,
          message: `${g.links.length}× "${first.text}" në përmbajtje, drejt ${g.dests.length} destinacioneve të ndryshme, pa titull ose tekst pranë që i dallon`,
          target: p.id,
          evidence: [
            `emri i aksesueshëm: "${first.name}" (burimi: ${NAME_SOURCE[first.nameSource]})`,
            `konteksti pranë: ${contexts.filter(Boolean).length}/${g.links.length} linke kanë titull/tekst pranë; ${distinct} të dallueshëm`,
            dests,
          ],
          whyItMatters: 'Pa titull ose përshkrim pranë, as vizitori që sheh faqen, as ai që përdor lexues ekrani s\'e di ku çon secili link me të njëjtin tekst.',
          suggestion: `Përdor tekst që tregon destinacionin, p.sh. "${linkLabel(g.dests[0]!)}" në vend të "${first.text}", ose vendos titullin e secilës pjesë pranë linkut.`,
        }));
      }
    }

    // CTA: përjashtohen ato të lidhura me entitete të dallueshme (produkt, plan, kartë me titull) ose me destinacione
    // të ndryshme; mbetet vetëm përsëritja e të njëjtit veprim drejt të njëjtës faqe pa kontekst.
    const ctaBy = new Map<string, TextPage['ctas']>();
    for (const c of p.ctas.filter((c) => c.region === 'main')) ctaBy.set(c.text.toLowerCase(), [...(ctaBy.get(c.text.toLowerCase()) ?? []), c]);
    for (const group of ctaBy.values()) {
      if (group.length < 4) continue;
      const bare = group.filter((c) => !c.context);
      const hrefs = new Set(bare.map((c) => (c.href ?? '').split('#')[0]));
      if (bare.length < 4 || hrefs.size > 1) { ctaWithEntities++; continue; }
      const text = group[0]!.text;
      const href = [...hrefs][0] || '(pa href)';
      signals.push(signal({
        code: 'CTA_REPEATED_ON_PAGE', kind: 'content', severity: 'low', confidence: 0.4,
        message: `"${text}" ×${bare.length} në përmbajtje, i njëjti veprim drejt së njëjtës faqe pa kontekst dallues — kërkon verifikim`,
        target: p.id,
        evidence: [`"${text}" ×${bare.length} (pa header/footer)`, `destinacioni: ${href}`, 'asnjë titull produkti/plani/karte pranë që i dallon'],
        whyItMatters: 'Kur i njëjti CTA përsëritet drejt së njëjtës faqe pa kontekst, çdo përsëritje s\'i jep vizitorit informacion të ri. Në faqe të gjata përsëritja mund të jetë e qëllimshme.',
        suggestion: 'Verifiko nëse përsëritja është e qëllimshme. Nëse jo, përshtat tekstin me seksionin ku ndodhet (p.sh. "Rezervo dhomën me ballkon").',
      }));
    }
  }
  if (ctaWithEntities) observations.push(`${ctaWithEntities} grupe CTA të përsëritura s'u raportuan: janë të lidhura me produkte/plane/karta ose destinacione të ndryshme.`);
  return { signals: mergeDuplicatePages(signals), observations };
}

const NAME_SOURCE: Record<GenericLink['nameSource'], string> = {
  'aria-labelledby': 'aria-labelledby', 'aria-label': 'aria-label', text: 'teksti i dukshëm', 'img-alt': 'alt-i i imazhit', title: 'title', value: 'value', none: 'mungon',
};

/** Destinacioni → etiketë shembull: /journal/food/maze-fli-lamb/ → "Maze fli lamb". */
function linkLabel(href: string): string {
  const seg = href.split(/[?#]/)[0]!.split('/').filter(Boolean).pop() ?? '';
  let s = seg.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim();
  try { s = decodeURIComponent(s); } catch { /* lëre siç është */ }
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Shiko detajet e …';
}

/**
 * I njëjti sinjal me prova identike në dy URL (p.sh. "/" dhe "/homepage", e njëjta faqe) → një sinjal
 * me faqen e dytë te related, që të mos numërohet dy herë.
 */
function mergeDuplicatePages(signals: QualitySignal[]): QualitySignal[] {
  const out: QualitySignal[] = [];
  const byKey = new Map<string, QualitySignal>();
  for (const s of signals) {
    if (s.related.length) { out.push(s); continue; }
    const key = `${s.code}\u0000${s.message}\u0000${s.evidence.join('\u0000')}`;
    const first = byKey.get(key);
    if (first) first.related.push(s.target);
    else { byKey.set(key, s); out.push(s); }
  }
  return out;
}
