import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Severity } from '../core/schemas.js';
import { configChecks, cssChecks, finding, htmlChecks, imageChecks, sensitiveChecks, type CheckInput } from './checks.js';
import { detectProject, type ProjectInfo, type SourceCheckId } from './project.js';
import { buildIndex } from './refs.js';
import { cloneRepo, DEFAULT_REPO_LIMITS, type RepoLimits } from './repo.js';
import { DEFAULT_SOURCE_LIMITS, SKIP_LABELS, type SkipReason, type SourceCheck, type SourceFinding, type SourceLimits } from './types.js';
import { isTextCandidate, readText, walkFolder } from './walk.js';

export interface SourceInput {
  kind: 'folder' | 'repo';
  /** Dosja lokale ose URL-ja e repo-s. */
  target: string;
}

export interface SourceAuditOptions {
  limits?: Partial<SourceLimits>;
  repoLimits?: Partial<RepoLimits>;
  /** Vetëm teste: lejo file:// për repo lokale. */
  allowFileRepo?: boolean;
  onStep?: (step: string) => void;
}

export interface SourceAuditResult {
  id: string;
  startedAt: string;
  completedAt: string;
  source: {
    kind: 'folder' | 'repo';
    /** Emri për raportin (emri i dosjes ose owner/repo). */
    name: string;
    folder?: string;
    repo?: { url: string; commit: string; branch?: string; commitDate?: string; clone: string };
  };
  project: ProjectInfo;
  coverage: {
    filesSeen: number;
    filesRead: number;
    /**
     * Si u trajtua çdo skedar i listuar: filesSeen = readAsText + statOnly + unread.
     * statOnly = asete binare (imazhe, fonte…) të kontrolluara me stat (ekzistencë/madhësi), pa lexim teksti.
     * notListed = hyrje të anashkaluara para listimit (dosje të injoruara, symlink-e, kufij) — s'janë te filesSeen.
     */
    accounting: {
      filesSeen: number;
      readAsText: number;
      statOnly: { count: number; byExt: Record<string, number>; meaning: string };
      unread: { count: number; byReason: Partial<Record<SkipReason, number>> };
      notListed: number;
      equation: string;
    };
    htmlFiles: number;
    htmlRead: number;
    totalBytes: number;
    skipped: Partial<Record<SkipReason, { count: number; meaning: string; examples: string[] }>>;
    truncated: boolean;
    limits: SourceLimits;
  };
  checks: SourceCheck[];
  findings: SourceFinding[];
  limitations: string[];
}

export const CHECK_LABELS: Record<SourceCheckId, string> = {
  'html-seo': 'SEO në HTML (title, description, H1, lang, viewport, alt)',
  'local-links': 'Linke dhe asete lokale në HTML',
  'css-assets': 'Asete në CSS (url(), @import)',
  duplicates: 'Përmbajtje/tituj të përsëritur',
  images: 'Imazhet (madhësia)',
  config: 'Konfigurime (robots, sitemap, favicon, JSON, hosting)',
  'sensitive-files': 'Skedarë të ndjeshëm dhe sekrete',
};

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const MAX_PER_CODE = 300;

function statusOf(findings: SourceFinding[]): SourceCheck['status'] {
  if (!findings.length) return 'pass';
  return findings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'fail' : 'warning';
}

function repoName(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+|\.git$|\/+$/g, '').replace(/\//g, '-') || u.hostname;
  } catch {
    return 'repo';
  }
}

/**
 * Auditi i skedarëve: dosje lokale ose kopje e përkohshme e një repo publike. Asgjë s'ekzekutohet
 * (pa npm install, build, skripte, server). Rezultati është i ndarë nga auditi i URL-së dhe s'ka
 * Health Score/Lighthouse.
 */
