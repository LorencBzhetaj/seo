import path from 'node:path';
import * as cheerio from 'cheerio';
import type { Severity } from '../core/schemas.js';
import { jaccard, removeBoilerplate, shingles, textHash, tokenize } from '../intelligence/similarity.js';
import { parseRobots } from '../parse/robots.js';
import { parseSitemap } from '../parse/sitemap.js';
import type { ProjectInfo, SourceCheckId } from './project.js';
import { resolveRef, type FileIndex } from './refs.js';
import type { FileEntry, SourceCategory, SourceFinding } from './types.js';
import { lineAt } from './walk.js';

export interface CheckInput {
  kind: 'folder' | 'repo';
  files: FileEntry[];
  index: FileIndex;
  project: ProjectInfo;
  /** Përmbajtja e skedarëve teksti që u lexuan (brenda kufirit). */
  texts: Map<string, string>;
}

export interface CheckOutput {
  findings: SourceFinding[];
  observations: Partial<Record<SourceCheckId, string[]>>;
}

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const MIN_WORDS_FOR_SIMILARITY = 50;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp', '.tif', '.tiff', '.ico']);
const RASTER_LEGACY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff']);

type Loc = { startLine?: number; attrs?: Record<string, { startLine: number }> };
type El = { sourceCodeLocation?: Loc; tagName?: string };

export function finding(
  code: string, category: SourceCategory, severity: Severity, confidence: number, file: string, line: number | undefined,
  message: string, evidence: string, suggestion: string, related?: SourceFinding['related'],
): SourceFinding {
  return { code, category, severity, confidence, needsManualReview: confidence < 0.7, message, file, ...(line ? { line } : {}), evidence, suggestion, ...(related?.length ? { related } : {}) };
}

/** Rreshti i elementit ose i atributit (për tag-e shumërreshtëshe), nga parse5. */
function lineOf(el: unknown, attr?: string): number | undefined {
  const loc = (el as El).sourceCodeLocation;
  return (attr && loc?.attrs?.[attr]?.startLine) || loc?.startLine || undefined;
}

function startTag($: cheerio.CheerioAPI, el: unknown): string {
  const html = $.html(el as never) ?? '';
  const end = html.indexOf('>');
  const tag = end > 0 ? html.slice(0, end + 1) : html;
  return tag.length > 160 ? `${tag.slice(0, 159)}…` : tag;
}

const isHtml = (f: FileEntry) => f.ext === '.html' || f.ext === '.htm';

