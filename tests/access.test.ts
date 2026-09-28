import { describe, expect, it } from 'vitest';
import { classifyAccess } from '../src/core/access.js';
import { runModules } from '../src/core/run.js';
import { runAvailability } from '../src/modules/availability.js';
import { runSecurity } from '../src/modules/security.js';
import { runTechnicalSeo } from '../src/modules/seo-technical.js';
import { computeHealth } from '../src/scoring/scorer.js';
import type { FetchResult } from '../src/net/safe-fetch.js';
import { fetchResult, makeCtx } from './helpers.js';

// Përgjigjja reale e marrë nga gjecaj.al përmes IPv6 (WARP), 2026-09-28.
const cloudflare403 = (over: Partial<FetchResult> = {}): FetchResult =>
  fetchResult({
    requestedUrl: 'https://gjecaj.al/',
    finalUrl: 'https://gjecaj.al/',
    status: 403,
    statusText: 'Forbidden',
    headers: { 'content-type': 'text/plain', server: 'cloudflare', 'cf-ray': 'a4247cce6ca2b745-SOF', 'cf-cache-status': 'DYNAMIC' },
    body: 'Access denied\n',
    remoteAddress: '2606:4700:3030::6815:3de9',
    ...over,
  });

// Faqe bllokimi në HTML (p.sh. "Sorry, you have been blocked") — s'duhet analizuar si faqja reale.
const blockPageHtml =
  '<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head><body><h1>Sorry, you have been blocked</h1></body></html>';

const blockedCtx = (over: Parameters<typeof makeCtx>[0] = {}) =>
  makeCtx({ url: 'https://gjecaj.al/', main: { status: 'ok', value: cloudflare403() }, robotsStatus: 403, ...over });

