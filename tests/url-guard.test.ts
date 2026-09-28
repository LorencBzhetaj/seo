import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, BlockedUrlError, isBlockedIp, normalizeInputUrl } from '../src/net/url-guard.js';

describe('normalizeInputUrl', () => {
  it('shton https:// kur mungon skema dhe heq #fragment', () => {
    expect(normalizeInputUrl('example.com/a#x').href).toBe('https://example.com/a');
  });
  it('refuzon input bosh ose të pavlefshëm', () => {
    expect(() => normalizeInputUrl('   ')).toThrow(BlockedUrlError);
    expect(() => normalizeInputUrl('http://')).toThrow(BlockedUrlError);
  });
});

describe('assertUrlAllowed', () => {
  const blocked = [
    'file:///etc/passwd',
    'ftp://example.com/',
    'javascript:alert(1)',
    'http://localhost/',
    'http://app.localhost:3000/',
    'http://127.0.0.1/',
    'http://2130706433/', // 127.0.0.1 në formë decimale → URL parser e normalizon
    'http://0x7f.1/',
    'http://10.0.0.5/',
    'http://172.16.3.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd12::1]/',
    'https://user:pass@example.com/',
  ];
  for (const u of blocked) {
    it(`bllokon ${u}`, () => {
      expect(() => assertUrlAllowed(new URL(u))).toThrow(BlockedUrlError);
    });
  }

  it('lejon URL publike http(s)', () => {
    expect(() => assertUrlAllowed(new URL('https://example.com/path?q=1'))).not.toThrow();
    expect(() => assertUrlAllowed(new URL('http://93.184.216.34/'))).not.toThrow();
  });

  it('lejon host lokal vetëm kur është në listën eksplicite (fixtures)', () => {
    expect(() => assertUrlAllowed(new URL('http://127.0.0.1:4321/'), ['127.0.0.1:4321'])).not.toThrow();
    expect(() => assertUrlAllowed(new URL('http://127.0.0.1:9999/'), ['127.0.0.1:4321'])).toThrow(BlockedUrlError);
  });
});

describe('isBlockedIp', () => {
  it('klasifikon saktë IP publike vs private', () => {
    // 172.66.x është publik (Cloudflare) — jashtë 172.16.0.0/12
    for (const ip of ['172.66.147.243', '104.20.23.154', '8.8.8.8', '2606:4700::1', '::ffff:8.8.8.8']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.31.255.255', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:7f00:1', 'not-an-ip']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
});