/** Kontrollet mbi HTML: SEO on-page, linke/asete lokale, dublikime. Rreshtat nga parse5. */
export function htmlChecks(input: CheckInput, enabled: { seo: boolean; links: boolean; duplicates: boolean }): CheckOutput {
  const findings: SourceFinding[] = [];
  const obs: CheckOutput['observations'] = {};
  const htmlFiles = input.files.filter((f) => isHtml(f) && input.texts.has(f.rel));
  const titles = new Map<string, { file: string; line?: number }[]>();
  const descs = new Map<string, { file: string; line?: number }[]>();
  const bodies = new Map<string, { words: number; text: string }>();
  let refsChecked = 0;
  let fallbacks = 0;
  let external = 0;

  for (const f of htmlFiles) {
    const text = input.texts.get(f.rel)!;
    const $ = cheerio.load(text, { sourceCodeLocationInfo: true } as never);
    const htmlEl = $('html')[0];
    const head = $('head')[0];

    if (enabled.seo) {
      const title = $('title').filter((_, el) => $(el).parents('svg').length === 0).first();
      const titleText = title.text().replace(/\s+/g, ' ').trim();
      if (!title.length || !titleText) {
        findings.push(finding('MISSING_TITLE', 'seo', 'high', 0.95, f.rel, lineOf(title[0] ?? head ?? htmlEl),
          'Faqja s\'ka <title>', title.length ? '<title></title> bosh' : 'asnjë <title> në <head>', 'Shto <title> unik dhe përshkrues (≈ 10–60 karaktere).'));
      } else {
        titles.set(titleText, [...(titles.get(titleText) ?? []), { file: f.rel, line: lineOf(title[0]) }]);
        if (titleText.length < TITLE_MIN || titleText.length > TITLE_MAX) {
          findings.push(finding('TITLE_LENGTH', 'seo', 'low', 0.8, f.rel, lineOf(title[0]),
            `Titull ${titleText.length} karaktere (jashtë ${TITLE_MIN}–${TITLE_MAX})`, `<title>${titleText.slice(0, 90)}</title>`, `Përshtate rreth ${TITLE_MIN}–${TITLE_MAX} karaktere.`));
        }
      }
      const desc = $('meta[name="description" i]').first();
      const descText = (desc.attr('content') ?? '').trim();
      if (!descText) {
        findings.push(finding('MISSING_META_DESCRIPTION', 'seo', 'medium', 0.9, f.rel, lineOf(desc[0] ?? head ?? htmlEl),
          'Mungon meta description', desc.length ? '<meta name="description" content=""> bosh' : 'asnjë <meta name="description">', 'Shto <meta name="description" content="…"> (≈ 70–160 karaktere).'));
      } else descs.set(descText, [...(descs.get(descText) ?? []), { file: f.rel, line: lineOf(desc[0], 'content') }]);
      const h1s = $('h1');
      if (h1s.length === 0) {
        findings.push(finding('MISSING_H1', 'seo', 'medium', 0.85, f.rel, undefined, 'Faqja s\'ka <h1>', 'asnjë <h1> në HTML', 'Shto një <h1> me temën e faqes.'));
      } else if (h1s.length > 1) {
        findings.push(finding('MULTIPLE_H1', 'seo', 'low', 0.6, f.rel, lineOf(h1s[1]), `${h1s.length} elemente <h1>`, h1s.toArray().slice(0, 3).map((h) => `rreshti ${lineOf(h) ?? '?'}: "${$(h).text().trim().slice(0, 40)}"`).join('; '), 'Shqyrto një <h1> dhe <h2> për seksionet.'));
      }
      if (htmlEl && !($(htmlEl).attr('lang') ?? '').trim()) {
        findings.push(finding('MISSING_HTML_LANG', 'seo', 'low', 0.9, f.rel, lineOf(htmlEl), '<html> pa atribut lang', startTag($, htmlEl), 'Shto <html lang="sq"> (ose gjuhën e faqes).'));
      }
      if (!$('meta[name="viewport" i]').length) {
        findings.push(finding('MISSING_VIEWPORT', 'seo', 'medium', 0.9, f.rel, lineOf(head ?? htmlEl), 'Mungon <meta name="viewport"> (mobile)', 'asnjë meta viewport', 'Shto <meta name="viewport" content="width=device-width, initial-scale=1">.'));
      }
      $('img').each((_, el) => {
        if ($(el).attr('alt') === undefined) {
          findings.push(finding('IMG_MISSING_ALT', 'images', 'low', 0.9, f.rel, lineOf(el), 'Imazh pa atributin alt', startTag($, el), 'Shto alt përshkrues (ose alt="" për imazhe dekorative).'));
        }
      });
    }

    if (enabled.links) {
      const refs: { el: unknown; attr: string; value: string; kind: 'link' | 'asset' }[] = [];
      $('a[href]').each((_, el) => { refs.push({ el, attr: 'href', value: $(el).attr('href')!, kind: 'link' }); });
      $('link[href]').each((_, el) => {
        const rel = ($(el).attr('rel') ?? '').toLowerCase();
        if (/(stylesheet|icon|preload|manifest|apple-touch-icon)/.test(rel)) refs.push({ el, attr: 'href', value: $(el).attr('href')!, kind: 'asset' });
      });
      $('script[src], img[src], source[src], video[src], audio[src], iframe[src], embed[src]').each((_, el) => { refs.push({ el, attr: 'src', value: $(el).attr('src')!, kind: 'asset' }); });
      $('img[srcset], source[srcset]').each((_, el) => {
        for (const part of ($(el).attr('srcset') ?? '').split(',')) {
          const u = part.trim().split(/\s+/)[0];
          if (u) refs.push({ el, attr: 'srcset', value: u, kind: 'asset' });
        }
      });
      $('video[poster]').each((_, el) => { refs.push({ el, attr: 'poster', value: $(el).attr('poster')!, kind: 'asset' }); });
      for (const r of refs) {
        const res = resolveRef(r.value, f.rel, input.project.webRoot, input.index);
        if (res.status === 'external') external++;
        if (res.status === 'skip' || res.status === 'external') continue;
        refsChecked++;
        const line = lineOf(r.el, r.attr);
        const ev = `${r.attr}="${r.value}" → ${'target' in res ? res.target : ''}`;
        if (res.status === 'ok') {
          if (res.fallback) fallbacks++;
        } else if (res.status === 'missing') {
          findings.push(r.kind === 'link'
            ? finding('BROKEN_LOCAL_LINK', 'links', 'medium', 0.9, f.rel, line, `Link te skedar lokal që s'ekziston: ${r.value}`, ev, 'Korrigjo shtegun ose shto skedarin; kujdes me shkronjat e mëdha/vogla dhe hapësirat (%20).')
            : finding('MISSING_LOCAL_ASSET', 'links', 'high', 0.9, f.rel, line, `Aset lokal që s'ekziston: ${r.value}`, ev, 'Shto skedarin ose korrigjo shtegun (CSS/JS/imazh që mungon prish faqen).'));
        } else if (res.status === 'case-mismatch') {
          findings.push(finding('LOCAL_PATH_CASE_MISMATCH', 'links', 'medium', 0.85, f.rel, line, `Shtegu ndryshon vetëm në shkronja të mëdha/vogla: ${r.value}`, `${ev}; skedari real: ${res.actual}`, `Përdor saktësisht "${res.actual}": në Windows/macOS punon, në serverë Linux jep 404.`));
        } else if (res.status === 'outside') {
          findings.push(finding('LOCAL_PATH_OUTSIDE_ROOT', 'links', 'medium', 0.8, f.rel, line, `Shtegu del jashtë dosjes së sitit: ${r.value}`, ev, 'Mbaje asetin brenda dosjes që publikohet.'));
        }
      }
    }

    if (enabled.duplicates) {
      const $b = cheerio.load(text);
      $b('script, style, noscript, template, svg, nav, header, footer, aside, form').remove();
      $b('*').each((_, el) => { $b(el).prepend(' ').append(' '); });
      const body = $b('body').text().replace(/\s+/g, ' ').trim();
      bodies.set(f.rel, { words: body ? body.split(' ').length : 0, text: body });
    }
  }

  // --- Dublikime mes skedarëve ---
  if (enabled.seo) {
    for (const [t, where] of titles) {
      if (where.length < 2) continue;
      findings.push(finding('DUPLICATE_TITLE', 'duplicates', 'medium', 0.9, where[0]!.file, where[0]!.line, `${where.length} faqe me të njëjtin <title>`, `"${t.slice(0, 80)}"`, 'Jepi çdo faqeje titull unik.', where.slice(1)));
    }
    for (const [d, where] of descs) {
      if (where.length < 2) continue;
      findings.push(finding('DUPLICATE_META_DESCRIPTION', 'duplicates', 'low', 0.9, where[0]!.file, where[0]!.line, `${where.length} faqe me të njëjtin meta description`, `"${d.slice(0, 80)}"`, 'Shkruaj përshkrim unik për çdo faqe.', where.slice(1)));
    }
  }
  if (enabled.duplicates) {
    const eligible = [...bodies].filter(([, b]) => b.words >= MIN_WORDS_FOR_SIMILARITY);
    const sets = removeBoilerplate(new Map(eligible.map(([k, b]) => [k, shingles(tokenize(b.text))])));
    const hashes = new Map(eligible.map(([k, b]) => [k, textHash(b.text)]));
    const done = new Set<string>();
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i]![0];
        const b = eligible[j]![0];
        if (done.has(b)) continue;
        const identical = hashes.get(a) === hashes.get(b);
        const sim = jaccard(sets.get(a)!, sets.get(b)!);
        if (identical || sim >= 0.9) {
          done.add(b);
          findings.push(identical
            ? finding('DUPLICATE_CONTENT', 'duplicates', 'medium', 0.8, b, undefined, `Përmbajtje identike me ${a}`, `hash i tekstit i njëjtë (${eligible[j]![1].words} fjalë, pa nav/header/footer)`, 'Nëse s\'është e qëllimshme, bashkoji ose përdor canonical te versioni kryesor.', [{ file: a }])
            : finding('SIMILAR_CONTENT', 'duplicates', 'low', 0.6, b, undefined, `Përmbajtje shumë e ngjashme me ${a} — kërkon verifikim`, `Jaccard ${sim.toFixed(2)} (shingle 5-fjalëshe, pa tekstin e përbashkët)`, 'Verifiko nëse faqet duhen dalluar më shumë ose bashkuar.', [{ file: a }]));
        }
      }
    }
    obs.duplicates = [`${eligible.length} faqe me ≥ ${MIN_WORDS_FOR_SIMILARITY} fjalë u krahasuan (${bodies.size - eligible.length} më të shkurtra u përjashtuan)`];
  }
  if (enabled.links) obs['local-links'] = [`${refsChecked} referenca lokale të kontrolluara në ${htmlFiles.length} HTML; ${external} të jashtme (s'kontrollohen)`, ...(fallbacks ? [`${fallbacks} linke pa .html u zgjidhën me fallback (x → x.html ose x/index.html) — varet nga hostingu`] : [])];
  if (enabled.seo) obs['html-seo'] = [`${htmlFiles.length} skedarë HTML të analizuar`];
  return { findings, observations: obs };
}

