import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JobKind } from './jobs.js';

/**
 * Validimi i formularëve të nisjes. Nga këtu dalin vetëm argumente të sigurta për CLI-në (varg, pa shell).
 * Validimi i plotë mbetet te motori (url-guard, validateRepoUrl, kufijtë e klonimit): këtu kapen vetëm
 * gabimet e qarta, që përdoruesi të mos presë një proces që do të dështojë menjëherë.
 */

export interface AuditRequest {
  kind: JobKind;
  target: string;
  args: string[];
  options: string[];
}

export type Parsed = { ok: true; value: AuditRequest } | { ok: false; errors: string[] };

export const URL_DEFAULTS = { maxPages: 25, maxDepth: 3, lighthouseRuns: 1, lighthouse: true, crawl: true, business: true, quality: true, visual: true, saveLhr: false, ignoreRobots: false };
export const MAX_PAGES = 100;
export const MAX_DEPTH = 10;
/** I njëjti kufi si te motori (MAX_LIGHTHOUSE_RUNS); dashboard-i s'e importon motorin. */
export const MAX_LH_RUNS = 5;

type Form = Record<string, string | undefined>;
const on = (f: Form, k: string) => f[k] === 'on' || f[k] === '1';

function int(v: string | undefined, def: number, min: number, max: number, label: string, errors: string[]): number {
  if (v === undefined || v.trim() === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${label} duhet të jetë numër i plotë ${min}–${max}.`);
    return def;
  }
  return n;
}

export function parseUrlForm(f: Form): Parsed {
  const errors: string[] = [];
  const raw = (f.url ?? '').trim();
  let url: URL | undefined;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    errors.push('URL e pavlefshme.');
  }
  if (!raw) errors.push('Shkruaj URL-në e sitit.');
  else if (url && !['http:', 'https:'].includes(url.protocol)) errors.push('Lejohen vetëm http:// dhe https://.');
  else if (url && (url.username || url.password)) errors.push('URL-ja s\'duhet të ketë kredenciale.');
  if (raw.length > 2048) errors.push('URL-ja është tepër e gjatë.');
  const maxPages = int(f.maxPages, URL_DEFAULTS.maxPages, 1, MAX_PAGES, 'Faqet maksimale', errors);
  const maxDepth = int(f.maxDepth, URL_DEFAULTS.maxDepth, 0, MAX_DEPTH, 'Thellësia', errors);
  const lhRuns = int(f.lighthouseRuns, URL_DEFAULTS.lighthouseRuns, 1, MAX_LH_RUNS, 'Matjet Lighthouse', errors);
  if (errors.length || !url) return { ok: false, errors };
  const lighthouse = on(f, 'lighthouse');
  const crawl = on(f, 'crawl');
  const business = on(f, 'business');
  const quality = on(f, 'quality');
  const visual = on(f, 'visual') && lighthouse;
  const target = url.href;
  const args = [
    ...(crawl ? ['--max-pages', String(maxPages), '--max-depth', String(maxDepth)] : ['--no-crawl']),
    ...(lighthouse ? (lhRuns > 1 ? ['--lighthouse-runs', String(lhRuns)] : []) : ['--no-lighthouse']),
    ...(business ? [] : ['--no-business']),
    ...(quality ? [] : ['--no-quality']),
    ...(quality && !visual ? ['--no-visual'] : []),
    ...(on(f, 'saveLhr') && lighthouse ? ['--save-lhr'] : []),
    ...(on(f, 'ignoreRobots') ? ['--ignore-robots'] : []),
    '--',
    target,
  ];
  const options = [
    crawl ? `crawl: maks. ${maxPages} faqe, thellësi ${maxDepth}` : 'pa crawl (vetëm faqja hyrëse)',
    lighthouse ? (lhRuns > 1 ? `Lighthouse mobile: ${lhRuns} matje` : 'Lighthouse mobile: 1 matje') : 'pa Lighthouse',
    business ? 'biznes & privatësi' : 'pa biznes',
    quality ? (visual ? 'cilësia + pamja (desktop/mobile)' : 'cilësia (pa renderim)') : 'pa cilësi',
    ...(on(f, 'saveLhr') && lighthouse ? ['ruaj LHR'] : []),
    ...(on(f, 'ignoreRobots') ? ['⚠ anashkalon robots.txt'] : []),
  ];
  return { ok: true, value: { kind: 'url', target, args, options } };
}

export function parseRepoForm(f: Form): Parsed {
  const raw = (f.repo ?? '').trim();
  const errors: string[] = [];
  if (!raw) errors.push('Shkruaj URL-në e repo-s publike.');
  else if (raw.length > 500) errors.push('URL-ja është tepër e gjatë.');
  else if (!/^https:\/\//i.test(raw)) errors.push('Lejohet vetëm https:// (pa SSH, git://, file://).');
  else {
    try {
      const u = new URL(raw);
      if (u.username || u.password) errors.push('Pa kredenciale në URL: repo private s\'mbështeten.');
    } catch {
      errors.push('URL e pavlefshme.');
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { kind: 'repo', target: raw, args: ['--repo', raw], options: ['klon i cekët (depth 1), pa skripte/hooks/LFS', 'kufijtë ekzistues të klonimit (madhësia, koha)', 'dosja e përkohshme fshihet pas auditit'] } };
}

export interface FolderCheck {
  ok: boolean;
  errors: string[];
  /** Shtegu real (pas symlink/junction) që do të lexohet. */
  realPath?: string;
  entries?: { count: number; sample: string[] };
}

function systemRoots(): string[] {
  if (process.platform === 'win32') {
    const env = (k: string) => process.env[k];
    return [env('SystemRoot') ?? 'C:\\Windows', env('ProgramFiles') ?? 'C:\\Program Files', env('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)', env('ProgramData') ?? 'C:\\ProgramData'].filter(Boolean);
  }
  return ['/etc', '/usr', '/bin', '/sbin', '/boot', '/dev', '/proc', '/sys', '/var', '/lib', '/System', '/Library', '/private'];
}

const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child: string, parent: string) => {
  const r = path.relative(parent, child);
  return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r));
};

/**
 * Dosja që do të auditohet: shteg absolut lokal, ekzistues, dosje. Shfaqet shtegu real që do të lexohet.
 * Refuzohen: shtigje rrjeti (\\server\share — në Windows mund të dërgojnë kredencialet te një host tjetër),
 * shtigje pajisjesh (\\?\, \\.\), rrënja e diskut, dosja e përdoruesit si e tërë dhe dosjet e sistemit.
 */
export function checkFolder(input: string | undefined): FolderCheck {
  const raw = (input ?? '').trim().replace(/^"(.*)"$/, '$1');
  const fail = (e: string): FolderCheck => ({ ok: false, errors: [e] });
  if (!raw) return fail('Shkruaj shtegun e plotë të dosjes.');
  if (raw.length > 1000 || raw.includes('\0')) return fail('Shteg i pavlefshëm.');
  if (/^[\\/]{2}/.test(raw)) return fail('Shtigjet e rrjetit (\\\\server\\share) dhe të pajisjeve s\'lejohen: vetëm dosje lokale.');
  if (!path.isAbsolute(raw) || (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(raw))) return fail('Shkruaj shtegun absolut (p.sh. C:\\Projekte\\siti im), jo relativ.');
  let real: string;
  try {
    real = fs.realpathSync.native(raw);
  } catch {
    return fail(`Dosja s'u gjet: ${raw}`);
  }
  if (/^[\\/]{2}/.test(real)) return fail('Dosja çon në një shteg rrjeti: s\'lejohet.');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    return fail(`Dosja s'lexohet: ${real}`);
  }
  if (!stat.isDirectory()) return fail(`S'është dosje: ${real}`);
  if (same(path.parse(real).root, real) || same(path.parse(real).root, `${real}${path.sep}`)) return fail('Rrënja e diskut s\'auditohet: zgjidh dosjen e projektit.');
  if (same(real, os.homedir())) return fail('Dosja e përdoruesit si e tërë s\'auditohet: zgjidh dosjen e projektit.');
  for (const sys of systemRoots()) if (same(real, sys) || inside(real.toLowerCase(), sys.toLowerCase())) return fail(`Dosjet e sistemit s'auditohen: ${sys}`);
  let names: string[] = [];
  try {
    names = fs.readdirSync(real);
  } catch {
    return fail(`Dosja s'lexohet: ${real}`);
  }
  return { ok: true, errors: [], realPath: real, entries: { count: names.length, sample: names.slice(0, 12) } };
}

export function folderRequest(realPath: string): AuditRequest {
  return { kind: 'folder', target: realPath, args: ['--folder', realPath], options: ['vetëm lexim skedarësh, pa ekzekutuar kod', 'kufijtë ekzistues (5000 skedarë, 2 MB/skedar, 300 MB)'] };
}
