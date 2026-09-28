import { describe, expect, it } from 'vitest';
import { runAvailability } from '../src/modules/availability.js';
import { runSecurity } from '../src/modules/security.js';
import { runTechnicalSeo } from '../src/modules/seo-technical.js';
import type { AuditResult } from '../src/core/schemas.js';
import { fetchResult, fixture, makeCtx } from './helpers.js';

const check = (r: AuditResult, id: string) => {
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} mungon`);
  return c;
};
const codes = (r: AuditResult) => r.issues.map((i) => i.code).sort();

describe('SEO teknik', () => {
  it('faqe e mirë: pa issue, score 100, çdo issue ka provë/URL/fix', () => {
    const r = runTechnicalSeo(makeCtx({ html: fixture('good.html') }));
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
    expect(check(r, 'canonical').status).toBe('pass');
  });

  it('mungesa e canonical është vetëm informacion: pa issue dhe pa ndikim në pikë', () => {
    const r = runTechnicalSeo(makeCtx({ html: fixture('no-canonical.html') }));
    const c = check(r, 'canonical');
    expect(c.status).toBe('info');
    expect(c.score).toBeNull();
    expect(c.issues).toEqual([]);
    expect(c.observations?.[0]).toMatch(/nuk llogaritet si problem/);
    expect(r.issues.find((i) => i.code.includes('CANONICAL'))).toBeUndefined();
    expect(r.score).toBe(100);
  });

  it('faqe me probleme: noindex critical, canonical konfliktues, dy tituj', () => {
    const r = runTechnicalSeo(makeCtx({ html: fixture('problems.html') }));
    expect(codes(r)).toEqual(
      ['CONFLICTING_CANONICALS', 'HOMEPAGE_NOINDEX', 'MISSING_META_DESCRIPTION', 'MULTIPLE_H1', 'MULTIPLE_TITLES', 'TITLE_LENGTH'].sort(),
    );
    const noindex = r.issues.find((i) => i.code === 'HOMEPAGE_NOINDEX')!;
    expect(noindex.severity).toBe('critical');
    expect(noindex.evidence[0]).toMatchObject({ type: 'dom', url: 'https://example.com/' });
    expect(noindex.evidence[0]!.detected).toContain('noindex');
    // MULTIPLE_H1 është sinjal i pasigurt → verifikim manual
    expect(r.issues.find((i) => i.code === 'MULTIPLE_H1')!.needsManualReview).toBe(true);
    for (const i of r.issues) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.url).toBeTruthy();
      expect(i.fix.length).toBeGreaterThan(10);
      expect(i.severity).toMatch(/critical|high|medium|low/);
    }
  });

  it('noindex nga header X-Robots-Tag jep provë http', () => {
    const r = runTechnicalSeo(makeCtx({ html: fixture('good.html'), headers: { 'x-robots-tag': 'noindex' } }));
    const i = r.issues.find((x) => x.code === 'HOMEPAGE_NOINDEX')!;
    expect(i.evidence[0]).toMatchObject({ type: 'http', detected: 'X-Robots-Tag: noindex' });
  });

  it('robots.txt që bllokon faqen hyrëse për Googlebot → critical me rreshtin', () => {
    const r = runTechnicalSeo(makeCtx({ robotsTxt: 'User-agent: *\nDisallow: /\n' }));
    const i = r.issues.find((x) => x.code === 'ROBOTS_BLOCKS_HOMEPAGE')!;
    expect(i.severity).toBe('critical');
    expect(i.evidence[0]!.detected).toContain('Rreshti 2: Disallow: /');
  });

  it('robots.txt 404 = informacion (RFC 9309: lejo gjithçka), jo problem', () => {
    const r = runTechnicalSeo(makeCtx({ robotsTxt: null }));
    expect(check(r, 'robots-txt').status).toBe('info');
    expect(r.issues).toEqual([]);
  });

  it('canonical te URL që kthen 404 → CANONICAL_TARGET_BROKEN me provë http', () => {
    const html = '<html><head><title>Titull i mjaftueshëm këtu</title><link rel="canonical" href="https://example.com/old"></head><body><h1>x</h1></body></html>';
    const r = runTechnicalSeo(
      makeCtx({ html, canonicalTarget: { status: 'ok', value: fetchResult({ requestedUrl: 'https://example.com/old', finalUrl: 'https://example.com/old', status: 404 }) } }),
    );
    const i = r.issues.find((x) => x.code === 'CANONICAL_TARGET_BROKEN')!;
    expect(i.severity).toBe('high');
    expect(i.evidence.some((e) => e.type === 'http' && e.detected.includes('HTTP 404'))).toBe(true);
  });

  it('kur faqja s\'merret: kontrollet HTML janë skipped me arsye, jo 0 pikë', () => {
    const r = runTechnicalSeo(makeCtx({ main: { status: 'error', error: 'Timeout pas 10000 ms', code: 'TIMEOUT' } }));
    for (const id of ['title', 'meta-description', 'h1', 'canonical', 'indexability']) {
      expect(check(r, id).status).toBe('skipped');
      expect(check(r, id).reason).toBeTruthy();
    }
    // robots.txt u lexua, por pa HTML-në reale s'ka score SEO (jo 100 "partial")
    expect(r.score).toBeNull();
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/HTML-ja reale nuk u mor/);
  });
});

describe('Security (kontekstuale)', () => {
  it('mungesa e CSP pa formularë = low; me fushë fjalëkalimi = medium', () => {
    const plain = runSecurity(makeCtx({ html: fixture('good.html') }));
    expect(plain.issues.find((i) => i.code === 'MISSING_CSP')!.severity).toBe('low');
    const login = runSecurity(makeCtx({ html: fixture('problems.html') }));
    expect(login.issues.find((i) => i.code === 'MISSING_CSP')!.severity).toBe('medium');
    expect(login.issues.find((i) => i.code === 'MISSING_FRAME_PROTECTION')!.severity).toBe('medium');
  });

  it('formular kërkimi GET s\'e ngre framing në medium; formular POST po', () => {
    const search = '<html><head><title>Kërkim</title></head><body><form action="/search"><input name="q"></form></body></html>';
    expect(runSecurity(makeCtx({ html: search })).issues.find((i) => i.code === 'MISSING_FRAME_PROTECTION')!.severity).toBe('low');
    const contact = '<html><head><title>Kontakt</title></head><body><form method="POST" action="/send"><input name="email"></form></body></html>';
    expect(runSecurity(makeCtx({ html: contact })).issues.find((i) => i.code === 'MISSING_FRAME_PROTECTION')!.severity).toBe('medium');
  });

  it('zbulim versioni: "Apache/2.4.41" po; emër hosti me shifra (Wikipedia) jo', () => {
    const withVersion = runSecurity(makeCtx({ headers: { server: 'Apache/2.4.41 (Ubuntu)', 'x-powered-by': 'PHP/8.1.2' } }));
    const i = withVersion.issues.find((x) => x.code === 'SERVER_VERSION_DISCLOSURE')!;
    expect(i.evidence[0]!.detected).toBe('server: Apache/2.4.41 (Ubuntu) | x-powered-by: PHP/8.1.2');
    const hostname = runSecurity(makeCtx({ headers: { server: 'mw-web.eqiad.main-69576b9c4-4pfd4' } }));
    expect(hostname.issues.find((x) => x.code === 'SERVER_VERSION_DISCLOSURE')).toBeUndefined();
    const plain = runSecurity(makeCtx({ headers: { server: 'cloudflare' } }));
    expect(plain.issues.find((x) => x.code === 'SERVER_VERSION_DISCLOSURE')).toBeUndefined();
  });

  it('asnjë header sigurie s\'shpallet high/critical automatikisht', () => {
    const r = runSecurity(makeCtx({ html: fixture('good.html') }));
    const headerIssues = r.issues.filter((i) => /CSP|HSTS|FRAME|CONTENT_TYPE|REFERRER/.test(i.code));
    expect(headerIssues.length).toBeGreaterThan(0);
    for (const i of headerIssues) expect(['medium', 'low']).toContain(i.severity);
    // Referrer-Policy mungon → vetëm info
    expect(r.checks.find((c) => c.id === 'referrer-policy')!.status).toBe('info');
  });

  it('header-at e plotë → pa issue header-ash', () => {
    const r = runSecurity(
      makeCtx({
        headers: {
          'strict-transport-security': 'max-age=31536000',
          'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
        },
      }),
    );
    expect(r.issues).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('mixed content aktiv = high me snippet-in si provë', () => {
    const r = runSecurity(makeCtx({ html: fixture('problems.html') }));
    const i = r.issues.find((x) => x.code === 'MIXED_CONTENT_ACTIVE')!;
    expect(i.severity).toBe('high');
    expect(i.evidence[0]!.detected).toContain('http://cdn.example.net/lib.js');
  });

  it('certifikatë e pavlefshme = critical; TLS i palexueshëm = skipped', () => {
    const bad = runSecurity(makeCtx({ tls: { status: 'ok', value: { host: 'example.com', authorized: false, authorizationError: 'CERT_HAS_EXPIRED', daysRemaining: -3 } } }));
    expect(bad.issues.find((i) => i.code === 'TLS_CERT_INVALID')!.severity).toBe('critical');
    const unknown = runSecurity(makeCtx({ tls: { status: 'error', error: 'ECONNRESET' } }));
    const c = unknown.checks.find((x) => x.id === 'tls-certificate')!;
    expect(c.status).toBe('skipped');
    expect(c.score).toBeNull();
    expect(unknown.partial).toBe(true);
  });

  it('faqe http: HTTPS mungon = high; HSTS/TLS not_applicable', () => {
    const r = runSecurity(makeCtx({ url: 'http://example.com/' }));
    expect(r.issues.find((i) => i.code === 'NOT_HTTPS')!.severity).toBe('high');
    expect(r.checks.find((c) => c.id === 'hsts')!.status).toBe('not_applicable');
    expect(r.checks.find((c) => c.id === 'tls-certificate')!.status).toBe('not_applicable');
  });

  it('http:// që shërben 200 pa ridrejtim → HTTP_NOT_REDIRECTED', () => {
    const r = runSecurity(makeCtx({ httpVariant: { status: 'ok', value: fetchResult({ requestedUrl: 'http://example.com/', finalUrl: 'http://example.com/' }) } }));
    expect(r.issues.find((i) => i.code === 'HTTP_NOT_REDIRECTED')!.evidence[0]!.detected).toContain('HTTP 200');
  });
});

describe('Availability', () => {
  it('faqe e paarritshme për shkak rrjeti = critical me confidence < 0.9 (s\'aktivizon cap-in)', () => {
    const r = runAvailability(makeCtx({ main: { status: 'error', error: 'Timeout pas 10000 ms', code: 'TIMEOUT' } }));
    const i = r.issues[0]!;
    expect(i.code).toBe('SITE_UNREACHABLE');
    expect(i.confidence).toBeLessThan(0.9);
    expect(r.checks.filter((c) => c.status === 'skipped')).toHaveLength(2);
  });

  it('HTTP 500 = critical i konfirmuar', () => {
    const r = runAvailability(makeCtx({ main: { status: 'ok', value: fetchResult({ status: 500, statusText: 'Internal Server Error' }) } }));
    expect(r.issues[0]).toMatchObject({ code: 'HOMEPAGE_HTTP_ERROR', severity: 'critical', confidence: 1 });
  });

  it('TTFB i ngadaltë nga një matje lokale → needsManualReview', () => {
    const r = runAvailability(makeCtx({ main: { status: 'ok', value: fetchResult({ ttfbMs: 2500 }) } }));
    const i = r.issues.find((x) => x.code === 'SLOW_SERVER_RESPONSE')!;
    expect(i.severity).toBe('medium');
    expect(i.needsManualReview).toBe(true);
  });
});