/** url(...) dhe @import në CSS: asete lokale që mungojnë, me rresht. */
export function cssChecks(input: CheckInput): CheckOutput {
  const findings: SourceFinding[] = [];
  let checked = 0;
  const cssFiles = input.files.filter((f) => f.ext === '.css' && input.texts.has(f.rel));
  for (const f of cssFiles) {
    const text = input.texts.get(f.rel)!;
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g;
    for (const m of text.matchAll(re)) {
      const value = (m[2] ?? m[4] ?? '').trim();
      // Në CSS, shtegu relativ zgjidhet nga vetë skedari CSS
      const res = resolveRef(value, f.rel, input.project.webRoot, input.index);
      if (res.status === 'skip' || res.status === 'external') continue;
      checked++;
      const line = lineAt(text, m.index ?? 0);
      if (res.status === 'missing') findings.push(finding('MISSING_LOCAL_ASSET', 'links', 'high', 0.9, f.rel, line, `Aset në CSS që s'ekziston: ${value}`, `${m[0].slice(0, 120)} → ${res.target}`, 'Shto skedarin ose korrigjo shtegun (relativ ndaj skedarit CSS).'));
      else if (res.status === 'case-mismatch') findings.push(finding('LOCAL_PATH_CASE_MISMATCH', 'links', 'medium', 0.85, f.rel, line, `Shtegu në CSS ndryshon vetëm në shkronja: ${value}`, `${m[0].slice(0, 120)}; skedari real: ${res.actual}`, `Përdor saktësisht "${res.actual}".`));
      else if (res.status === 'outside') findings.push(finding('LOCAL_PATH_OUTSIDE_ROOT', 'links', 'medium', 0.8, f.rel, line, `Shtegu në CSS del jashtë dosjes: ${value}`, m[0].slice(0, 120), 'Mbaje asetin brenda dosjes që publikohet.'));
    }
  }
  return { findings, observations: { 'css-assets': [`${checked} referenca url()/@import në ${cssFiles.length} skedarë CSS`] } };
}

