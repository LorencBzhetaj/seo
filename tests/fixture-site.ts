import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Site lokal i kontrolluar për testet e crawler-it dhe për provë manuale:
 *   npx tsx tests/fixture-site.ts   → printon URL-në dhe komandën e auditit
 */
export interface FixtureSite {
  base: string;
  host: string;
  /** Kërkesat e marra: path + koha (ms) + concurrency në atë çast. */
  requests: { path: string; at: number; active: number; method: string }[];
  maxActive: () => number;
  close: () => Promise<void>;
}

export interface FixtureOptions {
  /** Numri i faqeve /p/1 … /p/N të lidhura nga /products (për testin e maxPages). */
  productPages?: number;
  /** Vonesa e përgjigjes (ms), për të parë concurrency-në. */
  latencyMs?: number;
  robotsTxt?: string;
  sitemap?: 'good' | 'none' | 'html';
  /** Faqja hyrëse lidh vetëm /members/1…5, që kthejnë 403 (bllokim për klientin). */
  blockedSection?: boolean;
}

const page = (title: string, body: string, head = '', bodyClass = 'page-template-default page') =>
  `<!doctype html><html lang="sq"><head><meta charset="utf-8"><title>${title}</title>${head}</head>` +
  `<body class="${bodyClass}"><header><nav><a href="/">Kreu</a> <a href="/about">Rreth nesh</a> <a href="/old-page">Faqe e vjetër</a> <a href="/contact">Kontakt</a></nav></header>` +
  `<main>${body}</main><footer><a href="/privacy">Privatësia</a></footer></body></html>`;

const lorem = (seed: string, words: number) =>
  Array.from({ length: words }, (_, i) => `${seed}${i % 37}`).join(' ');

