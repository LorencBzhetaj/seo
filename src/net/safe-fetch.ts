import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import { assertUrlAllowed, BlockedUrlError, guardedLookup, isExplicitlyAllowed } from './url-guard.js';

export interface FetchOptions {
  timeout: number;
  maxResponseBytes: number;
  maxRedirects: number;
  userAgent: string;
  allowedPrivateHosts: readonly string[];
  followRedirects?: boolean;
  throttle?: HostThrottle;
  /**
   * Politikë për ridrejtimet: kthen arsyen pse hop-i i radhës s'duhet ndjekur (p.sh. robots,
   * URL e pasigurt, host tjetër), ose null. Kur ndalet, kthehet përgjigjja 3xx me `redirectNotFollowed`.
   */
  redirectPolicy?: (next: URL) => string | null;
  /**
   * Instrumentim (teste/diagnostikë): thirret kur një kërkesë lëshohet realisht (pas throttle-it)
   * dhe kur mbaron. `at` = Date.now(), e njëjta orë që përdor HostThrottle.
   */
  onDispatch?: (e: { phase: 'start' | 'end'; url: string; host: string; at: number }) => void;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  /** Header-at me emra me shkronja të vogla; cookie/auth hiqen (§13). */
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  bodyBytes: number;
  redirects: RedirectHop[];
  ttfbMs: number;
  totalMs: number;
  remoteAddress?: string;
  httpVersion: string;
  /** Ridrejtimi i fundit s'u ndoq sipas redirectPolicy (Location dhe arsyeja). */
  redirectNotFollowed?: { location: string; reason: string };
}

export type FetchErrorCode =
  | 'BLOCKED' | 'TIMEOUT' | 'DNS' | 'TLS' | 'NETWORK' | 'TOO_MANY_REDIRECTS' | 'REDIRECT_LOOP' | 'BAD_REDIRECT';

