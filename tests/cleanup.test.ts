import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeCleanups, once, registerCleanup, runCleanups, STALE_TEMP_MS, sweepOrphanShots, sweepStaleTemp } from '../src/core/cleanup.js';

describe('Pastrimi i burimeve të përkohshme', () => {
  it('runCleanups: ekzekuton vetëm të regjistruarat, nga e fundit te e para; të çregjistruarat jo', async () => {
    const calls: string[] = [];
    registerCleanup(() => calls.push('profili'));
    const off = registerCleanup(() => calls.push('i liruar normalisht'));
    registerCleanup(async () => {
      calls.push('chrome');
    });
    off();
    await runCleanups();
    expect(calls).toEqual(['chrome', 'profili']);
    expect(activeCleanups()).toBe(0);
  });

  it('një pastrim që ngec ose hedh gabim s\'i bllokon të tjerët', async () => {
    const calls: string[] = [];
    registerCleanup(() => calls.push('i pari'));
    registerCleanup(() => {
      throw new Error('EPERM');
    });
    registerCleanup(() => new Promise(() => {}));
    await runCleanups(50);
    expect(calls).toEqual(['i pari']);
  });

  it('once: finally dhe ndërprerja s\'e lirojnë dy herë të njëjtin burim', async () => {
    let n = 0;
    const release = once(async () => {
      n++;
    });
    await Promise.all([release(), release()]);
    await release();
    expect(n).toBe(1);
  });

  it('sweepStaleTemp: fshin vetëm dosjet website-auditor-* më të vjetra se 24 orë', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
    try {
      for (const n of ['website-auditor-chrome-old', 'website-auditor-visual-new', 'tjeter-old']) fs.mkdirSync(path.join(dir, n));
      fs.writeFileSync(path.join(dir, 'website-auditor-file-old'), '');
      const old = new Date(Date.now() - STALE_TEMP_MS - 60_000);
      for (const n of ['website-auditor-chrome-old', 'tjeter-old', 'website-auditor-file-old']) fs.utimesSync(path.join(dir, n), old, old);
      expect(sweepStaleTemp(dir)).toEqual(['website-auditor-chrome-old']);
      expect(fs.readdirSync(dir).sort()).toEqual(['tjeter-old', 'website-auditor-file-old', 'website-auditor-visual-new']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweepOrphanShots: fshin vetëm screenshot-et pa raport dhe më të vjetra se 24 orë', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-shots-'));
    try {
      for (const n of ['me-raport', 'pa-raport-vjeter', 'pa-raport-i-ri']) {
        fs.mkdirSync(path.join(out, 'visual', n), { recursive: true });
        fs.writeFileSync(path.join(out, 'visual', n, '1-desktop.jpg'), 'x');
      }
      fs.writeFileSync(path.join(out, 'site-1.json'), JSON.stringify({ quality: { visual: { screenshotsDir: 'visual/me-raport' } } }, null, 2));
      const old = new Date(Date.now() - STALE_TEMP_MS - 60_000);
      for (const n of ['me-raport', 'pa-raport-vjeter']) fs.utimesSync(path.join(out, 'visual', n), old, old);
      expect(sweepOrphanShots(out)).toEqual(['pa-raport-vjeter']);
      expect(fs.readdirSync(path.join(out, 'visual')).sort()).toEqual(['me-raport', 'pa-raport-i-ri']);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
