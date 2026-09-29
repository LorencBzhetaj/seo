import { spawn } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlockedUrlError, isBlockedIp } from '../net/url-guard.js';

export interface RepoLimits {
  /** Madhësia maksimale e dosjes së klonuar (bytes); tejkalimi e ndërpret klonimin. */
  maxBytes: number;
  timeoutMs: number;
}

export const DEFAULT_REPO_LIMITS: RepoLimits = { maxBytes: 150 * 1024 * 1024, timeoutMs: 120_000 };

export interface ClonedRepo {
  dir: string;
  url: string;
  commit: string;
  branch?: string;
  commitDate?: string;
  cleanup(): void;
}

export type RepoErrorCode = 'REPO_URL_INVALID' | 'REPO_PRIVATE_OR_MISSING' | 'REPO_TOO_LARGE' | 'REPO_TIMEOUT' | 'REPO_INCOMPLETE' | 'GIT_MISSING' | 'REPO_CLONE_FAILED';

export class RepoError extends Error {
  constructor(message: string, readonly code: RepoErrorCode) {
    super(message);
  }
}

export const PRIVATE_REPO_NOTE =
  "Repo private (ose që s'ekziston) s'mbështeten ende: qasja kërkon konfigurim të veçantë kredencialesh, që tool-i qëllimisht s'e përdor (credential helper-at çaktivizohen gjatë klonimit).";

/**
 * Vetëm https://, pa kredenciale në URL, host publik. `allowFileUrl` vetëm për teste (repo lokal).
 * SSH (git@…) refuzohet: kërkon çelësa, pra s'është "repo publike".
 */
export async function validateRepoUrl(input: string, opts: { allowFileUrl?: boolean } = {}): Promise<URL> {
  if (/^[\w.-]+@[\w.-]+:/.test(input)) throw new RepoError(`URL SSH s'mbështetet (${input}): përdor https://… për repo publike. ${PRIVATE_REPO_NOTE}`, 'REPO_URL_INVALID');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RepoError(`URL e pavlefshme e repo-s: ${input}`, 'REPO_URL_INVALID');
  }
  if (url.protocol === 'file:' && opts.allowFileUrl) return url;
  if (url.protocol !== 'https:') throw new RepoError(`Vetëm https:// lejohet për --repo (u dha ${url.protocol})`, 'REPO_URL_INVALID');
  if (url.username || url.password) throw new RepoError('URL e repo-s s\'duhet të përmbajë kredenciale (user:token@).', 'REPO_URL_INVALID');
  const addresses = await dns.promises.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addresses.length) throw new RepoError(`Host-i s'u gjet: ${url.hostname}`, 'REPO_URL_INVALID');
  const blocked = addresses.filter((a) => isBlockedIp(a.address));
  if (blocked.length) throw new BlockedUrlError(`${url.hostname} rezolvohet në adresë private/lokale (${blocked.map((b) => b.address).join(', ')})`);
  return url;
}

/** Mesazhi i git-it → kod i qartë; për repo private/që s'ekzistojnë jepet shënimi për konfigurim. */
export function classifyGitError(stderr: string): { code: RepoErrorCode; message: string } {
  const s = stderr.toLowerCase();
  if (/authentication failed|could not read username|terminal prompts disabled|repository not found|access denied|not authorized|403|401|does not appear to be a git repository|could not read from remote/.test(s)) {
    return { code: 'REPO_PRIVATE_OR_MISSING', message: `Repo-ja s'u arrit — mund të jetë private ose s'ekziston. ${PRIVATE_REPO_NOTE}` };
  }
  if (/early eof|unexpected disconnect|index-pack failed|rpc failed|fatal: the remote end hung up|invalid index-pack/.test(s)) {
    return { code: 'REPO_INCOMPLETE', message: 'Klonimi mbeti i paplotë (lidhja u ndërpre). Asnjë audit s\'u bë mbi kopje të paplotë.' };
  }
  return { code: 'REPO_CLONE_FAILED', message: `git clone dështoi: ${stderr.trim().split('\n').slice(-2).join(' ').slice(0, 240)}` };
}

function dirSize(dir: string, limit: number): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* skedar në shkrim e sipër */
        }
        if (total > limit) return total;
      }
    }
  }
  return total;
}

