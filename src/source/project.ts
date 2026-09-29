import fs from 'node:fs';
import path from 'node:path';
import { combine, type DetectionSignal } from '../detection/signals.js';
import type { FileEntry } from './types.js';

/**
 * Lloji i projektit nga skedarët (pa ekzekutuar asgjë): vendos cilat kontrolle kanë kuptim.
 * Për projektet që gjenerojnë HTML me build/server, kontrollet e HTML-së dalin "skipped" me arsye.
 */
export type ProjectType =
  | 'static' | 'nextjs' | 'nuxt' | 'astro' | 'gatsby' | 'sveltekit' | 'vite-spa' | 'hugo' | 'jekyll' | 'eleventy' | 'wordpress' | 'php' | 'unknown';

export const PROJECT_LABELS: Record<ProjectType, string> = {
  static: 'HTML/CSS/JS statik',
  nextjs: 'Next.js',
  nuxt: 'Nuxt',
  astro: 'Astro',
  gatsby: 'Gatsby',
  sveltekit: 'SvelteKit',
  'vite-spa': 'Vite (SPA)',
  hugo: 'Hugo',
  jekyll: 'Jekyll',
  eleventy: 'Eleventy',
  wordpress: 'WordPress (theme/plugin/instalim)',
  php: 'PHP',
  unknown: 'i panjohur',
};

/** Kontrollet e auditit të skedarëve dhe mbështetja e tyre sipas llojit. */
export type SourceCheckId = 'html-seo' | 'local-links' | 'css-assets' | 'duplicates' | 'images' | 'config' | 'sensitive-files';

export interface CheckSupport {
  id: SourceCheckId;
  supported: 'yes' | 'partial' | 'no';
  reason?: string;
}

export interface ProjectInfo {
  type: ProjectType;
  confidence: number;
  signals: DetectionSignal[];
  /** Rrënja për linket absolute ("/assets/x.css"): dosja, ose public/static kur ekziston. */
  webRoot: string;
  /** Dosja ku pritet HTML-ja përfundimtare pas build-it (për sugjerim), kur njihet. */
  buildOutputHint?: string;
  htmlFiles: number;
  support: CheckSupport[];
  /** Kontrolle që s'mund të bëhen kurrë nga skedarët: kërkojnë ekzekutim/URL publike. */
  notFromFiles: { check: string; reason: string }[];
}

const GENERATED: Partial<Record<ProjectType, { out: string; why: string }>> = {
  nextjs: { out: 'out/ (next export) ose URL-ja e deploy-it', why: 'faqet renderohen nga React (build/server)' },
  nuxt: { out: '.output/public/ (nuxi generate) ose URL-ja', why: 'faqet renderohen nga Vue (build/server)' },
  astro: { out: 'dist/', why: 'faqet gjenerohen nga template .astro në build' },
  gatsby: { out: 'public/ (pas gatsby build)', why: 'faqet gjenerohen në build' },
  sveltekit: { out: 'build/ ose URL-ja', why: 'faqet renderohen nga Svelte (build/server)' },
  hugo: { out: 'public/ (pas hugo)', why: 'faqet gjenerohen nga template/Markdown në build' },
  jekyll: { out: '_site/', why: 'faqet gjenerohen nga Liquid/Markdown në build' },
  eleventy: { out: '_site/', why: 'faqet gjenerohen nga template në build' },
  wordpress: { out: 'URL-ja e sitit', why: 'faqet renderohen nga PHP në server' },
  php: { out: 'URL-ja e sitit', why: 'faqet renderohen nga PHP në server' },
};

