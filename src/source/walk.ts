import fs from 'node:fs';
import path from 'node:path';
import type { FileEntry, SkipReason, SourceLimits } from './types.js';

/** Dosje që s'auditohen: varësi, VCS, cache build-i. `dist/`, `build/`, `public/` lexohen (mund të jenë site-i). */
export const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.svelte-kit', '.astro', '.cache', '.turbo', '.vercel', '.netlify', 'bower_components', 'vendor', '__pycache__', '.venv', '.idea', '.vscode']);

export interface WalkResult {
  root: string;
  files: FileEntry[];
  skipped: { rel: string; reason: SkipReason; detail?: string }[];
  totalBytes: number;
  truncated: boolean;
}

export const toPosix = (p: string) => p.split(path.sep).join('/');

/** A është `target` brenda `root` (pas realpath)? */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Përshkon dosjen pa ndjekur symlink-e/junction-e (as brenda, as jashtë): kështu s'ka cikle dhe
 * s'lexohet asgjë jashtë rrënjës. Vetëm stat; përmbajtja lexohet më vonë, sipas kufirit të madhësisë.
 */
export function walkFolder(rootInput: string, limits: SourceLimits): WalkResult {
  const root = fs.realpathSync(rootInput);
  const files: FileEntry[] = [];
  const skipped: WalkResult['skipped'] = [];
  let totalBytes = 0;
  let truncated = false;

  const visit = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      skipped.push({ rel: toPosix(path.relative(root, dir)) || '.', reason: 'unreadable', detail: (err as NodeJS.ErrnoException).code });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = toPosix(path.relative(root, abs));
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch (err) {
        skipped.push({ rel, reason: 'unreadable', detail: (err as NodeJS.ErrnoException).code });
        continue;
      }
      if (st.isSymbolicLink()) {
        let target: string | undefined;
        try {
          target = fs.realpathSync(abs);
        } catch {
          target = undefined; // symlink i prishur
        }
        const outside = !target || !isInside(root, target);
        skipped.push({ rel, reason: outside ? 'symlink-outside' : 'symlink', detail: target ? (outside ? 'jashtë rrënjës' : toPosix(path.relative(root, target))) : 'i prishur' });
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) {
          skipped.push({ rel, reason: 'ignored-dir' });
          continue;
        }
        if (depth >= limits.maxDepth) {
          skipped.push({ rel, reason: 'max-depth' });
          truncated = true;
          continue;
        }
        visit(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (files.length >= limits.maxFiles) {
        skipped.push({ rel, reason: 'max-files' });
        truncated = true;
        continue;
      }
      if (totalBytes + st.size > limits.maxTotalBytes) {
        skipped.push({ rel, reason: 'max-total-bytes' });
        truncated = true;
        continue;
      }
      totalBytes += st.size;
      files.push({ rel, abs, size: st.size, ext: path.extname(e.name).toLowerCase() });
    }
  };
  visit(root, 0);
  return { root, files, skipped, totalBytes, truncated };
}

const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.xml', '.txt', '.md', '.toml', '.yml', '.yaml', '.php', '.vue', '.svelte', '.astro', '.env', '.ini', '.conf', '.htaccess', '.webmanifest', '.svg', '.sql', '.pem', '.key', '']);

export function isTextCandidate(f: FileEntry): boolean {
  return TEXT_EXT.has(f.ext) || /^\.env(\.|$)/.test(path.basename(f.rel)) || f.rel.endsWith('_headers') || f.rel.endsWith('_redirects');
}

/**
 * Lexon një skedar teksti me kufi madhësie; kthen null për shumë të madh/binar/LFS pointer
 * (me arsyen), që gjetjet të mos bazohen në përmbajtje të paplotë.
 */
export function readText(f: FileEntry, maxBytes: number): { text: string } | { skip: SkipReason } {
  if (f.size > maxBytes) return { skip: 'too-large' };
  let buf: Buffer;
  try {
    buf = fs.readFileSync(f.abs);
  } catch {
    return { skip: 'unreadable' };
  }
  if (buf.subarray(0, 8000).includes(0)) return { skip: 'binary' };
  const text = buf.toString('utf8');
  if (/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/.test(text) && f.size < 400) return { skip: 'lfs-pointer' };
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
}

/** Rreshti (1-based) i një offset-i në tekst. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}