export class FetchError extends Error {
  constructor(
    message: string,
    readonly code: FetchErrorCode,
    readonly url: string,
    readonly redirects: RedirectHop[] = [],
    readonly causeCode?: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/** Vonesë minimale mes kërkesave drejt të njëjtit host. */
export class HostThrottle {
  /** Për çdo host: premtimi që zgjidhet me kohën reale kur u lëshua kërkesa e fundit. */
  private chain = new Map<string, Promise<number>>();
  constructor(readonly delayMs: number) {}
  /**
   * Radhë për host: çdo thirrje zë vendin sinkronisht dhe lëshohet ≥ `delayMs` pas kohës REALE
   * të lëshimit të mëparshëm (jo asaj të planifikuar), që një timer i vonuar të mos e ngushtojë
   * hapësirën me kërkesën pasardhëse — edhe me concurrency > 1.
   */
  async wait(host: string): Promise<void> {
    const prev = this.chain.get(host);
    const mine = (prev ?? Promise.resolve(Number.NEGATIVE_INFINITY)).then(async (prevAt) => {
      for (let remaining = prevAt + this.delayMs - Date.now(); remaining > 0; remaining = prevAt + this.delayMs - Date.now()) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      return Date.now();
    });
    this.chain.set(host, mine);
    await mine;
  }
}

const SENSITIVE_HEADERS = new Set(['set-cookie', 'cookie', 'authorization', 'proxy-authorization']);

export function sanitizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase();
    if (v === undefined) continue;
    if (SENSITIVE_HEADERS.has(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function classifyError(err: unknown, url: string, redirects: RedirectHop[]): FetchError {
  if (err instanceof FetchError) return err;
  if (err instanceof BlockedUrlError) return new FetchError(err.message, 'BLOCKED', url, redirects);
  const e = err as NodeJS.ErrnoException;
  const code = e?.code ?? '';
  if (code === 'EBLOCKEDADDRESS') return new FetchError(e.message, 'BLOCKED', url, redirects, code);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new FetchError(`DNS dështoi për ${url}: ${code}`, 'DNS', url, redirects, code);
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code) || /certificate/i.test(e?.message ?? '')) {
    return new FetchError(`Gabim TLS/certifikate: ${code || e.message}`, 'TLS', url, redirects, code);
  }
  return new FetchError(`Gabim rrjeti: ${e?.message ?? String(err)}`, 'NETWORK', url, redirects, code);
}

function decodeBody(buf: Buffer, contentType: string | undefined): string {
  const charset = /charset=([^;]+)/i.exec(contentType ?? '')?.[1]?.trim().replace(/["']/g, '');
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

interface SingleResponse {
  status: number;
  statusText: string;
  rawHeaders: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  ttfbMs: number;
  totalMs: number;
  remoteAddress?: string;
  httpVersion: string;
}

function requestOnce(url: URL, opts: FetchOptions, readBody: boolean): Promise<SingleResponse> {
  const allowPrivate = isExplicitlyAllowed(url, opts.allowedPrivateHosts);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': opts.userAgent,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'sq,en;q=0.8',
        },
        lookup: guardedLookup(allowPrivate) as unknown as typeof import('node:dns').lookup,
        timeout: opts.timeout,
        agent: false,
      },
      (res) => {
        const ttfbMs = performance.now() - started;
        const remoteAddress = res.socket?.remoteAddress;
        if (!readBody || (res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume();
          res.on('end', () => resolve(finish(Buffer.alloc(0), false)));
          res.on('error', reject);
          return;
        }
        let stream: Readable = res;
        const enc = (res.headers['content-encoding'] ?? '').toLowerCase();
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > opts.maxResponseBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, chunk.length - (size - opts.maxResponseBytes)));
            res.destroy();
            resolve(finish(Buffer.concat(chunks), true));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => resolve(finish(Buffer.concat(chunks), false)));
        stream.on('error', (e) => (truncated ? undefined : reject(e)));

        function finish(body: Buffer, trunc: boolean): SingleResponse {
          return {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            rawHeaders: res.headers,
            body,
            truncated: trunc,
            ttfbMs,
            totalMs: performance.now() - started,
            remoteAddress,
            httpVersion: res.httpVersion,
          };
        }
      },
    );
    req.on('timeout', () => {
      req.destroy(new FetchError(`Timeout pas ${opts.timeout} ms`, 'TIMEOUT', url.href));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET i sigurt: vetëm http(s), çdo hop i ridrejtimit ri-validohet,
 * adresat private refuzohen në lidhje, timeout dhe kufi madhësie.
 */
export async function safeFetch(input: string | URL, opts: FetchOptions): Promise<FetchResult> {
  const requestedUrl = typeof input === 'string' ? input : input.href;
  const redirects: RedirectHop[] = [];
  const seen = new Set<string>();
  const chainStart = performance.now();
  let current = new URL(requestedUrl);
  const follow = opts.followRedirects ?? true;

  for (let hop = 0; ; hop++) {
    try {
      assertUrlAllowed(current, opts.allowedPrivateHosts);
    } catch (err) {
      throw classifyError(err, current.href, redirects);
    }
    if (seen.has(current.href)) {
      throw new FetchError(`Cikël ridrejtimesh te ${current.href}`, 'REDIRECT_LOOP', requestedUrl, redirects);
    }
    seen.add(current.href);
    await opts.throttle?.wait(current.host);
    opts.onDispatch?.({ phase: 'start', url: current.href, host: current.host, at: Date.now() });

    let res: SingleResponse;
    try {
      res = await requestOnce(current, opts, true);
    } catch (err) {
      throw classifyError(err, current.href, redirects);
    } finally {
      opts.onDispatch?.({ phase: 'end', url: current.href, host: current.host, at: Date.now() });
    }

    const location = res.rawHeaders.location;
    if (follow && res.status >= 300 && res.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FetchError(`Location e pavlefshme: ${location}`, 'BAD_REDIRECT', current.href, redirects);
      }
      next.hash = '';
      redirects.push({ url: current.href, status: res.status, location: next.href });
      const veto = opts.redirectPolicy?.(next);
      if (veto) {
        const headers = sanitizeHeaders(res.rawHeaders);
        return {
          requestedUrl, finalUrl: current.href, status: res.status, statusText: res.statusText, headers, body: '', bodyTruncated: false, bodyBytes: 0,
          redirects, ttfbMs: Math.round(res.ttfbMs), totalMs: Math.round(performance.now() - chainStart), remoteAddress: res.remoteAddress,
          httpVersion: res.httpVersion, redirectNotFollowed: { location: next.href, reason: veto },
        };
      }
      if (hop + 1 > opts.maxRedirects) {
        throw new FetchError(`Më shumë se ${opts.maxRedirects} ridrejtime`, 'TOO_MANY_REDIRECTS', requestedUrl, redirects);
      }
      current = next;
      continue;
    }

    const headers = sanitizeHeaders(res.rawHeaders);
    return {
      requestedUrl,
      finalUrl: current.href,
      status: res.status,
      statusText: res.statusText,
      headers,
      body: decodeBody(res.body, headers['content-type']),
      bodyTruncated: res.truncated,
      bodyBytes: res.body.length,
      redirects,
      ttfbMs: Math.round(res.ttfbMs),
      totalMs: Math.round(performance.now() - chainStart),
      remoteAddress: res.remoteAddress,
      httpVersion: res.httpVersion,
    };
  }
}
