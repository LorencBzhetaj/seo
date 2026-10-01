import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeSync } from '../src/core/fsutil.js';
import { activeCleanups, clearOwnTemp, once, registerCleanup, runCleanups, STALE_TEMP_MS, sweepOrphanShots, sweepStaleTemp, waitForExit } from '../src/core/cleanup.js';

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

  it('runCleanups liron edhe burimet e regjistruara gjatë ndërprerjes (p.sh. prova e dytë e Lighthouse)', async () => {
    const calls: string[] = [];
    registerCleanup(async () => {
      calls.push('i pari');
      // ndërkohë nis një burim i ri
      registerCleanup(() => calls.push('i regjistruar gjatë pastrimit'));
    });
    await runCleanups();
    expect(calls).toEqual(['i pari', 'i regjistruar gjatë pastrimit']);
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

  it('clearOwnTemp: zbraz dosjen tmp të programit; waitForExit pret daljen e procesit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-tmp-'));
    try {
      fs.mkdirSync(path.join(dir, 'website-auditor-visual-x'));
      fs.writeFileSync(path.join(dir, 'chrome_Unpacker_1'), 'x');
      expect(clearOwnTemp(dir).sort()).toEqual(['chrome_Unpacker_1', 'website-auditor-visual-x']);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
    const t0 = Date.now();
    await waitForExit(child, 5000);
    expect(child.exitCode).toBe(0);
    expect(Date.now() - t0).toBeLessThan(4000);
    await waitForExit(child, 5000); // tashmë ka dalë: kthehet menjëherë
  });

  it('removeSync: fshin edhe shtigje me ë/ç dhe skedarë read-only (fs.rmSync i Node 24 s\'i fshin në Windows)', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fshirje-'));
    const dir = path.join(base, 'Programe ë ç', 'SEO Tool');
    fs.mkdirSync(path.join(dir, 'app', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'app', 'dist', 'i-vjeter.js'), 'x');
    const ro = path.join(dir, 'objekt-git');
    fs.writeFileSync(ro, 'x');
    fs.chmodSync(ro, 0o444);
    removeSync(path.join(dir, 'app', 'dist', 'i-vjeter.js'));
    expect(fs.existsSync(path.join(dir, 'app', 'dist', 'i-vjeter.js'))).toBe(false);
    removeSync(dir);
    expect(fs.existsSync(dir)).toBe(false);
    removeSync(path.join(base, 's-ekziston')); // pa gabim
    removeSync(base);
    expect(fs.existsSync(base)).toBe(false);
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
