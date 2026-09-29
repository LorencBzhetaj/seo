import * as cheerio from 'cheerio';
import { MIN_CONFIDENCE, rank, type Candidate, type DetectionSignal } from './signals.js';

/**
 * CMS/Tech Stack Detection (§2 J, §3): nga HTML-ja e faqes hyrëse, header-at dhe gjeneratorët e faqeve.
 * Kthen "unknown" kur provat s'arrijnë MIN_CONFIDENCE — s'hamendëson.
 */
export interface TechStackResult {
  /** Emri i CMS-it ose "unknown". */
  cms: string;
  cmsVersion?: string;
  confidence: number;
  signals: DetectionSignal[];
  /** Kandidatët e tjerë me prova (për transparencë). */
  candidates: { name: string; confidence: number }[];
  framework?: { name: string; confidence: number; signals: DetectionSignal[] };
  /** Page builder / theme (p.sh. Divi, Elementor). */
  builder?: { name: string; confidence: number; signals: DetectionSignal[] };
  ecommerce?: { name: string; confidence: number; signals: DetectionSignal[] };
  cdn?: { name: string; confidence: number; signals: DetectionSignal[] };
  /** Plugin-e/mjete të dukshme (p.sh. Yoast SEO): vetëm informacion. */
  extras: string[];
}

export interface TechStackInput {
  url: string;
  html: string;
  headers: Record<string, string>;
  /** <meta name="generator"> nga faqet e analizuara (faqja hyrëse + crawl). */
  generators: string[];
}

type Rule = { name: string; re: RegExp; weight: number; signal: string; source?: 'html' | 'header' };

