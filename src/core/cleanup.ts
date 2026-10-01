import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeSync } from './fsutil.js';

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

/** Ekzekuton pastrimet aktive (secili me kufi kohe, gabimet injorohen). taskkill i Chrome-it zgjat ndonjëherë mbi 5 s. */
export async function runCleanups(timeoutMs = 15_000): Promise<void> {
  aborting = true;
  // Deri sa të mos mbetet asgjë: edhe burimet e regjistruara gjatë ndërprerjes (p.sh. një provë e dytë e
  // Lighthouse që po nisej) lirohen para se procesi të dalë.
  while (active.size) {
    const fn = [...active].pop()!;
    active.delete(fn);
    await Promise.race([Promise.resolve().then(fn).catch(() => undefined), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}

/** Hidhet kur një burim i ri (Chrome, profil) do të nisej pasi ndërprerja ka filluar. */
export class AbortedError extends Error {
  constructor() {
    super('Auditi u ndërpre');
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
      removeSync(full);
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
      removeSync(path.join(visualDir, n));
      removed.push(n);
    } catch {
      /* mbetet për herën tjetër */
    }
  }
  return removed;
}

/** Pret që një proces (p.sh. Chrome pas kill()) të dalë vërtet, që skedarët e tij të lirohen; maks. `ms`. */
export function waitForExit(child: { exitCode: number | null; signalCode?: string | null; once(e: 'exit', f: () => void): unknown } | undefined, ms = 3000): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Dosja e përkohshme e programit të instaluar (%LOCALAPPDATA%\SEO Tool\tmp) përdoret vetëm nga auditet e tij.
 * Kur programi hapet dhe s'ka instancë tjetër, gjithçka brenda saj është mbetje: fshihet.
 */
export function clearOwnTemp(dir: string): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const n of names) {
    try {
      removeSync(path.join(dir, n), { retries: 2, retryDelayMs: 200 });
      removed.push(n);
    } catch {
      /* i kyçur: mbetet për hapjen tjetër */
    }
  }
  return removed;
}