/** Heq kopjen e përkohshme; git i bën pack-et read-only në Windows, ndaj i hapen më parë. */
export function removeTree(dir: string): void {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      /* s'ekziston */
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          fs.chmodSync(p, 0o666);
        } catch {
          /* injoro */
        }
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function runGit(args: string[], opts: { cwd?: string; timeoutMs: number; onTick?: () => string | null }): Promise<{ code: number | null; stdout: string; stderr: string; killed?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Asnjë prompt dhe asnjë kredencial: repo private dështojnë qartë, s'përdoren kredencialet e përdoruesit.
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
        GIT_LFS_SKIP_SMUDGE: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    let killed: string | undefined;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-8000)));
    const kill = (why: string) => {
      killed ??= why;
      child.kill();
    };
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
    const tick = opts.onTick ? setInterval(() => {
      const why = opts.onTick!();
      if (why) kill(why);
    }, 500) : undefined;
    child.on('error', (err) => {
      clearTimeout(timer);
      if (tick) clearInterval(tick);
      reject((err as NodeJS.ErrnoException).code === 'ENOENT' ? new RepoError('git s\'u gjet në PATH: instalo Git për --repo.', 'GIT_MISSING') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tick) clearInterval(tick);
      resolve({ code, stdout, stderr, killed });
    });
  });
}

/**
 * Klon i cekët (depth 1, vetëm branch-i kryesor, pa tags/submodule/LFS) në një dosje të përkohshme.
 * S'ekzekutohet asgjë nga repo-ja: pa hooks (template bosh), pa symlink-e (core.symlinks=false),
 * pa filtra LFS, pa kredenciale. Kopja fshihet me `cleanup()`.
 */
export async function cloneRepo(input: string, limits: RepoLimits = DEFAULT_REPO_LIMITS, opts: { allowFileUrl?: boolean } = {}): Promise<ClonedRepo> {
  const url = await validateRepoUrl(input, opts);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'website-auditor-repo-'));
  const template = path.join(tmp, 'template');
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(template);
  const cleanup = () => removeTree(tmp);
  try {
    const args = [
      '-c', 'credential.helper=',
      '-c', `core.hooksPath=${template}`,
      '-c', 'core.symlinks=false',
      '-c', 'core.longpaths=true',
      '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false',
      '-c', `protocol.file.allow=${url.protocol === 'file:' ? 'always' : 'never'}`,
      '-c', 'protocol.ext.allow=never',
      'clone', '--depth', '1', '--single-branch', '--no-tags', '--no-recurse-submodules', `--template=${template}`, '--', url.href, dir,
    ];
    const res = await runGit(args, { timeoutMs: limits.timeoutMs, onTick: () => (fs.existsSync(dir) && dirSize(dir, limits.maxBytes) > limits.maxBytes ? 'too-large' : null) });
    if (res.killed === 'timeout') throw new RepoError(`Klonimi u ndërpre pas ${limits.timeoutMs / 1000}s (kufiri kohor). Repo i paplotë — s'u auditua.`, 'REPO_TIMEOUT');
    if (res.killed === 'too-large') throw new RepoError(`Repo-ja kaloi kufirin prej ${Math.round(limits.maxBytes / 1024 / 1024)} MB gjatë klonimit — u ndërpre; kopja e paplotë s'u auditua.`, 'REPO_TOO_LARGE');
    if (res.code !== 0) {
      const c = classifyGitError(res.stderr);
      throw new RepoError(c.message, c.code);
    }
    if (dirSize(dir, limits.maxBytes) > limits.maxBytes) throw new RepoError(`Repo-ja kalon kufirin prej ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`, 'REPO_TOO_LARGE');
    const head = await runGit(['-C', dir, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 });
    const commit = head.stdout.trim();
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) throw new RepoError('Repo-ja s\'ka commit të lexueshëm (bosh ose e paplotë).', 'REPO_INCOMPLETE');
    const branch = (await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10_000 })).stdout.trim() || undefined;
    const commitDate = (await runGit(['-C', dir, 'log', '-1', '--format=%cI'], { timeoutMs: 10_000 })).stdout.trim() || undefined;
    return { dir, url: url.href, commit, branch, commitDate, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}