/** Madhësia e imazheve (nga stat, pa i lexuar) dhe imazhet pa referencë kur HTML/CSS u kontrolluan. */
export function imageChecks(input: CheckInput, referencedKnown: boolean): CheckOutput {
  const findings: SourceFinding[] = [];
  const images = input.files.filter((f) => IMAGE_EXT.has(f.ext));
  for (const f of images) {
    const kb = Math.round(f.size / 1024);
    const legacy = RASTER_LEGACY.has(f.ext);
    if (f.size > 1024 * 1024) findings.push(finding('LARGE_IMAGE', 'images', 'medium', 0.9, f.rel, undefined, `Imazh ${kb} KB`, `${kb} KB (${f.ext})`, legacy ? 'Kompreso dhe ruaje në WebP/AVIF, me madhësi sipas shfaqjes.' : 'Zvogëlo dimensionet/cilësinë sipas shfaqjes.'));
    else if (f.size > 300 * 1024) findings.push(finding('LARGE_IMAGE', 'images', 'low', 0.8, f.rel, undefined, `Imazh ${kb} KB`, `${kb} KB (${f.ext})`, legacy ? 'Shqyrto WebP/AVIF dhe dimensione më të vogla.' : 'Shqyrto dimensione më të vogla.'));
  }
  const obs = [`${images.length} imazhe; ${findings.length} mbi 300 KB`];
  if (referencedKnown) {
    const all = [...input.texts.values()].join('\n');
    const orphans = images.filter((f) => !all.includes(path.posix.basename(f.rel)) && !all.includes(encodeURI(path.posix.basename(f.rel))));
    if (orphans.length) obs.push(`${orphans.length} imazhe s'përmenden në asnjë HTML/CSS/JS të lexuar (mund të jenë të tepërta ose të ngarkuara dinamikisht): ${orphans.slice(0, 5).map((f) => f.rel).join(', ')}${orphans.length > 5 ? ' …' : ''}`);
  }
  return { findings, observations: { images: obs } };
}

