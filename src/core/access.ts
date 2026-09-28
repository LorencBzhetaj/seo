import net from 'node:net';
import type { FetchResult } from '../net/safe-fetch.js';
import type { Probe } from './context.js';

/**
 * A e mori auditi faqen reale?
 * - ok: 2xx, HTML/header-at përfaqësojnë faqen.
 * - blocked: 401/403/429 ose challenge (p.sh. cf-mitigated) — refuzim për KËTË klient,
 *   jo provë që faqja s'hapet për vizitorët (IP, IPv6, VPN, WAF, bot protection).
 * - http-error: jo-2xx tjetër (404, 5xx…) — faqja reale s'u mor.
 * - unreachable: s'pati përgjigje HTTP (DNS, timeout, TLS…).
 */
export type AccessState = 'ok' | 'blocked' | 'http-error' | 'unreachable';

export interface AccessInfo {
  state: AccessState;
  httpStatus?: number;
  /** Shërbimi përpara serverit, i nxjerrë nga header-at (p.sh. Cloudflare). */
  provider?: string;
  /** Identifikues kërkese për ta gjetur në log-et e provider-it (Cloudflare Ray ID). */
  requestId?: string;
  mitigated?: string;
  contentType?: string;
  /** Tekst i shkurtër i trupit të përgjigjes së bllokimit/gabimit (pa HTML). */
  bodySnippet?: string;
  /** Adresa e serverit/CDN-së ku u lidh klienti dhe versioni IP. */
  remoteAddress?: string;
  ipVersion?: 4 | 6;
  summary: string;
}

const BLOCK_STATUSES = new Set([401, 403, 429]);

function detectProvider(h: Record<string, string>): { provider?: string; requestId?: string } {
  if (h['cf-ray'] || /cloudflare/i.test(h.server ?? '')) return { provider: 'Cloudflare', requestId: h['cf-ray'] };
  if (h['x-sucuri-id']) return { provider: 'Sucuri', requestId: h['x-sucuri-id'] };
  if (/akamai/i.test(h.server ?? '')) return { provider: 'Akamai', requestId: h['x-akamai-request-id'] };
  if (h['x-amz-cf-id']) return { provider: 'Amazon CloudFront', requestId: h['x-amz-cf-id'] };
  if (h['x-served-by'] && h['x-fastly-request-id']) return { provider: 'Fastly', requestId: h['x-fastly-request-id'] };
  return { provider: h.server || undefined };
}

function textSnippet(body: string): string | undefined {
  const text = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

export function classifyAccess(main: Probe<FetchResult>): AccessInfo {
  if (main.status !== 'ok') {
    return { state: 'unreachable', summary: main.status === 'error' ? `Pa përgjigje HTTP: ${main.error}` : main.reason };
  }
  const res = main.value;
  const h = res.headers;
  const { provider, requestId } = detectProvider(h);
  const family = res.remoteAddress ? net.isIP(res.remoteAddress.replace(/^::ffff:/, '')) : 0;
  const base = {
    httpStatus: res.status,
    provider,
    requestId,
    mitigated: h['cf-mitigated'],
    contentType: h['content-type'],
    remoteAddress: res.remoteAddress,
    ipVersion: family === 4 || family === 6 ? (family as 4 | 6) : undefined,
  };
  if (isSuccess(res.status)) return { state: 'ok', ...base, summary: `HTTP ${res.status}` };

  const snippet = textSnippet(res.body);
  const via = [provider, requestId ? `ID ${requestId}` : '', base.ipVersion ? `lidhje IPv${base.ipVersion}` : ''].filter(Boolean).join(', ');
  const challenged = res.status === 503 && !!h['cf-mitigated'];
  if (BLOCK_STATUSES.has(res.status) || challenged) {
    return {
      state: 'blocked',
      ...base,
      bodySnippet: snippet,
      summary: `Auditi u bllokua për këtë klient: HTTP ${res.status}${via ? ` (${via})` : ''}. Kjo s'provon që faqja s'hapet për vizitorët.`,
    };
  }
  return {
    state: 'http-error',
    ...base,
    bodySnippet: snippet,
    summary: `Faqja hyrëse ktheu HTTP ${res.status}${via ? ` (${via})` : ''}.`,
  };
}

/** Evidence e përbashkët për përgjigjen jo-2xx, pa cookies/header-a sekretë. */
export function accessEvidenceText(a: AccessInfo): string {
  return [
    `HTTP ${a.httpStatus}`,
    a.provider ? `server/CDN: ${a.provider}` : '',
    a.requestId ? `request ID: ${a.requestId}` : '',
    a.mitigated ? `cf-mitigated: ${a.mitigated}` : '',
    a.contentType ? `content-type: ${a.contentType}` : '',
    a.bodySnippet ? `trupi: "${a.bodySnippet}"` : '',
    a.ipVersion ? `lidhja: IPv${a.ipVersion} → ${a.remoteAddress}` : '',
  ].filter(Boolean).join('; ');
}
