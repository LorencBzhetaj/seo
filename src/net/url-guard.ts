import dns from 'node:dns';
import net from 'node:net';

/** URL ose adresë e ndaluar sipas §13 (vetëm http(s), pa localhost/IP private). */
export class BlockedUrlError extends Error {
  constructor(message: string, readonly url?: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

const blockList = new net.BlockList();
// IPv4: "this network", private, CGNAT, loopback, link-local, dokumentim/benchmark, multicast, rezervuar
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  blockList.addSubnet(addr, prefix, 'ipv4');
}
// IPv6: unspecified, loopback, NAT64 local-use, ULA, link-local, multicast, dokumentim
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b:1::', 48], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32],
] as const) {
  blockList.addSubnet(addr, prefix, 'ipv6');
}

export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, 'ipv4');
  if (family === 6) return blockList.check(ip, 'ipv6');
  return true; // jo IP e vlefshme → trajtohet si e ndaluar
}

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function hostKey(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${stripBrackets(url.hostname)}:${port}`;
}

/** Lejim eksplicit (vetëm fixtures): "127.0.0.1:4321" ose "127.0.0.1". */
export function isExplicitlyAllowed(url: URL, allowedPrivateHosts: readonly string[]): boolean {
  if (allowedPrivateHosts.length === 0) return false;
  const key = hostKey(url);
  const host = stripBrackets(url.hostname);
  return allowedPrivateHosts.some((a) => a === key || a === host);
}

/** Normalizon inputin e përdoruesit: shton https:// kur mungon skema, heq #fragment. */
export function normalizeInputUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new BlockedUrlError('URL bosh');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BlockedUrlError(`URL e pavlefshme: ${input}`);
  }
  url.hash = '';
  return url;
}

/**
 * Validim sintaksor + IP literale. Rezolucioni DNS kontrollohet veçmas në lidhje
 * (guardedLookup), që të mos lejohet DNS rebinding mes kontrollit dhe lidhjes.
 */
export function assertUrlAllowed(url: URL, allowedPrivateHosts: readonly string[] = []): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`Lejohen vetëm http(s); u mor "${url.protocol}"`, url.href);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URL me kredenciale (user:pass@) nuk lejohet', url.origin);
  }
  if (!url.hostname) throw new BlockedUrlError('URL pa host', url.href);
  if (isExplicitlyAllowed(url, allowedPrivateHosts)) return;

  const host = stripBrackets(url.hostname).toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new BlockedUrlError(`Host lokal i bllokuar: ${host}`, url.href);
  }
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new BlockedUrlError(`IP private/lokale e bllokuar: ${host}`, url.href);
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * Lookup për http/https/net që refuzon adresat private në momentin e lidhjes.
 * `allowPrivate` përdoret vetëm kur hosti është lejuar eksplicit.
 */
export function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, []);
      const list = addresses as dns.LookupAddress[];
      const blocked = list.filter((a) => isBlockedIp(a.address));
      if (!allowPrivate && blocked.length > 0) {
        const e = new BlockedUrlError(
          `${hostname} rezolvohet në adresë private/lokale (${blocked.map((b) => b.address).join(', ')})`,
        ) as BlockedUrlError & NodeJS.ErrnoException;
        e.code = 'EBLOCKEDADDRESS';
        return callback(e, []);
      }
      if (list.length === 0) return callback(Object.assign(new Error(`Asnjë adresë për ${hostname}`), { code: 'ENOTFOUND' }), []);
      if (options.all) return callback(null, list);
      const first = list[0]!;
      callback(null, first.address, first.family);
    });
  };
}
