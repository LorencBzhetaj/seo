import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Punët e auditit të nisura nga dashboard-i. Çdo audit ekzekutohet nga CLI-ja ekzistuese si proces më
 * vete (`--progress-json`), jo nga një implementim i dytë: dashboard-i vetëm lexon ngjarjet që motori
 * raporton. Anulimi mbyll stdin-in e procesit (`--exit-with-stdin`): motori liron Chrome-in, fshin profilet
 * e përkohshme, klonin dhe screenshot-et e pjesshme, pastaj del pa raport. Nëse s'del brenda afatit, pema e
 * proceseve ndalet me forcë (mbetjet në %TEMP% i fshin auditi i radhës pas 24 orësh). I njëjti mekanizëm vepron
 * edhe kur dashboard-i mbyllet ose vritet: stdin-i i procesit mbyllet bashkë me të.
 * Argumentet kalojnë si varg (pa shell), të ndërtuara vetëm nga vlera të validuara.
 */

export type JobKind = 'url' | 'folder' | 'repo';
export type JobState = 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface JobEvent {
  at: number;
  text: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  /** URL-ja, shtegu real i dosjes ose URL-ja e repo-s. */
  target: string;
  /** Opsionet e zgjedhura, për t'u shfaqur (p.sh. "maks. 25 faqe"). */
  options: string[];
  /** Komanda ekuivalente e CLI-së (për transparencë). */
  command: string;
  state: JobState;
  startedAt: number;
  endedAt?: number;
  /** Statusi i fundit që raportoi motori (initializing, crawling, auditing, scoring, completed). */
  engineStatus?: string;
  /** Progresi i crawl-it: faqja e N-të nga kufiri (jo nga totali i sitit, që s'dihet paraprakisht). */
  crawl?: { done: number; max: number; url: string };
  events: JobEvent[];
  reportFile?: string;
  reportStatus?: string;
  exitCode?: number | null;
  error?: string;
  note?: string;
}

export interface JobCommand {
  /** Ekzekutuesi (node) dhe argumentet para argumenteve të auditit. */
  exec: string;
  args: string[];
}

export interface JobManagerOptions {
  outputDir: string;
  maxConcurrent?: number;
  /** Për teste: komandë tjetër në vend të CLI-së (p.sh. një CLI i simuluar). */
  command?: JobCommand;
  /** VETËM për teste/fixtures: hoste lokale të lejuara (kalohen si --allow-local). */
  allowLocal?: string[];
  /** Sa pret anulimi që motori të dalë vetë para ndalimit me forcë (ms). */
  cancelGraceMs?: number;
}

export class JobLimitError extends Error {}

export const MAX_CONCURRENT_JOBS = 2;
const MAX_EVENTS = 300;
const MAX_FINISHED = 30;
/** Motori zakonisht pastron për 1–3 s (taskkill i Chrome-it ndonjëherë mbi 5 s); pas këtij afati pema e proceseve ndalet me forcë. */
export const CANCEL_GRACE_MS = 20_000;