export async function executeSourceAudit(input: SourceInput, opts: SourceAuditOptions = {}): Promise<SourceAuditResult> {
  const startedAt = new Date().toISOString();
  const limits: SourceLimits = { ...DEFAULT_SOURCE_LIMITS, ...opts.limits };
  const step = opts.onStep ?? (() => {});
  let root: string;
  let source: SourceAuditResult['source'];
  let cleanup = () => {};

  if (input.kind === 'repo') {
    step('klonim i cekët (depth 1) në dosje të përkohshme — pa skripte, hooks, LFS apo submodule');
    const repo = await cloneRepo(input.target, { ...DEFAULT_REPO_LIMITS, ...opts.repoLimits }, { allowFileUrl: opts.allowFileRepo });
    root = repo.dir;
    cleanup = repo.cleanup;
    source = {
      kind: 'repo', name: repoName(repo.url),
      repo: { url: repo.url, commit: repo.commit, branch: repo.branch, commitDate: repo.commitDate, clone: 'i cekët (depth 1), vetëm branch-i kryesor, pa tags/submodule/LFS; kopja u fshi pas auditit' },
    };
  } else {
    const abs = path.resolve(input.target);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Dosja s'u gjet ose s'është dosje: ${abs}`);
    root = abs;
    source = { kind: 'folder', name: path.basename(abs) || abs, folder: abs };
  }

  try {
    step('lista e skedarëve (pa ndjekur symlink-e)');
    const walk = walkFolder(root, limits);
    const project = detectProject(walk.root, walk.files);
    const index = buildIndex(walk.files);
    const texts = new Map<string, string>();
    const skipped = [...walk.skipped];
    // Çdo skedar i listuar merr saktësisht një trajtim: tekst i lexuar, aset binar (vetëm stat) ose tekst i palexuar (me arsye).
    const statOnly: { rel: string; ext: string }[] = [];
    const unread: { rel: string; reason: SkipReason }[] = [];
    for (const f of walk.files) {
      if (!isTextCandidate(f)) {
        // Git LFS pointer: skedar i vogël "binar" që në fakt është tekst — përmbajtja reale mungon.
        const r = f.size < 400 ? readText(f, 400) : undefined;
        if (r && 'skip' in r && r.skip === 'lfs-pointer') {
          skipped.push({ rel: f.rel, reason: 'lfs-pointer' });
          unread.push({ rel: f.rel, reason: 'lfs-pointer' });
        } else statOnly.push({ rel: f.rel, ext: f.ext || '(pa prapashtesë)' });
        continue;
      }
      const r = readText(f, limits.maxFileBytes);
      if ('text' in r) texts.set(f.rel, r.text);
      else {
        skipped.push({ rel: f.rel, reason: r.skip, detail: r.skip === 'too-large' ? `${Math.round(f.size / 1024)} KB` : undefined });
        unread.push({ rel: f.rel, reason: r.skip });
      }
    }

    const ci: CheckInput = { kind: input.kind, files: walk.files, index, project, texts };
    const sup = (id: SourceCheckId) => project.support.find((s) => s.id === id)!;
    const on = (id: SourceCheckId) => sup(id).supported !== 'no';
    step(`kontrolle (${project.type})`);
    const outputs = [
      htmlChecks(ci, { seo: on('html-seo'), links: on('local-links'), duplicates: on('duplicates') }),
      on('css-assets') ? cssChecks(ci) : { findings: [], observations: {} },
      imageChecks(ci, on('local-links')),
      configChecks(ci, on('html-seo')),
      sensitiveChecks(ci),
    ];
    const findings: SourceFinding[] = outputs.flatMap((o) => o.findings);

    // Symlink-et jashtë dosjes: s'ndiqen, por shënohen (mund të sjellin skedarë të papritur në deploy).
    for (const s of skipped.filter((x) => x.reason === 'symlink-outside')) {
      findings.push(finding('SYMLINK_OUTSIDE_ROOT', 'files', 'low', 0.9, s.rel, undefined, 'Symlink që del jashtë dosjes — s\'u ndoq', `${s.rel} (${s.detail ?? 'jashtë rrënjës'})`, 'Kontrollo nëse duhet; shumë hoste s\'i ndjekin symlink-et ose publikojnë skedarë të papritur.'));
    }
    const htmlTooLarge = skipped.filter((s) => s.reason === 'too-large' && /\.html?$/i.test(s.rel));

    const checkOf: Record<SourceCheckId, (f: SourceFinding) => boolean> = {
      'html-seo': (f) => f.category === 'seo' || f.code === 'IMG_MISSING_ALT',
      'local-links': (f) => f.category === 'links' && !/\.css$/.test(f.file),
      'css-assets': (f) => f.category === 'links' && /\.css$/.test(f.file),
      duplicates: (f) => f.category === 'duplicates',
      images: (f) => f.category === 'images' && f.code !== 'IMG_MISSING_ALT',
      config: (f) => f.category === 'config',
      'sensitive-files': (f) => f.category === 'security',
    };
    const observations = Object.assign({}, ...outputs.map((o) => o.observations)) as Partial<Record<SourceCheckId, string[]>>;
    const checks: SourceCheck[] = (Object.keys(CHECK_LABELS) as SourceCheckId[]).map((id) => {
      const s = sup(id);
      if (s.supported === 'no') return { id, label: CHECK_LABELS[id], status: 'skipped', reason: s.reason, findingCodes: [] };
      const mine = findings.filter(checkOf[id]);
      const obs = [...(observations[id] ?? [])];
      if (s.supported === 'partial') obs.unshift(`I pjesshëm: ${s.reason}`);
      if ((id === 'html-seo' || id === 'local-links') && htmlTooLarge.length) obs.push(`${htmlTooLarge.length} HTML mbi kufirin e leximit s'u kontrolluan: ${htmlTooLarge.slice(0, 3).map((x) => x.rel).join(', ')}`);
      return { id, label: CHECK_LABELS[id], status: statusOf(mine), observations: obs, findingCodes: [...new Set(mine.map((f) => f.code))] };
    });

    // Kufiri për kod, që një problem i përsëritur të mos mbushë raportin
    const perCode = new Map<string, number>();
    const capped = findings
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.confidence - a.confidence || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
      .filter((f) => {
        const n = (perCode.get(f.code) ?? 0) + 1;
        perCode.set(f.code, n);
        return n <= MAX_PER_CODE;
      });

    const bySkip: SourceAuditResult['coverage']['skipped'] = {};
    for (const s of skipped) {
      const e = (bySkip[s.reason] ??= { count: 0, meaning: SKIP_LABELS[s.reason], examples: [] });
      e.count++;
      if (e.examples.length < 5) e.examples.push(s.detail ? `${s.rel} (${s.detail})` : s.rel);
    }
    const htmlFiles = walk.files.filter((f) => /\.html?$/i.test(f.ext));
    const limitations = [
      'Audit i skedarëve: asgjë s\'u ekzekutua (pa npm install, build, skripte apo server). S\'ka Health Score dhe Lighthouse — këto kërkojnë auditin e URL-së publike.',
      'HTML-ja kontrollohet si është në disk; përmbajtja që shtohet me JavaScript ose nga template/build s\'shihet.',
      'JavaScript lexohet vetëm për sekrete të mundshme dhe referenca imazhesh, jo për linke/routing.',
      ...(project.support.filter((s) => s.supported === 'no').map((s) => `${CHECK_LABELS[s.id]}: skipped — ${s.reason}`)),
      ...(walk.truncated ? ['U arrit një kufi (skedarë/madhësi/thellësi): mbulimi është i pjesshëm, shih coverage.skipped.'] : []),
      ...(input.kind === 'repo' ? ['Repo: kopje e cekët e branch-it kryesor në momentin e auditit; historia, branch-et e tjera, submodule dhe skedarët LFS s\'u kontrolluan.'] : []),
    ];

    return {
      id: crypto.randomUUID(),
      startedAt,
      completedAt: new Date().toISOString(),
      source,
      project,
      coverage: {
        filesSeen: walk.files.length,
        accounting: {
          filesSeen: walk.files.length,
          readAsText: texts.size,
          statOnly: {
            count: statOnly.length,
            byExt: statOnly.reduce<Record<string, number>>((m, x) => ((m[x.ext] = (m[x.ext] ?? 0) + 1), m), {}),
            meaning: 'asete binare (imazhe, fonte, arkiva…) të kontrolluara vetëm me stat: ekzistenca dhe madhësia, pa lexim teksti',
          },
          unread: { count: unread.length, byReason: unread.reduce<Partial<Record<SkipReason, number>>>((m, x) => ((m[x.reason] = (m[x.reason] ?? 0) + 1), m), {}) },
          notListed: walk.skipped.length,
          equation: `${walk.files.length} = ${texts.size} lexuar si tekst + ${statOnly.length} asete binare (vetëm stat) + ${unread.length} tekst i palexuar`,
        },
        filesRead: texts.size,
        htmlFiles: htmlFiles.length,
        htmlRead: htmlFiles.filter((f) => texts.has(f.rel)).length,
        totalBytes: walk.totalBytes,
        skipped: bySkip,
        truncated: walk.truncated || htmlTooLarge.length > 0,
        limits,
      },
      checks,
      findings: capped,
      limitations,
    };
  } finally {
    cleanup();
  }
}
