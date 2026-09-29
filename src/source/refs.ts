import path from 'node:path';
import type { FileEntry } from './types.js';

/** Indeks i skedarëve për kontroll ekzistence të saktë (edhe kur FS-i s'dallon shkronjat, si në Windows). */
export interface FileIndex {
  exact: Set<string>;
  /** path me shkronja të vogla → path real (për "case mismatch": punon në Windows, prishet në Linux). */
  lower: Map<string, string>;
  dirs: Set<string>;
}

export function buildIndex(files: FileEntry[]): FileIndex {
  const exact = new Set<string>();
  const lower = new Map<string, string>();
  const dirs = new Set<string>(['']);
  for (const f of files) {
    exact.add(f.rel);
    lower.set(f.rel.toLowerCase(), f.rel);
    const parts = f.rel.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return { exact, lower, dirs };
}

export type RefResult =
  | { status: 'skip' | 'external' }
  | { status: 'ok'; target: string; fallback?: boolean }
  | { status: 'missing'; target: string }
  | { status: 'case-mismatch'; target: string; actual: string }
  | { status: 'outside'; target: string };

const SKIP_SCHEME = /^(#|mailto:|tel:|sms:|javascript:|data:|blob:|about:|whatsapp:|viber:|skype:|callto:)/i;
/** Placeholder-a template-sh: s'mund të zgjidhen pa build. */
const TEMPLATE = /\{\{|\{%|\$\{|<\?|<%|\[\[/;

/**
 * Zgjidh një referencë lokale (href/src/url()) nga skedari `fromRel`. "/x" zgjidhet nga `webRoot`.
 * Linket pa prapashtesë ("rreth") pranohen si "fallback" kur ekziston rreth.html ose rreth/index.html
 * (disa hoste e bëjnë këtë automatikisht) — shënohen, jo raportohen si të prishura.
 */
export function resolveRef(raw: string, fromRel: string, webRoot: string, index: FileIndex): RefResult {
  const ref = raw.trim();
  if (!ref || SKIP_SCHEME.test(ref) || TEMPLATE.test(ref)) return { status: 'skip' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return { status: 'external' };
  let clean = ref.split(/[?#]/)[0]!;
  if (!clean) return { status: 'skip' };
  try {
    clean = decodeURI(clean);
  } catch {
    /* URI e pavlefshme: përdoret si është */
  }
  const base = clean.startsWith('/') ? webRoot : path.posix.dirname(fromRel);
  const joined = path.posix.normalize(path.posix.join(base === '.' ? '' : base, clean.startsWith('/') ? clean.slice(1) : clean));
  if (joined === '..' || joined.startsWith('../')) return { status: 'outside', target: joined };
  const target = joined.replace(/^\.\/?/, '').replace(/\/$/, '');
  const isDir = clean.endsWith('/') || index.dirs.has(target);
  const candidates = isDir ? [`${target ? `${target}/` : ''}index.html`, `${target ? `${target}/` : ''}index.htm`] : [target];
  for (const c of candidates) if (index.exact.has(c)) return { status: 'ok', target: c };
  if (!isDir && !path.posix.extname(target)) {
    for (const c of [`${target}.html`, `${target}/index.html`]) if (index.exact.has(c)) return { status: 'ok', target: c, fallback: true };
  }
  for (const c of candidates) {
    const actual = index.lower.get(c.toLowerCase());
    if (actual) return { status: 'case-mismatch', target: c, actual };
  }
  return { status: 'missing', target: candidates[0]! };
}
