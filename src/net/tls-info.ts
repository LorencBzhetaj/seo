import tls from 'node:tls';
import { assertUrlAllowed, guardedLookup, isExplicitlyAllowed } from './url-guard.js';

export interface TlsInfo {
  host: string;
  authorized: boolean;
  authorizationError?: string;
  protocol?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  issuer?: string;
  subject?: string;
  subjectAltNames?: string;
}

/** Lexon certifikatën lokalisht (pa shërbim të jashtëm). Nuk dërgon asnjë kërkesë HTTP. */
export function inspectTls(url: URL, timeout: number, allowedPrivateHosts: readonly string[]): Promise<TlsInfo> {
  assertUrlAllowed(url, allowedPrivateHosts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || 443);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: /^[\d.]+$|:/.test(host) ? undefined : host,
      rejectUnauthorized: false, // e lexojmë certifikatën edhe kur është e pavlefshme, që ta raportojmë
      lookup: guardedLookup(isExplicitlyAllowed(url, allowedPrivateHosts)) as unknown as typeof import('node:dns').lookup,
      timeout,
    });
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : undefined;
      const info: TlsInfo = {
        host,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        protocol: socket.getProtocol() ?? undefined,
        validFrom: cert?.valid_from ? new Date(cert.valid_from).toISOString() : undefined,
        validTo: validTo?.toISOString(),
        daysRemaining: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : undefined,
        issuer: cert?.issuer ? [cert.issuer.O, cert.issuer.CN].flat().filter(Boolean).join(' / ') : undefined,
        subject: [cert?.subject?.CN].flat().join(', ') || undefined,
        subjectAltNames: cert?.subjectaltname?.slice(0, 300),
      };
      socket.end();
      resolve(info);
    });
    socket.once('timeout', () => socket.destroy(new Error(`TLS timeout pas ${timeout} ms`)));
    socket.once('error', reject);
  });
}
