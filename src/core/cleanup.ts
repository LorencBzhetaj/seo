import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Burimet e përkohshme të një auditi (Chrome headless, profili i tij në %TEMP%, kloni i repo-s, procesi git,
 * screenshot-et e pjesshme). Çdo burim regjistrohet sa është gjallë dhe çregjistrohet kur lirohet normalisht;
 * kur auditi ndërpritet (anulim nga dashboard-i, mbyllje e tij, Ctrl+C), `runCleanups()` i liron të gjitha,
 * nga i fundit te i pari, para se procesi të dalë.
 */
type Cleanup = () => unknown;
const active = new Set<Cleanup>();
let aborting = false;

/** Regjistron një pastrim; kthen funksionin që e çregjistron (pa e ekzekutuar). */
export function registerCleanup(fn: Cleanup): () => void {
  active.add(fn);
  return () => active.delete(fn);
}

/** Ekzekuton pastrimet aktive (secili me kufi kohe, gabimet injorohen). */
export async function runCleanups(timeoutMs = 5000): Promise<void> {
  aborting = true;
  const fns = [...active].reverse();
  active.clear();
  for (const fn of fns) {
    await Promise.race([Promise.resolve().then(fn).catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}

export function activeCleanups(): number {
  return active.size;
}

/** True pasi nisi ndërprerja: një burim që u krijua ndërkohë (p.sh. Chrome ende duke u nisur) lirohet menjëherë. */
export function isAborting(): boolean {
  return aborting;
}

/** Mbështjell një pastrim që të ekzekutohet vetëm një herë (nga `finally` ose nga ndërprerja, cilido vjen i pari). */
export function once(fn: () => Promise<void>): () => Promise<void> {
  let p: Promise<void> | undefined;
  return () => (p ??= fn());
}

/** Prefiksi i të gjitha dosjeve të përkohshme të motorit në dosjen temp të sistemit. */
export const TEMP_PREFIX = 'website-auditor-';
/** Mbetje më të vjetra se kaq (nga një ndalim i detyruar, p.sh. procesi u vra) fshihen nga auditi i radhës. */
export const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

/**
 * Fshin dosjet `website-auditor-*` në temp që s'janë prekur prej më shumë se 24 orësh. Asnjë audit s'zgjat
 * kaq, pra s'janë në përdorim; dosjet e kyçura (p.sh. Chrome ende gjallë) anashkalohen.
 */
export function sweepStaleTemp(dir = os.tmpdir(), now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.lstatSync(full);
      if (!st.isDirectory() || now - st.mtimeMs < STALE_TEMP_MS) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(name);
    } catch {
      /* e kyçur ose pa leje: mbetet për herën tjetër */
    }
  }
  return removed;
}

/**
 * Screenshot-et i përkasin një raporti. Dosjet `visual/<ekzekutim>` më të vjetra se 24 orë që s'i referon
 * asnjë raport (mbetje nga një ndalim i detyruar i motorit) fshihen; ato me raport s'preken kurrë.
 */
export function sweepOrphanShots(outputDir: string, now = Date.now()): string[] {
  const visualDir = path.join(outputDir, 'visual');
  let candidates: string[];
  try {
    candidates = fs.readdirSync(visualDir).filter((n) => {
      try {
        const st = fs.lstatSync(path.join(visualDir, n));
        return st.isDirectory() && now - st.mtimeMs >= STALE_TEMP_MS;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
  if (!candidates.length) return [];
  const referenced = new Set<string>();
  for (const f of fs.readdirSync(outputDir)) {
    if (!f.endsWith('.json') || f.endsWith('.lhr.json')) continue;
    try {
      const m = /"screenshotsDir":\s*"visual\/([^"]+)"/.exec(fs.readFileSync(path.join(outputDir, f), 'utf8'));
      if (m) referenced.add(m[1]!);
    } catch {
      /* raport i palexueshëm: s'ndikon */
    }
  }
  const removed: string[] = [];
  for (const n of candidates) {
    if (referenced.has(n)) continue;
    try {
      fs.rmSync(path.join(visualDir, n), { recursive: true, force: true });
      removed.push(n);
    } catch {
      /* mbetet për herën tjetër */
    }
  }
  return removed;
}