export async function startFixtureSite(opts: FixtureOptions = {}): Promise<FixtureSite> {
  const requests: FixtureSite['requests'] = [];
  let active = 0;
  let maxActive = 0;
  const products = opts.productPages ?? 0;
  let base = '';

  const routes = (path: string): { status: number; body: string; headers?: Record<string, string> } | undefined => {
    const html = (body: string) => ({ status: 200, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
    switch (path) {
      case '/robots.txt':
        // "__BASE__" në robotsTxt zëvendësohet me URL-në e serverit (porti njihet vetëm pas nisjes).
        return { status: 200, body: (opts.robotsTxt ?? `User-agent: *\nDisallow: /private/\nSitemap: __BASE__/sitemap.xml\n`).replaceAll('__BASE__', base), headers: { 'content-type': 'text/plain' } };
      case '/sitemap.xml':
        if (opts.sitemap === 'none') return { status: 404, body: 'not found' };
        if (opts.sitemap === 'html') return html('<html><body>Faqja nuk u gjet</body></html>');
        return {
          status: 200,
          headers: { 'content-type': 'application/xml' },
          body:
            `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            `<url><loc>${base}/</loc><lastmod>2026-09-01</lastmod></url>` +
            `<url><loc>${base}/about</loc><lastmod>2026-09-01</lastmod></url>` +
            `<url><loc>${base}/orphan</loc><lastmod>not-a-date</lastmod></url>` +
            `<url><loc>${base}/gone-from-sitemap</loc></url>` +
            `<url><loc>${base}/old-page</loc></url>` +
            `</urlset>`,
        };
      case '/':
        if (opts.blockedSection) {
          return html(`<!doctype html><html lang="sq"><head><title>Kreu</title></head><body><h1>Kreu</h1>${[1, 2, 3, 4, 5].map((i) => `<a href="/members/${i}">M${i}</a>`).join(' ')}</body></html>`);
        }
        return html(page('Kreu — Fixture', `<h1>Mirë se vini</h1><p>${lorem('kreu', 120)}</p>
          <a href="/blog">Blog</a> <a href="/products">Produkte</a> <a href="/missing">Link i prishur</a>
          <a href="/private/secret">Private</a> <a href="/wp-login.php">Hyr</a> <a href="/cart/">Shporta</a> <a href="/shop?add-to-cart=12">Shto</a>
          <a href="/files/menu.pdf">Menu PDF</a> <a href="https://external.example/">Jashtë</a> <a href="/level1">Thellë</a>
          <a href="/to-local">Redirect lokal</a> <a href="/to-logout">Dil</a> <a href="/to-partner">Partner</a> <a href="/server-error">Gabim</a> <a href="mailto:a@b.c">Email</a> <a href="/about#team">Ekipi</a>`,
          '<meta name="description" content="Faqja hyrëse e fixture-it me përshkrim mjaftueshëm të gjatë për testet.">'));
      case '/about':
        return html(page('Rreth nesh — Fixture', `<h1>Rreth nesh</h1><p>${lorem('rreth', 150)}</p>`, '<meta name="description" content="Rreth nesh">'));
      case '/contact':
        return html(page('Kontakt — Fixture', `<h1>Kontakt</h1><p>${lorem('kontakt', 60)}</p><a href="/missing">Link i prishur</a>` +
          // MVP-3: formë kontakti — s'duhet dërguar kurrë (SAFE mode)
          '<form method="post" action="/contact-submit"><label>Email <input type="email" name="email" required></label><label>Mesazhi <textarea name="message"></textarea></label><button>Dërgo</button></form>'));
      case '/contact-submit':
        return html(page('NDALUAR', "<h1>Forma s'duhej dërguar</h1>"));
      case '/privacy':
        return html(page('Privatësia — Fixture', `<h1>Privatësia</h1><p>${lorem('privat', 90)}</p>`));
      case '/blog':
        return html(page('Blog — Fixture', `<h1>Blog</h1><a href="/blog/post-1">Post 1</a> <a href="/blog/post-2">Post 2</a>`, '', 'post-template-default blog'));
      case '/blog/post-1':
        return html(page('Post 1 — Fixture', `<h1>Post 1</h1><p>${lorem('post', 200)}</p><img src="/img/a.jpg">`, '', 'post-template-default single single-post postid-1'));
      case '/blog/post-2':
        return html(page('Post 2 — Fixture', `<h1>Post 2</h1><p>${lorem('tjeter', 200)}</p><img src="/img/b.jpg">`, '', 'post-template-default single single-post postid-2'));
      case '/products':
        return html(page('Produkte — Fixture', `<h1>Produkte</h1>${Array.from({ length: products }, (_, i) => `<a href="/p/${i + 1}">P${i + 1}</a>`).join(' ')}`));
      case '/old-page':
        return { status: 301, body: '', headers: { location: '/about' } };
      case '/to-local':
        return { status: 302, body: '', headers: { location: 'http://127.0.0.1:1/admin' } }; // i njëjti host, port jashtë allowlist
      case '/to-logout':
        return { status: 302, body: '', headers: { location: '/logout' } };
      case '/to-partner':
        return { status: 301, body: '', headers: { location: 'https://partner.example/' } };
      case '/logout':
        return html(page('NDALUAR', "<h1>Dalja — s'duhej vizituar</h1>"));
      case '/server-error':
        return { status: 500, body: 'boom', headers: { 'content-type': 'text/plain' } };
      case '/level1':
        return html(page('L1', '<h1>L1</h1><a href="/level2">L2</a>'));
      case '/level2':
        return html(page('L2', '<h1>L2</h1><a href="/level3">L3</a>'));
      case '/level3':
        return html(page('L3', '<h1>L3</h1><a href="/level4">L4</a>'));
      case '/level4':
        return html(page('L4', '<h1>L4</h1>'));
      case '/orphan':
        return html(page('Orphan — Fixture', `<h1>Orphan</h1><p>${lorem('orphan', 80)}</p>`));
      case '/private/secret':
      case '/wp-login.php':
      case '/cart/':
        // S'duhet arritur kurrë nga crawler-i
        return html(page('NDALUAR', '<h1>Nuk duhej vizituar</h1>'));
    }
    if (/^\/members\/\d+$/.test(path)) return { status: 403, body: 'Access denied', headers: { 'content-type': 'text/plain' } };
    const m = /^\/p\/(\d+)$/.exec(path);
    if (m && Number(m[1]) <= products) return html(page(`Produkti ${m[1]} — Fixture`, `<h1>Produkti ${m[1]}</h1><p>${lorem(`prod${m[1]}x`, 100)}</p>`, '', 'product-template-default single-product'));
    return undefined;
  };

  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    active++;
    maxActive = Math.max(maxActive, active);
    requests.push({ path: req.url ?? path, at: Date.now(), active, method: req.method ?? 'GET' });
    const respond = () => {
      const r = routes(path) ?? { status: 404, body: '<html><body>404</body></html>', headers: { 'content-type': 'text/html' } };
      res.writeHead(r.status, r.headers ?? {}).end(r.body);
      active--;
    };
    if (opts.latencyMs) setTimeout(respond, opts.latencyMs);
    else respond();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  return {
    base,
    host: `127.0.0.1:${port}`,
    requests,
    maxActive: () => maxActive,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// Ekzekutim i drejtpërdrejtë: nis site-in për provë manuale.
if (process.argv[1] && /fixture-site\.ts$/.test(process.argv[1])) {
  const site = await startFixtureSite({ productPages: 30 });
  console.log(`Fixture site: ${site.base}/`);
  console.log(`Audit: npm run audit -- ${site.base}/ --allow-local ${site.host} --no-lighthouse`);
}