/** CLI-ja e motorit: dist/cli.js pas build-it, ose src/cli.ts me tsx gjatë zhvillimit/testeve. */
export function defaultCommand(): JobCommand {
  const here = fileURLToPath(import.meta.url);
  const cli = path.join(path.dirname(here), '..', here.endsWith('.ts') ? 'cli.ts' : 'cli.js');
  return { exec: process.execPath, args: cli.endsWith('.ts') ? ['--import', 'tsx', cli] : [cli] };
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly procs = new Map<string, ChildProcess>();
  private readonly waiters = new Map<string, Promise<Job>>();
  private readonly forceTimers = new Map<string, NodeJS.Timeout>();
  readonly maxConcurrent: number;
  private readonly command: JobCommand;

  constructor(private readonly opts: JobManagerOptions) {
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_JOBS;
    this.command = opts.command ?? defaultCommand();
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  running(): Job[] {
    return this.list().filter((j) => j.state === 'running' || j.state === 'cancelling');
  }

  /** Pret përfundimin e një pune (për teste dhe mbylljen e serverit). */
  wait(id: string): Promise<Job> {
    return this.waiters.get(id) ?? Promise.resolve(this.jobs.get(id)!);
  }

  start(kind: JobKind, target: string, auditArgs: string[], options: string[]): Job {
    if (this.running().length >= this.maxConcurrent) throw new JobLimitError(`Janë ${this.running().length} audite në punë (kufiri ${this.maxConcurrent}). Prit ose anulo njërin.`);
    if (this.running().some((j) => j.kind === kind && j.target === target)) throw new JobLimitError('Një audit për të njëjtin objekt është ende në punë.');
    // Opsionet e dashboard-it para argumenteve të auditit (që mund të mbyllen me "--" para URL-së).
    const args = ['--progress-json', '--exit-with-stdin', '--out', this.opts.outputDir, ...(kind === 'url' && this.opts.allowLocal?.length ? ['--allow-local', this.opts.allowLocal.join(',')] : []), ...auditArgs];
    const job: Job = {
      id: crypto.randomUUID(),
      kind,
      target,
      options,
      command: `npm run audit -- ${auditArgs.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')}`,
      state: 'running',
      startedAt: Date.now(),
      events: [],
    };
    this.jobs.set(job.id, job);
    this.prune();

    const child = spawn(this.command.exec, [...this.command.args, ...args], {
      // stdin: kanali i anulimit (mbyllet → motori pastron dhe del); s'dërgohet asgjë nëpër të.
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
      shell: false,
      // POSIX: grup procesesh më vete, që anulimi i detyruar të ndalë edhe Chrome-in. Windows: jashtë "job
      // object"-it të Node-it, i cili i vret fëmijët menjëherë kur dashboard-i vritet (pa pastrim); kështu motori
      // e kupton mbylljen nga stdin-i dhe liron vetë Chrome-in dhe skedarët e përkohshëm.
      detached: true,
    });
    this.procs.set(job.id, child);
    child.stdin!.on('error', () => {});
    const push = (text: string) => {
      job.events.push({ at: Date.now(), text: text.slice(0, 500) });
      if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
    };

    let buf = '';
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onLine(job, line, push);
      }
      if (buf.length > 64_000) buf = buf.slice(-64_000);
    });

    this.waiters.set(job.id, new Promise<Job>((resolve) => {
      const finish = (code: number | null, spawnError?: Error) => {
        if (job.endedAt) return resolve(job);
        this.procs.delete(job.id);
        const t = this.forceTimers.get(job.id);
        if (t) clearTimeout(t);
        this.forceTimers.delete(job.id);
        job.endedAt = Date.now();
        job.exitCode = code;
        if (job.reportFile) {
          // Raporti u shkrua i plotë (rename atomik), pra auditi përfundoi — edhe nëse anulimi erdhi pas kësaj
          // dhe procesi u ndal para se të dilte vetë.
          if (job.state === 'cancelling') job.note = 'Anulimi erdhi pasi raporti ishte shkruar: auditi përfundoi.';
          job.state = 'completed';
        } else if (job.state === 'cancelling') {
          job.state = 'cancelled';
          job.reportFile = undefined;
        } else {
          job.state = 'failed';
          job.error ??= spawnError ? `S'u nis procesi i auditit: ${spawnError.message}` : `Procesi i auditit doli me kod ${code ?? '—'} pa raport.`;
        }
        resolve(job);
      };
      child.on('error', (e) => finish(null, e));
      child.on('close', (code) => finish(code));
    }));
    return job;
  }

  private onLine(job: Job, line: string, push: (t: string) => void): void {
    let e: Record<string, unknown> | undefined;
    if (line.startsWith('{')) {
      try {
        e = JSON.parse(line) as Record<string, unknown>;
      } catch {
        e = undefined;
      }
    }
    if (!e || typeof e.event !== 'string') return push(line);
    switch (e.event) {
      case 'status':
        job.engineStatus = String(e.status);
        return push(`statusi: ${job.engineStatus}`);
      case 'step':
      case 'log':
        return push(String(e.text ?? ''));
      case 'crawl':
        job.crawl = { done: Number(e.done), max: Number(e.max), url: String(e.url) };
        return;
      case 'report':
        // Vetëm emër skedari brenda dosjes së raporteve; dashboard-i e hap përmes validimit të vet.
        job.reportFile = path.basename(String(e.file));
        job.reportStatus = String(e.status);
        return push(`raporti u shkrua: ${job.reportFile}`);
      case 'aborted':
        return push(`motori u ndal pa raport dhe liroi burimet e përkohshme (${String(e.reason ?? '')})`);
      case 'error':
        job.error = String(e.message ?? '').slice(0, 2000);
        return push(`gabim: ${job.error.split('\n')[0]}`);
      default:
        return push(line);
    }
  }

  /**
   * Anulon një punë në ekzekutim: mbyll stdin-in që motori të pastrojë dhe të dalë; pas afatit, ndal pemën e
   * proceseve me forcë. S'ka efekt mbi punët e përfunduara.
   */
  cancel(id: string, why = 'anulim i kërkuar nga përdoruesi'): boolean {
    const job = this.jobs.get(id);
    const child = this.procs.get(id);
    if (!job || !child || job.state !== 'running') return false;
    job.state = 'cancelling';
    job.events.push({ at: Date.now(), text: why });
    child.stdin?.end();
    const grace = this.opts.cancelGraceMs ?? CANCEL_GRACE_MS;
    const timer = setTimeout(() => {
      if (!this.procs.has(id)) return;
      job.events.push({ at: Date.now(), text: `motori s'doli brenda ${Math.round(grace / 1000)} s: pema e proceseve u ndal me forcë` });
      killTree(child);
    }, grace);
    timer.unref();
    this.forceTimers.set(id, timer);
    return true;
  }

  /** Anulon të gjitha punët në ekzekutim dhe pret daljen e tyre (mbyllja e dashboard-it). */
  async cancelAll(): Promise<void> {
    const running = this.running();
    for (const j of running) this.cancel(j.id, 'dashboard-i po mbyllet: anulim');
    await Promise.all(running.map((j) => this.wait(j.id)));
  }

  private prune(): void {
    const finished = this.list().filter((j) => j.state !== 'running' && j.state !== 'cancelling');
    for (const j of finished.slice(MAX_FINISHED)) this.jobs.delete(j.id);
  }
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // /T: edhe proceset bij (Chrome i Lighthouse / renderimit); /F: pa pritur.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
