// Rregullat e URL-ve për crawler-in: normalizim, brendshëm/jashtëm dhe URL që s'vizitohen kurrë.

/** Parametra gjurmimi që s'ndryshojnë përmbajtjen; hiqen nga çelësi i deduplikimit. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|ref_src)$/i;

/**
 * Segmente path-i që tregojnë hyrje/dalje, llogari, shportë ose pagesë (§13: s'vizitohen kurrë,
 * edhe nëse config-u i heq). Përputhje e plotë e segmentit, që "/blog/login-tips" të mos bllokohet.
 */
const UNSAFE_SEGMENT =
  /^(wp-admin|wp-login\.php|log-?in|sign-?in|log-?out|sign-?out|register|sign-?up|cart|basket|shporta|checkout|my-account|account|wishlist|xmlrpc\.php|wp-json|admin-ajax\.php|wp-cron\.php)$/i;

/** Parametra query që ndryshojnë gjendje ose krijojnë hapësirë të pafundme URL-sh. */
const UNSAFE_QUERY = /^(add-to-cart|add_to_cart|remove_item|removed_item|undo_item|action|logout|_wpnonce|nonce|token|replytocom|wc-ajax|download|share|print|s|q|search)$/i;

/** Skedarë që s'janë faqe HTML: s'shkarkohen nga crawler-i. */
const RESOURCE_EXT =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|zip|rar|7z|gz|tgz|mp3|wav|ogg|mp4|m4v|mov|avi|webm|docx?|xlsx?|pptx?|odt|csv|css|js|mjs|json|xml|rss|atom|txt|woff2?|ttf|otf|eot|exe|dmg|apk)$/i;

export type SkipReason =
  | 'max-pages'
  | 'max-depth'
  | 'robots'
  | 'unsafe'
  | 'excluded'
  | 'resource'
  | 'blocked-url'
  | 'time-budget'
  | 'crawl-stopped';

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  'max-pages': 'kufiri i faqeve (maxPages)',
  'max-depth': 'kufiri i thellësisë (maxDepth)',
  robots: 'ndaluar nga robots.txt',
  unsafe: 'URL që mund të ndryshojë gjendje (login/logout/cart/checkout/veprim)',
  excluded: 'excludePatterns në config',
  resource: 'skedar, jo faqe HTML',
  'blocked-url': 'adresë lokale/private ose skemë e palejuar',
  'time-budget': 'kufiri kohor i crawl-it',
  'crawl-stopped': 'crawl-i u ndal (bllokime të njëpasnjëshme)',
};

/** Çelës për deduplikim: pa #fragment, pa parametra gjurmimi, host me shkronja të vogla, pa portë parazgjedhje. */
export function normalizeUrl(input: string | URL): string {
  const u = new URL(typeof input === 'string' ? input : input.href);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  u.search = keep.length ? `?${new URLSearchParams(keep).toString()}` : '';
  return u.href;
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** I brendshëm = i njëjti host (www dhe pa-www trajtohen si i njëjti sit). */
export function isInternal(url: URL, root: URL): boolean {
  return bareHost(url.hostname) === bareHost(root.hostname);
}

/** Arsyeja pse një URL i brendshëm s'duhet vizituar (para robots/budget), ose null. */
export function unsafeOrExcluded(url: URL, excludePatterns: readonly string[]): SkipReason | null {
  const segments = url.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (segments.some((s) => UNSAFE_SEGMENT.test(s))) return 'unsafe';
  if ([...url.searchParams.keys()].some((k) => UNSAFE_QUERY.test(k))) return 'unsafe';
  const lowerPath = url.pathname.toLowerCase();
  if (excludePatterns.some((p) => p && lowerPath.includes(p.toLowerCase()))) return 'excluded';
  if (RESOURCE_EXT.test(url.pathname)) return 'resource';
  return null;
}

/**
 * A janë dy URL "variante" të së njëjtës adresë (vetëm trailing slash, query, shkronja
 * ose www/protokoll ndryshojnë)? Përdoret si sinjal shtesë, jo si provë dyfishimi.
 */
export function isUrlVariant(a: string, b: string): boolean {
  const ua = new URL(a);
  const ub = new URL(b);
  if (bareHost(ua.hostname) !== bareHost(ub.hostname)) return false;
  const pa = ua.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  const pb = ub.pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return pa === pb && a !== b;
}