const HEADER_NAMES = ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy'];

/** robots.txt, sitemap.xml, favicon, 404, manifest dhe konfigurime hostingu — vetëm nga skedarët. */
export function configChecks(input: CheckInput, htmlSupported: boolean): CheckOutput {
  const findings: SourceFinding[] = [];
  const obs: string[] = [];
  const wr = input.project.webRoot;
  const at = (name: string) => (wr ? `${wr}/${name}` : name);

  const robotsRel = at('robots.txt');
  const robots = input.texts.get(robotsRel);
  if (robots !== undefined) {
    const parsed = parseRobots(robots);
    const star = parsed.groups.filter((g) => g.agents.includes('*'));
    const rule = star.flatMap((g) => g.rules).find((r) => !r.allow && r.pattern === '/');
    const reopened = star.some((g) => g.rules.some((r) => r.allow && r.pattern === '/'));
    if (rule && !reopened) {
      findings.push(finding('ROBOTS_BLOCKS_ALL', 'config', 'high', 0.8, robotsRel, rule.line, 'robots.txt ndalon gjithë sitin për të gjithë crawler-at', 'User-agent: * / Disallow: /', 'Nëse s\'është staging i qëllimshëm, hiqe "Disallow: /" para publikimit.'));
    }
    obs.push(`robots.txt: ${robotsRel}${parsed.sitemaps.length ? `, Sitemap: ${parsed.sitemaps.slice(0, 2).join(', ')}` : ''}`);
  } else obs.push(`robots.txt: nuk u gjet në ${wr || 'rrënjë'}`);

  const smRel = at('sitemap.xml');
  const sm = input.texts.get(smRel);
  if (sm !== undefined) {
    const parsed = parseSitemap(sm, 'application/xml');
    if (parsed.kind === 'invalid') {
      findings.push(finding('SITEMAP_INVALID', 'config', 'medium', 0.9, smRel, undefined, 'sitemap.xml s\'është XML i vlefshëm', parsed.error ?? 'i pavlefshëm', 'Rigjeneroje si <urlset> me <loc> absolute.'));
    } else if (htmlSupported && parsed.kind === 'urlset') {
      const missing: { loc: string; line?: number }[] = [];
      for (const e of parsed.entries) {
        let p: string;
        try {
          p = new URL(e.loc).pathname;
        } catch {
          continue;
        }
        const res = resolveRef(p, smRel, wr, input.index);
        if (res.status === 'missing' || res.status === 'case-mismatch') {
          const idx = sm.indexOf(e.loc);
          missing.push({ loc: e.loc, line: idx >= 0 ? lineAt(sm, idx) : undefined });
        }
      }
      if (missing.length) {
        findings.push(finding('SITEMAP_LOC_NOT_IN_FILES', 'config', 'low', 0.6, smRel, missing[0]!.line,
          `${missing.length} URL në sitemap s'kanë skedar përkatës në dosje — kërkon verifikim`, missing.slice(0, 3).map((m) => m.loc).join(', '),
          'Hiq URL-të e vjetra nga sitemap-i ose shto faqet. (Nëse hostingu i gjeneron ndryshe, injoroje.)', missing.slice(1, 10).map((m) => ({ file: smRel, line: m.line }))));
      }
      obs.push(`sitemap.xml: ${parsed.entries.length} URL, ${missing.length} pa skedar lokal`);
    } else obs.push(`sitemap.xml: ${parsed.kind}${htmlSupported ? '' : ' (URL-të s\'krahasohen: HTML gjenerohet në build)'}`);
  } else obs.push('sitemap.xml: nuk u gjet (mund ta gjenerojë build-i/plugin-i)');

  if (htmlSupported) {
    const hasFavicon = input.index.exact.has(at('favicon.ico')) || [...input.texts.entries()].some(([k, t]) => /\.html?$/.test(k) && /<link[^>]+rel=["'][^"']*icon/i.test(t));
    if (!hasFavicon) findings.push(finding('FAVICON_NOT_FOUND', 'config', 'low', 0.7, wr || '.', undefined, 'S\'u gjet favicon (favicon.ico ose <link rel="icon">)', 'asnjë favicon', 'Shto favicon.ico në rrënjë ose <link rel="icon" href="…">.'));
    obs.push(`404.html: ${input.index.exact.has(at('404.html')) ? 'po' : 'nuk u gjet (disa hoste e përdorin automatikisht)'}`);
  }

  for (const f of input.files.filter((x) => x.ext === '.webmanifest' || /(^|\/)manifest\.json$/.test(x.rel) || x.rel === 'package.json')) {
    const t = input.texts.get(f.rel);
    if (t === undefined) continue;
    try {
      JSON.parse(t);
    } catch (err) {
      const pos = /position (\d+)/.exec((err as Error).message);
      findings.push(finding('INVALID_JSON', 'config', 'medium', 0.95, f.rel, pos ? lineAt(t, Number(pos[1])) : undefined, `${path.posix.basename(f.rel)} s'është JSON i vlefshëm`, (err as Error).message.slice(0, 120), 'Korrigjo sintaksën e JSON-it.'));
    }
  }

  const hostCfg = input.files.filter((f) => /(^|\/)(_headers|netlify\.toml|vercel\.json|\.htaccess|firebase\.json|staticwebapp\.config\.json)$/.test(f.rel));
  for (const f of hostCfg) {
    const t = input.texts.get(f.rel) ?? '';
    const present = HEADER_NAMES.filter((h) => t.toLowerCase().includes(h.toLowerCase()));
    obs.push(`${f.rel}: header-a sigurie të konfiguruar: ${present.join(', ') || 'asnjë nga të njohurit'} (s'verifikohet nëse hostingu i zbaton)`);
  }
  if (!hostCfg.length) obs.push('Konfigurim header-ash hostingu (_headers, netlify.toml, vercel.json, .htaccess): nuk u gjet — header-at kontrollohen vetëm me auditin e URL-së');
  return { findings, observations: { config: obs } };
}

const SECRET_PATTERNS: { name: string; re: RegExp; severity: Severity; confidence: number; note?: string }[] = [
  { name: 'Çelës privat (PEM)', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g, severity: 'critical', confidence: 0.9 },
  { name: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/g, severity: 'high', confidence: 0.8 },
  { name: 'Stripe live secret key', re: /\bsk_live_[0-9a-zA-Z]{20,}\b/g, severity: 'critical', confidence: 0.9 },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: 'critical', confidence: 0.9 },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, severity: 'high', confidence: 0.8 },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: 'medium', confidence: 0.5, note: 'çelësat e Maps/Firebase në frontend janë publikë nga natyra — kontrollo kufizimet (HTTP referrer/API)' },
];
const SENSITIVE_NAME = /(^|\/)(\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?|\.htpasswd|id_rsa|id_ed25519|id_ecdsa|[^/]+\.pem|[^/]+\.key|[^/]+\.p12|[^/]+\.pfx|[^/]+\.sql|[^/]+\.sqlite3?|wp-config\.php)$/i;

