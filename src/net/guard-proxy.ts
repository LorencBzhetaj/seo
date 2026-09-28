import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { assertUrlAllowed, guardedLookup, isExplicitlyAllowed } from './url-guard.js';

export interface GuardProxy {
  port: number;
  /** Kërkesa të browser-it të bllokuara (localhost/IP private), për raportim. */
  blocked: { url: string; reason: string }[];
  close(): Promise<void>;
}

const HOP_HEADERS = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'te', 'trailer', 'upgrade'];

/**
 * Proxy lokal (vetëm 127.0.0.1) përmes të cilit kalon Chrome i Lighthouse:
 * çdo navigim/ridrejtim/nënburim drejt localhost ose IP private refuzohet (§13),
 * duke kontrolluar adresën e rezolvuar në momentin e lidhjes.
 */
export async function startGuardProxy(allowedPrivateHosts: readonly string[]): Promise<GuardProxy> {
  const blocked: GuardProxy['blocked'] = [];
  const sockets = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
      assertUrlAllowed(target, allowedPrivateHosts);
    } catch (err) {
      blocked.push({ url: req.url ?? '', reason: (err as Error).message });
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Blocked by website-auditor guard proxy');
      return;
    }
    const headers = { ...req.headers };
    for (const h of HOP_HEADERS) delete headers[h];
    const upstream = http.request(
      target,
      { method: req.method, headers, lookup: guardedLookup(isExplicitlyAllowed(target, allowedPrivateHosts)) as never },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EBLOCKEDADDRESS') blocked.push({ url: target.href, reason: err.message });
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end();
    });
    req.pipe(upstream);
  });

  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    const deny = (reason: string) => {
      blocked.push({ url: `https://${req.url}`, reason });
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    };
    let target: URL;
    try {
      target = new URL(`https://${req.url}`);
      assertUrlAllowed(target, allowedPrivateHosts);
    } catch (err) {
      deny((err as Error).message);
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = Number(target.port || 443);
    const connect = (address: string) => {
      const upstream = net.connect(port, address, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => client.destroy());
    };
    if (net.isIP(host)) return connect(host);
    guardedLookup(isExplicitlyAllowed(target, allowedPrivateHosts))(host, {}, (err, address) => {
      if (err?.code === 'EBLOCKEDADDRESS') return deny(err.message);
      if (err) return void client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      connect(address as string);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    blocked,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
