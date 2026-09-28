import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchError, safeFetch, type FetchOptions } from '../src/net/safe-fetch.js';
import { startGuardProxy } from '../src/net/guard-proxy.js';

let server: http.Server;
let port = 0;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    switch (u.pathname) {
      case '/ok':
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'session=secret', 'x-test': 'yes' }).end('<h1>ok</h1>');
        break;
      case '/to-localhost':
        res.writeHead(302, { location: `http://localhost:${port}/ok` }).end();
        break;
      case '/to-metadata':
        res.writeHead(301, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
        break;
      case '/to-file':
        res.writeHead(301, { location: 'file:///etc/passwd' }).end();
        break;
      case '/loop':
        res.writeHead(301, { location: '/loop' }).end();
        break;
      case '/chain': {
        const n = Number(u.searchParams.get('n') ?? 0);
        res.writeHead(301, { location: `/chain?n=${n + 1}` }).end();
        break;
      }
      case '/gzip':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' }).end(zlib.gzipSync('<p>çë gzip</p>'));
        break;
      case '/big':
        res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(50_000));
        break;
      case '/slow':
        setTimeout(() => res.writeHead(200).end('late'), 2000);
        break;
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const opts = (over: Partial<FetchOptions> = {}): FetchOptions => ({
  timeout: 1500,
  maxResponseBytes: 10_000,
  maxRedirects: 5,
  userAgent: 'test',
  allowedPrivateHosts: [`127.0.0.1:${port}`],
  ...over,
});

async function fetchError(url: string, o = opts()): Promise<FetchError> {
  try {
    await safeFetch(url, o);
  } catch (e) {
    return e as FetchError;
  }
  throw new Error('pritej gabim');
}

describe('safeFetch', () => {
  it('merr faqen, heq cookie nga header-at e ruajtura', async () => {
    const r = await safeFetch(`${base}/ok`, opts());
    expect(r.status).toBe(200);
    expect(r.body).toBe('<h1>ok</h1>');
    expect(r.headers['x-test']).toBe('yes');
    expect(r.headers['set-cookie']).toBe('[redacted]');
  });

  it('bllokon host lokal pa lejim eksplicit', async () => {
    const e = await fetchError(`${base}/ok`, opts({ allowedPrivateHosts: [] }));
    expect(e.code).toBe('BLOCKED');
  });

  it('bllokon ridrejtimin drejt localhost / IP metadata / file:', async () => {
    for (const path of ['/to-localhost', '/to-metadata', '/to-file']) {
      const e = await fetchError(`${base}${path}`);
      expect(e.code, path).toBe('BLOCKED');
      expect(e.redirects).toHaveLength(1);
    }
  });

  it('zbulon ciklin e ridrejtimeve dhe kufirin e hop-eve', async () => {
    expect((await fetchError(`${base}/loop`)).code).toBe('REDIRECT_LOOP');
    const e = await fetchError(`${base}/chain`);
    expect(e.code).toBe('TOO_MANY_REDIRECTS');
    expect(e.redirects.length).toBe(6);
  });

  it('dekompreson gzip dhe dekodon charset', async () => {
    const r = await safeFetch(`${base}/gzip`, opts());
    expect(r.body).toBe('<p>çë gzip</p>');
  });

  it('respekton kufirin e madhësisë', async () => {
    const r = await safeFetch(`${base}/big`, opts());
    expect(r.bodyTruncated).toBe(true);
    expect(r.bodyBytes).toBe(10_000);
  });

  it('timeout → FetchError TIMEOUT', async () => {
    const e = await fetchError(`${base}/slow`, opts({ timeout: 300 }));
    expect(e.code).toBe('TIMEOUT');
  });
});

function connectThroughProxy(proxyPort: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxyPort, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.once('data', (d) => {
      resolve(d.toString().split('\r\n')[0]!);
      s.destroy();
    });
    s.on('error', reject);
  });
}

function getThroughProxy(proxyPort: number, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: url, headers: { host: new URL(url).host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Guard proxy i browser-it (Lighthouse)', () => {
  it('refuzon CONNECT dhe GET drejt adresave lokale dhe i regjistron', async () => {
    const proxy = await startGuardProxy([]);
    try {
      expect(await connectThroughProxy(proxy.port, `127.0.0.1:${port}`)).toBe('HTTP/1.1 403 Forbidden');
      expect(await connectThroughProxy(proxy.port, '169.254.169.254:443')).toBe('HTTP/1.1 403 Forbidden');
      expect(await getThroughProxy(proxy.port, `${base}/ok`)).toBe(403);
      expect(proxy.blocked.length).toBe(3);
    } finally {
      await proxy.close();
    }
  });

  it('lejon hostin lokal vetëm kur është në listën eksplicite', async () => {
    const proxy = await startGuardProxy([`127.0.0.1:${port}`]);
    try {
      expect(await connectThroughProxy(proxy.port, `127.0.0.1:${port}`)).toBe('HTTP/1.1 200 Connection Established');
      expect(await getThroughProxy(proxy.port, `${base}/ok`)).toBe(200);
      expect(proxy.blocked).toEqual([]);
    } finally {
      await proxy.close();
    }
  });
});