function mask(s: string): string {
  return `${s.slice(0, 4)}…(${s.length} karaktere, i maskuar)`;
}

/**
 * Skedarë të ndjeshëm dhe sekrete në tekst. Vlerat maskohen gjithmonë; skedarët s'kopjohen.
 * Rreziku varet nga burimi: në repo = i publikuar; në dosje statike = do të publikohej po të deploy-ohej.
 */
export function sensitiveChecks(input: CheckInput): CheckOutput {
  const findings: SourceFinding[] = [];
  const staticSite = input.project.type === 'static' || input.project.type === 'unknown';
  const wr = input.project.webRoot;
  for (const f of input.files) {
    if (!SENSITIVE_NAME.test(f.rel)) continue;
    const base = path.posix.basename(f.rel);
    if (base === 'wp-config.php') {
      const t = input.texts.get(f.rel) ?? '';
      const m = /define\(\s*['"]DB_PASSWORD['"]\s*,\s*['"]([^'"]+)['"]/.exec(t);
      if (!m) continue; // pa fjalëkalim (p.sh. placeholder bosh) → s'ka sekret
      findings.push(finding('SENSITIVE_FILE', 'security', 'critical', 0.85, f.rel, lineAt(t, m.index), 'wp-config.php me fjalëkalim databaze', `DB_PASSWORD = ${mask(m[1]!)}`,
        input.kind === 'repo' ? 'Hiqe nga repo-ja, ndërro fjalëkalimin dhe përdor variabla mjedisi.' : 'Mos e përfshi në kopje/arkiva publike; ndërro fjalëkalimin nëse është ndarë.'));
      continue;
    }
    // Në projekte me build (Next.js etj.), .env lokal jashtë public/ është normal: rrezik vetëm në repo ose në webRoot.
    const inWebRoot = staticSite || (wr && f.rel.startsWith(`${wr}/`));
    if (input.kind === 'folder' && !inWebRoot && /^\.env/.test(base)) continue;
    findings.push(finding('SENSITIVE_FILE', 'security', 'high', 0.8, f.rel, undefined,
      input.kind === 'repo' ? `Skedar i ndjeshëm në repo: ${base}` : `Skedar i ndjeshëm në dosjen që publikohet: ${base}`,
      `${f.rel} (${f.size} bytes; përmbajtja s'shfaqet)`,
      input.kind === 'repo' ? 'Hiqe nga repo-ja dhe nga historia (p.sh. git filter-repo), rrotulloji sekretet dhe shtoje te .gitignore.' : 'Mos e publiko; hiqe nga dosja e deploy-it dhe rrotulloji sekretet nëse është ndarë.'));
  }
  for (const [rel, text] of input.texts) {
    for (const p of SECRET_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        findings.push(finding('POSSIBLE_SECRET', 'security', p.severity, p.confidence, rel, lineAt(text, m.index ?? 0),
          `Sekret i mundshëm: ${p.name}${p.note ? ' — kërkon verifikim' : ''}`, `${mask(m[0])}${p.note ? `; ${p.note}` : ''}`,
          p.note ? 'Verifiko kufizimet e çelësit te ofruesi.' : 'Hiqe nga kodi, rrotulloje menjëherë te ofruesi dhe përdor variabla mjedisi/secret manager.'));
        break; // një gjetje për skedar dhe lloj mjafton; të tjerat do të gjenden pas pastrimit
      }
    }
  }
  return { findings, observations: { 'sensitive-files': ['Emrat e skedarëve dhe modelet e sekreteve kontrollohen; vlerat maskohen dhe s\'ruhen në raport.'] } };
}