describe('classifyAccess', () => {
  it('403 nga Cloudflare → blocked me provider, Ray ID, IPv6 dhe trupin', () => {
    const a = classifyAccess({ status: 'ok', value: cloudflare403() });
    expect(a).toMatchObject({
      state: 'blocked',
      httpStatus: 403,
      provider: 'Cloudflare',
      requestId: 'a4247cce6ca2b745-SOF',
      ipVersion: 6,
      bodySnippet: 'Access denied',
    });
    expect(a.summary).toMatch(/bllokua për këtë klient/);
    expect(a.summary).toMatch(/s'provon/);
  });

  it('401/429 dhe challenge 503 (cf-mitigated) → blocked; 404/500 → http-error; 2xx → ok; pa përgjigje → unreachable', () => {
    const st = (status: number, headers: Record<string, string> = {}) =>
      classifyAccess({ status: 'ok', value: fetchResult({ status, headers }) }).state;
    expect(st(401)).toBe('blocked');
    expect(st(429)).toBe('blocked');
    expect(st(503, { 'cf-mitigated': 'challenge', server: 'cloudflare' })).toBe('blocked');
    expect(st(503)).toBe('http-error');
    expect(st(404)).toBe('http-error');
    expect(st(500)).toBe('http-error');
    expect(st(200)).toBe('ok');
    expect(classifyAccess({ status: 'error', error: 'Timeout', code: 'TIMEOUT' }).state).toBe('unreachable');
  });

  it('heq HTML nga trupi dhe e shkurton', () => {
    const a = classifyAccess({ status: 'ok', value: cloudflare403({ body: blockPageHtml, headers: { 'content-type': 'text/html', server: 'cloudflare' } }) });
    expect(a.bodySnippet).toBe('Attention Required! | Cloudflare Sorry, you have been blocked');
  });
});

describe('Faqja hyrëse kthen 403 (bllokim për klientin e auditimit)', () => {
  it('Availability: HOMEPAGE_ACCESS_DENIED high, jo critical, kërkon verifikim, score null', () => {
    const r = runAvailability(
      blockedCtx({ lighthouse: { status: 'error', error: 'Lighthouse runtimeError ERRORED_DOCUMENT_REQUEST: … (Status code: 403)' } }),
    );
    expect(r.score).toBeNull();
    expect(r.status).toBe('skipped');
    expect(r.reason).toMatch(/bllokua për këtë klient \(HTTP 403\)/);
    expect(r.issues.map((i) => i.code)).toEqual(['HOMEPAGE_ACCESS_DENIED']);
    const i = r.issues[0]!;
    expect(i.severity).toBe('high');
    expect(i.confidence).toBeLessThan(0.7);
    expect(i.needsManualReview).toBe(true);
    expect(i.message).toMatch(/403 për kërkesën e auditimit \(Cloudflare\) — kërkon verifikim/);
    expect(i.fix).toMatch(/Security → Events/);
    expect(i.fix).toContain('a4247cce6ca2b745-SOF');
    const ev = i.evidence.map((e) => e.detected).join(' | ');
    expect(ev).toContain('request ID: a4247cce6ca2b745-SOF');
    expect(ev).toContain('lidhja: IPv6');
    expect(ev).toContain('trupi: "Access denied"');
    expect(ev).toContain('robots.txt: HTTP 403');
    expect(ev).toMatch(/Lighthouse .* mori gjithashtu HTTP 403/);
    // TTFB i përgjigjes 403 s'raportohet si TTFB i faqes
    expect(r.checks.find((c) => c.id === 'response-time')!.status).toBe('skipped');
  });

  it('SEO: s\'jep 100 (partial); faqja e bllokimit në HTML s\'analizohet; robots.txt 403 ≠ "nuk ekziston"', () => {
    const r = runTechnicalSeo(
      blockedCtx({ main: { status: 'ok', value: cloudflare403({ body: blockPageHtml, headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'x' } }) } }),
    );
    expect(r.score).toBeNull();
    expect(r.status).toBe('skipped');
    expect(r.issues).toEqual([]);
    for (const id of ['title', 'meta-description', 'h1', 'canonical', 'indexability', 'robots-txt']) {
      expect(r.checks.find((c) => c.id === id)!.status, id).toBe('skipped');
    }
    expect(r.checks.find((c) => c.id === 'robots-txt')!.reason).toMatch(/HTTP 403 për klientin e auditimit/);
    expect(r.checks.find((c) => c.id === 'title')!.reason).toMatch(/HTML-ja reale nuk u mor/);
  });

  it('Security: mungesat e header-ave në përgjigjen 403 s\'bëhen rekomandime; HTTPS/TLS vlerësohen', () => {
    const r = runSecurity(blockedCtx());
    const codes = r.issues.map((i) => i.code);
    for (const c of ['MISSING_HSTS', 'MISSING_CSP', 'MISSING_FRAME_PROTECTION', 'MISSING_X_CONTENT_TYPE_OPTIONS', 'SERVER_VERSION_DISCLOSURE']) {
      expect(codes).not.toContain(c);
    }
    expect(r.score).toBeNull();
    expect(r.reason).toMatch(/u vlerësuan vetëm HTTPS dhe TLS/);
    expect(r.checks.find((c) => c.id === 'hsts')!.reason).toMatch(/përgjigjes HTTP 403, jo faqes reale/);
    expect(r.checks.find((c) => c.id === 'https')!.status).toBe('pass');
    expect(r.checks.find((c) => c.id === 'tls-certificate')!.status).toBe('pass');
    // Një certifikatë e pavlefshme raportohet edhe kur faqja bllokon klientin
    const badTls = runSecurity(blockedCtx({ tls: { status: 'ok', value: { host: 'gjecaj.al', authorized: false, authorizationError: 'CERT_HAS_EXPIRED' } } }));
    expect(badTls.issues.map((i) => i.code)).toContain('TLS_CERT_INVALID');
  });

  it('http:// që kthen 403 pa ridrejtim → skipped, jo HTTP_NOT_REDIRECTED', () => {
    const r = runSecurity(
      makeCtx({ httpVariant: { status: 'ok', value: fetchResult({ requestedUrl: 'http://example.com/', finalUrl: 'http://example.com/', status: 403 }) } }),
    );
    expect(r.issues.map((i) => i.code)).not.toContain('HTTP_NOT_REDIRECTED');
    expect(r.checks.find((c) => c.id === 'http-redirect')!.status).toBe('skipped');
  });

  it('Health: PARTIAL, 0 critical, pa kufizim critical', () => {
    const results = runModules(blockedCtx());
    const issues = results.flatMap((r) => r.issues);
    const h = computeHealth(results, issues);
    expect(h.status).toBe('PARTIAL');
    expect(h.score).toBeNull();
    expect(h.critical).toBe(0);
    expect(h.modifiers).toEqual([]);
    expect(h.missingCategories).toEqual(expect.arrayContaining(['availability', 'seoTechnical', 'security']));
    expect(issues.map((i) => i.code)).toEqual(['HOMEPAGE_ACCESS_DENIED']);
  });
});

describe('Faqja hyrëse kthen 404/500 (gabim i serverit, jo bllokim)', () => {
  it('500 mbetet HOMEPAGE_HTTP_ERROR critical; SEO s\'ka score', () => {
    const ctx = makeCtx({ main: { status: 'ok', value: fetchResult({ status: 500, statusText: 'Internal Server Error', body: '<title>Error</title>' }) } });
    const a = runAvailability(ctx);
    expect(a.issues[0]).toMatchObject({ code: 'HOMEPAGE_HTTP_ERROR', severity: 'critical' });
    expect(a.issues[0]!.evidence[0]!.detected).toContain('HTTP 500');
    expect(runTechnicalSeo(ctx).score).toBeNull();
    expect(runSecurity(ctx).issues.map((i) => i.code)).not.toContain('MISSING_HSTS');
  });
});
