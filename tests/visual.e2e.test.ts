import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { analyzeVisual } from '../src/quality/visual.js';
import { captureVisual } from '../src/visual/capture.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'quality-site');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
let server: http.Server;
let host = '';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-e2e-'));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(out, { recursive: true, force: true });
});

describe('Identiteti vizual me Chrome real (desktop + mobile, përmes guard proxy)', () => {
  it.runIf(process.env.RUN_LIGHTHOUSE_TESTS === '1')('faqja shabllon jep sinjale; faqja e pastër jo; screenshot-e; SSRF bllokohet', async () => {
    const cfg = { ...DEFAULT_CONFIG, allowedPrivateHosts: [host], requestDelay: 50 };
    const pages = [['/', 'home'], ['/i-paster.html', 'rooms'], ['/overflow.html', 'contact'], ['/ssrf.html', 'about']] as const;
    const v = await captureVisual(pages.map(([p, t]) => ({ url: `http://${host}${p}`, pageType: t })), cfg, out, 'e2e');
    expect(v.captures.map((c) => `${c.viewport}:${c.status}`)).toEqual(Array(4).fill(['desktop:ok', 'mobile:ok']).flat());
    for (const c of v.captures) {
      const file = path.join(out, c.screenshot!);
      expect(fs.readFileSync(file).subarray(0, 2).toString('hex'), c.screenshot).toBe('ffd8'); // JPEG
    }
    const a = analyzeVisual(v.captures);
    const at = (p: string) => a.signals.filter((s) => s.target === `http://${host}${p}`).map((s) => s.code).sort();
    expect(at('/')).toEqual(['GRADIENT_HEAVY', 'MOBILE_HORIZONTAL_OVERFLOW', 'PLACEHOLDER_IMAGE', 'UNIFORM_ICON_CARDS']);
    expect(at('/i-paster.html')).toEqual([]); // një gradient + karta me foto: s'raportohet
    expect(at('/overflow.html')).toEqual(['MOBILE_HORIZONTAL_OVERFLOW']);
    expect(v.blockedRequests.some((b) => b.url.includes('169.254.169.254'))).toBe(true);
  }, 180_000);
});