function readJson(abs: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function detectProject(root: string, files: FileEntry[]): ProjectInfo {
  const has = (rel: string) => files.some((f) => f.rel === rel);
  const any = (re: RegExp) => files.some((f) => re.test(f.rel));
  const found: { type: ProjectType; signal: DetectionSignal }[] = [];
  const add = (type: ProjectType, signal: string, weight: number) => found.push({ type, signal: { signal, source: 'html', weight } });

  const pkg = has('package.json') ? readJson(path.join(root, 'package.json')) : undefined;
  const deps = { ...((pkg?.dependencies as object) ?? {}), ...((pkg?.devDependencies as object) ?? {}) } as Record<string, string>;
  const dep = (n: string) => n in deps;
  if (dep('next')) add('nextjs', 'package.json: next', 0.6);
  if (any(/^next\.config\.(js|mjs|ts|cjs)$/)) add('nextjs', 'next.config.*', 0.5);
  if (any(/^(src\/)?(app|pages)\/.*\.(tsx|jsx|js|ts)$/) && dep('next')) add('nextjs', 'app/ ose pages/', 0.3);
  if (dep('nuxt') || dep('nuxt3')) add('nuxt', 'package.json: nuxt', 0.6);
  if (any(/^nuxt\.config\.(js|ts|mjs)$/)) add('nuxt', 'nuxt.config.*', 0.5);
  if (dep('astro')) add('astro', 'package.json: astro', 0.6);
  if (any(/^astro\.config\.(mjs|js|ts)$/)) add('astro', 'astro.config.*', 0.5);
  if (dep('gatsby')) add('gatsby', 'package.json: gatsby', 0.6);
  if (dep('@sveltejs/kit')) add('sveltekit', 'package.json: @sveltejs/kit', 0.6);
  if (dep('vite') && has('index.html') && !dep('next') && !dep('nuxt') && !dep('astro') && !dep('@sveltejs/kit')) add('vite-spa', 'package.json: vite + index.html', 0.6);
  if (any(/^(hugo|config)\.(toml|yaml|yml)$/) && (any(/^layouts\//) || any(/^content\//))) add('hugo', 'config + layouts/ ose content/', 0.6);
  if (has('_config.yml') && (any(/^_layouts\//) || any(/^_posts\//) || has('Gemfile'))) add('jekyll', '_config.yml + _layouts/_posts', 0.6);
  if (any(/^\.eleventy\.(js|cjs|mjs)$|^eleventy\.config\./) || dep('@11ty/eleventy')) add('eleventy', 'konfigurim Eleventy', 0.6);
  if (has('wp-config.php') || has('wp-config-sample.php') || any(/^wp-content\//)) add('wordpress', 'wp-config / wp-content/', 0.7);
  const styleCss = files.find((f) => f.rel === 'style.css');
  if (styleCss && styleCss.size < 64 * 1024 && /Theme Name:/i.test(fs.readFileSync(styleCss.abs, 'utf8').slice(0, 4000))) add('wordpress', 'style.css me "Theme Name:" (theme)', 0.6);
  if (files.some((f) => f.rel.endsWith('.php')) && !found.some((x) => x.type === 'wordpress')) add('php', 'skedarë .php', 0.5);

  const htmlFiles = files.filter((f) => f.ext === '.html' || f.ext === '.htm');
  if (htmlFiles.length && !found.length) add('static', `${htmlFiles.length} skedarë HTML, pa framework/generator`, htmlFiles.some((f) => /(^|\/)index\.html?$/.test(f.rel)) ? 0.8 : 0.6);

  const by = new Map<ProjectType, DetectionSignal[]>();
  for (const f of found) by.set(f.type, [...(by.get(f.type) ?? []), f.signal]);
  const ranked = [...by].map(([type, signals]) => ({ type, signals, confidence: combine(signals) })).sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0] && ranked[0].confidence >= 0.5 ? ranked[0] : undefined;
  const type: ProjectType = top?.type ?? 'unknown';

  // Rrënja e web-it për linket "/…": për static, dosja; për SSG/framework, dosja e aseteve publike.
  const publicDir = ['public', 'static'].find((d) => files.some((f) => f.rel.startsWith(`${d}/`)));
  const webRoot = type === 'static' || type === 'unknown' || !publicDir ? '' : publicDir;

  const gen = GENERATED[type];
  const noHtml = htmlFiles.length === 0;
  const htmlReason = gen
    ? `${PROJECT_LABELS[type]}: ${gen.why} — HTML-ja përfundimtare s'ekziston në burim. Ekzekuto build vetë dhe audito output-in (${gen.out}) me --folder, ose URL-në publike.`
    : noHtml ? 'S\'u gjet asnjë skedar HTML në dosje.' : undefined;
  const spa = type === 'vite-spa';
  const support: CheckSupport[] = [
    { id: 'html-seo', supported: htmlReason ? 'no' : spa ? 'partial' : 'yes', reason: htmlReason ?? (spa ? 'index.html është shell SPA: title/meta kontrollohen, përmbajtja renderohet me JS' : undefined) },
    { id: 'local-links', supported: htmlReason ? 'no' : spa ? 'partial' : 'yes', reason: htmlReason ?? (spa ? 'vetëm referencat në index.html; routing-u i SPA-së s\'kontrollohet' : undefined) },
    { id: 'css-assets', supported: files.some((f) => f.ext === '.css') ? 'yes' : 'no', reason: files.some((f) => f.ext === '.css') ? undefined : 'S\'ka skedarë .css' },
    { id: 'duplicates', supported: htmlReason || spa ? 'no' : 'yes', reason: htmlReason ?? (spa ? 'përmbajtja renderohet me JS' : undefined) },
    { id: 'images', supported: 'yes' },
    { id: 'config', supported: 'yes' },
    { id: 'sensitive-files', supported: 'yes' },
  ];
  const notFromFiles = [
    { check: 'Health Score', reason: 'kërkon auditin e URL-së publike (headers, Lighthouse, crawl) — s\'shpiket nga skedarët' },
    { check: 'Performance / Lighthouse', reason: 'kërkon ekzekutim në browser; kodi s\'u ekzekutua' },
    { check: 'Header-at HTTP, HTTPS/TLS, ridrejtimet', reason: 'varen nga serveri/hostingu, jo vetëm nga skedarët' },
    { check: 'Përmbajtja e renderuar me JavaScript', reason: 'asnjë skript s\'u ekzekutua' },
  ];
  return {
    type,
    confidence: top?.confidence ?? ranked[0]?.confidence ?? 0,
    signals: top?.signals ?? ranked[0]?.signals ?? [],
    webRoot,
    buildOutputHint: gen?.out,
    htmlFiles: htmlFiles.length,
    support,
    notFromFiles,
  };
}