const CMS_RULES: Rule[] = [
  { name: 'WordPress', re: /\/wp-content\//i, weight: 0.5, signal: 'shtigje /wp-content/' },
  { name: 'WordPress', re: /\/wp-includes\//i, weight: 0.5, signal: 'shtigje /wp-includes/' },
  { name: 'WordPress', re: /api\.w\.org|\/wp-json\//i, weight: 0.4, signal: 'REST API /wp-json/ (api.w.org)' },
  { name: 'Shopify', re: /cdn\.shopify\.com/i, weight: 0.6, signal: 'asete nga cdn.shopify.com' },
  { name: 'Shopify', re: /Shopify\.theme|shopify-section/i, weight: 0.5, signal: 'Shopify.theme / shopify-section' },
  { name: 'Wix', re: /static\.wixstatic\.com|wix-bolt|_wixCIDX/i, weight: 0.5, signal: 'asete Wix (wixstatic)' },
  { name: 'Squarespace', re: /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/i, weight: 0.5, signal: 'asete Squarespace' },
  { name: 'Webflow', re: /data-wf-page|data-wf-site/i, weight: 0.5, signal: 'atribute data-wf-page/site' },
  { name: 'Webflow', re: /website-files\.com|webflow\.js/i, weight: 0.4, signal: 'asete Webflow' },
  { name: 'Joomla', re: /\/media\/jui\/|\/components\/com_[a-z]+/i, weight: 0.4, signal: 'shtigje Joomla (/media/jui, com_*)' },
  { name: 'Drupal', re: /drupal-settings-json|\/sites\/default\/files\//i, weight: 0.5, signal: 'drupal-settings-json / sites/default/files' },
  { name: 'Ghost', re: /ghost-(portal|search)|\/ghost\/api\//i, weight: 0.4, signal: 'skripte Ghost' },
  { name: 'PrestaShop', re: /prestashop/i, weight: 0.4, signal: 'variabla prestashop' },
  { name: 'Magento', re: /Magento_|mage\/cookies|static\/version\d+\/frontend/i, weight: 0.5, signal: 'asete Magento' },
];
const GENERATOR_CMS: [string, RegExp][] = [
  ['WordPress', /^WordPress\b/i],
  ['Joomla', /^Joomla/i],
  ['Drupal', /^Drupal/i],
  ['Wix', /^Wix\.com/i],
  ['Squarespace', /^Squarespace/i],
  ['Webflow', /^Webflow/i],
  ['Ghost', /^Ghost\b/i],
  ['PrestaShop', /^PrestaShop/i],
  ['Shopify', /^Shopify/i],
];
const HEADER_CMS: { name: string; header: string; re?: RegExp; weight: number }[] = [
  { name: 'Wix', header: 'x-wix-request-id', weight: 0.7 },
  { name: 'Shopify', header: 'x-shopid', weight: 0.7 },
  { name: 'Shopify', header: 'x-shopify-stage', weight: 0.7 },
  { name: 'Drupal', header: 'x-drupal-cache', weight: 0.6 },
  { name: 'Drupal', header: 'x-generator', re: /drupal/i, weight: 0.6 },
];
const FRAMEWORK_RULES: Rule[] = [
  { name: 'Next.js', re: /__NEXT_DATA__|\/_next\/static\//, weight: 0.6, signal: '__NEXT_DATA__ / _next/static' },
  { name: 'Nuxt', re: /__NUXT__|\/_nuxt\//, weight: 0.6, signal: '__NUXT__ / _nuxt/' },
  { name: 'Gatsby', re: /___gatsby/, weight: 0.6, signal: 'div#___gatsby' },
  { name: 'Astro', re: /<astro-island|astro-cid-/, weight: 0.6, signal: 'astro-island' },
  { name: 'SvelteKit', re: /__sveltekit|data-sveltekit/, weight: 0.6, signal: 'data-sveltekit' },
  { name: 'Angular', re: /ng-version=/, weight: 0.6, signal: 'atribut ng-version' },
];
const BUILDER_RULES: Rule[] = [
  { name: 'Divi', re: /\/themes\/Divi\/|et_pb_|et-db/, weight: 0.6, signal: 'theme Divi (/themes/Divi/, et_pb_)' },
  { name: 'Elementor', re: /elementor-(kit|element|widget)|\/plugins\/elementor\//, weight: 0.6, signal: 'klasa/plugin Elementor' },
  { name: 'WPBakery', re: /js_composer|vc_row/, weight: 0.5, signal: 'WPBakery (js_composer/vc_row)' },
  { name: 'Beaver Builder', re: /fl-builder/, weight: 0.5, signal: 'fl-builder' },
  { name: 'Avada', re: /fusion-builder|\/themes\/Avada\//, weight: 0.5, signal: 'Avada/Fusion' },
];
const ECOMMERCE_RULES: Rule[] = [
  { name: 'WooCommerce', re: /\/plugins\/woocommerce\/|woocommerce-(page|no-js|js)|wc-block/, weight: 0.6, signal: 'WooCommerce (plugin/klasa)' },
];
const EXTRA_RULES: { name: string; re: RegExp }[] = [
  { name: 'Yoast SEO', re: /yoast-schema-graph|This site is optimized with the Yoast SEO/i },
  { name: 'Rank Math', re: /rank-math|Rank Math/i },
  { name: 'Restaurant Reservations (plugin)', re: /restaurant-reservations|rtb-booking-form/i },
];

function applyRules(rules: Rule[], html: string): { name: string; signal: DetectionSignal }[] {
  return rules.filter((r) => r.re.test(html)).map((r) => ({ name: r.name, signal: { signal: r.signal, source: 'html' as const, weight: r.weight } }));
}

function best(c: Candidate[]): { name: string; confidence: number; signals: DetectionSignal[] } | undefined {
  const top = c[0];
  return top && top.confidence >= MIN_CONFIDENCE ? { name: top.name, confidence: top.confidence, signals: top.signals } : undefined;
}

/**
 * Vetëm "gjurmët teknike": atributet (src/href/class/id/data-*…), përmbajtja e <script> dhe komentet HTML.
 * Teksti i dukshëm përjashtohet, që një artikull që përmend "/wp-content/" të mos e bëjë sitin WordPress.
 */
export function technicalHaystack(html: string): string {
  const $ = cheerio.load(html);
  const parts: string[] = [];
  $('*').each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [k, v] of Object.entries(attribs)) parts.push(`${k}=${v}`);
  });
  $('script').each((_, el) => { parts.push($(el).html() ?? ''); });
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g)) parts.push(m[1]!.slice(0, 300));
  return parts.join('\n');
}

export function detectTechStack(input: TechStackInput): TechStackResult {
  const { headers, url } = input;
  const html = technicalHaystack(input.html);
  const found = applyRules(CMS_RULES, html).map((f) => ({ ...f, signal: { ...f.signal, url } }));
  let cmsVersion: string | undefined;
  for (const g of [...new Set(input.generators)]) {
    for (const [name, re] of GENERATOR_CMS) {
      if (!re.test(g)) continue;
      found.push({ name, signal: { signal: `<meta name="generator" content="${g.slice(0, 40)}">`, source: 'html', url, weight: 0.6 } });
      if (name === 'WordPress') cmsVersion ??= g.match(/WordPress\s+([\d.]+)/i)?.[1];
    }
  }
  for (const h of HEADER_CMS) {
    const v = headers[h.header];
    if (v !== undefined && (!h.re || h.re.test(v))) found.push({ name: h.name, signal: { signal: `header ${h.header}`, source: 'header', url, weight: h.weight } });
  }
  const cmsCandidates = rank(found);
  const cms = best(cmsCandidates);

  const builderFound = applyRules(BUILDER_RULES, html);
  for (const g of input.generators) if (/^Divi\b/i.test(g)) builderFound.push({ name: 'Divi', signal: { signal: `<meta name="generator" content="${g.slice(0, 40)}">`, source: 'html', weight: 0.6 } });

  const frameworkFound = applyRules(FRAMEWORK_RULES, html);
  if (/next\.js/i.test(headers['x-powered-by'] ?? '')) frameworkFound.push({ name: 'Next.js', signal: { signal: 'header x-powered-by: Next.js', source: 'header', weight: 0.6 } });

  const ecommerceFound = applyRules(ECOMMERCE_RULES, html);
  if (cms?.name === 'Shopify') ecommerceFound.push({ name: 'Shopify', signal: { signal: 'CMS Shopify', source: 'html', weight: cms.confidence } });

  const cdnFound: { name: string; signal: DetectionSignal }[] = [];
  if (headers['cf-ray'] || /cloudflare/i.test(headers.server ?? '')) cdnFound.push({ name: 'Cloudflare', signal: { signal: `header ${headers['cf-ray'] ? 'cf-ray' : `server: ${headers.server}`}`, source: 'header', weight: 0.9 } });
  if (headers['x-vercel-id']) cdnFound.push({ name: 'Vercel', signal: { signal: 'header x-vercel-id', source: 'header', weight: 0.9 } });
  if (headers['x-nf-request-id']) cdnFound.push({ name: 'Netlify', signal: { signal: 'header x-nf-request-id', source: 'header', weight: 0.9 } });
  if (headers['x-amz-cf-id']) cdnFound.push({ name: 'Amazon CloudFront', signal: { signal: 'header x-amz-cf-id', source: 'header', weight: 0.9 } });
  if (headers['x-fastly-request-id'] || /fastly/i.test(headers['x-served-by'] ?? '')) cdnFound.push({ name: 'Fastly', signal: { signal: 'header Fastly', source: 'header', weight: 0.8 } });

  return {
    cms: cms?.name ?? 'unknown',
    cmsVersion: cms?.name === 'WordPress' ? cmsVersion : undefined,
    confidence: cms?.confidence ?? cmsCandidates[0]?.confidence ?? 0,
    signals: cms?.signals ?? cmsCandidates[0]?.signals ?? [],
    candidates: cmsCandidates.map((c) => ({ name: c.name, confidence: c.confidence })),
    framework: best(rank(frameworkFound)),
    builder: best(rank(builderFound)),
    ecommerce: best(rank(ecommerceFound)),
    cdn: best(rank(cdnFound)),
    extras: EXTRA_RULES.filter((r) => r.re.test(html)).map((r) => r.name),
  };
}
