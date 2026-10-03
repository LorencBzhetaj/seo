import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Ruajtja lokale e Google Search Console (faza 5), jashtë Git dhe jashtë dosjes së raporteve:
 * - Windows: %LOCALAPPDATA%\SEO Tool\gsc (dosje e përdoruesit); sekretet (klienti OAuth, token-at) të
 *   enkriptuara me DPAPI (CurrentUser) — mund t'i lexojë vetëm i njëjti përdorues Windows në këtë kompjuter;
 * - sisteme të tjera: ~/.seo-tool/gsc me leje 0700/0600 (pa enkriptim; thuhet qartë në dashboard);
 * - të dhënat e Search Analytics (pa sekrete, por private) ruhen si JSON në gsc/data.
 * Asnjë sekret s'shkruhet në raporte, log-e ose faqe; shkëputja dhe fshirja i heqin plotësisht.
 */

export type Protection = 'dpapi' | 'file-permissions' | 'memory';

/** Mbrojtja e sekreteve: enkripton/dekripton bajte (DPAPI në Windows). E injektueshme për teste. */
export interface Protector {
  kind: Protection;
  protect(data: Buffer): Buffer;
  unprotect(data: Buffer): Buffer;
}

/** DPAPI përmes PowerShell (pa module native): të dhënat kalojnë vetëm nga stdin/stdout, kurrë në argumente. */
export function dpapiProtector(powershell = 'powershell.exe'): Protector {
  const run = (op: 'Protect' | 'Unprotect', data: Buffer): Buffer => {
    const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $r=[System.Security.Cryptography.ProtectedData]::${op}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    const res = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { input: data.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    if (res.status !== 0 || !res.stdout) throw new Error(`DPAPI ${op} dështoi${res.error ? `: ${res.error.message}` : ''}`);
    return Buffer.from(res.stdout.trim(), 'base64');
  };
  return { kind: 'dpapi', protect: (d) => run('Protect', d), unprotect: (d) => run('Unprotect', d) };
}

/** Pa enkriptim: vetëm leje skedari 0600 (sisteme jo-Windows). */
export const filePermissionProtector: Protector = { kind: 'file-permissions', protect: (d) => d, unprotect: (d) => d };

export function defaultGscDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.SEO_TOOL_GSC_DIR) return path.resolve(env.SEO_TOOL_GSC_DIR);
  // E njëjta dosje të dhënash si programi i instaluar (src/app/launch.ts): SEO_TOOL_DATA ose %LOCALAPPDATA%\SEO Tool.
  if (env.SEO_TOOL_DATA) return path.join(path.resolve(env.SEO_TOOL_DATA), 'gsc');
  if (platform === 'win32' && env.LOCALAPPDATA) return path.win32.join(env.LOCALAPPDATA, 'SEO Tool', 'gsc');
  return path.join(os.homedir(), '.seo-tool', 'gsc');
}

/** Shtegu për t'u shfaqur në faqe: pa emrin e përdoruesit (%LOCALAPPDATA%\… ose ~/…), që pamjet të ndahen pa të. */
export function displayDir(dir: string, env: NodeJS.ProcessEnv = process.env): string {
  const under = (base: string | undefined, label: string) => {
    if (!base) return undefined;
    const b = base.replace(/[\\/]+$/, '').toLowerCase();
    const d = dir.toLowerCase();
    return d === b || d.startsWith(`${b}\\`) || d.startsWith(`${b}/`) ? label + dir.slice(b.length) : undefined;
  };
  return under(env.LOCALAPPDATA, '%LOCALAPPDATA%') ?? under(os.homedir(), '~') ?? `…${path.sep}${path.basename(path.dirname(dir))}${path.sep}${path.basename(dir)}`;
}

export function defaultProtector(): Protector {
  return process.platform === 'win32' ? dpapiProtector() : filePermissionProtector;
}

/** Klienti OAuth i tipit "Desktop app" (nga Google Cloud Console → Credentials → OAuth client ID). */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  projectId: string;
}

export interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  /** ms epoch */
  expiresAt?: number;
  scope: string;
  connectedAt: string;
}

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/**
 * Validon JSON-in e shkarkuar nga Google Cloud. Pranohet vetëm klienti "installed" (Desktop app):
 * klienti "web" s'lejon redirect loopback me port të çfarëdoshëm.
 */
export function parseClientJson(text: string): { ok: true; client: OAuthClient } | { ok: false; error: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON i pavlefshëm. Ngjit përmbajtjen e plotë të skedarit client_secret_….json.' };
  }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  if (o.web) return { ok: false, error: 'Ky është klient "Web application". Krijo një OAuth client ID të tipit "Desktop app" dhe përdor atë.' };
  const inst = (o.installed && typeof o.installed === 'object' ? o.installed : undefined) as Record<string, unknown> | undefined;
  if (!inst) return { ok: false, error: 'Mungon seksioni "installed" (klient i tipit "Desktop app").' };
  const clientId = typeof inst.client_id === 'string' ? inst.client_id : '';
  const clientSecret = typeof inst.client_secret === 'string' ? inst.client_secret : '';
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, error: 'client_id i pavlefshëm (pritet …apps.googleusercontent.com).' };
  if (!clientSecret || clientSecret.length > 200) return { ok: false, error: 'Mungon client_secret.' };
  // Endpoint-et merren gjithmonë nga kodi (Google), kurrë nga skedari: s'mund të devijohen.
  return { ok: true, client: { clientId, clientSecret, projectId: typeof inst.project_id === 'string' ? inst.project_id.slice(0, 100) : '' } };
}

/** Pjesë e client_id për shfaqje (s'është sekret, por s'ka nevojë të shfaqet i tëri). */
export const maskClientId = (id: string) => (id.length > 24 ? `${id.slice(0, 8)}…${id.slice(id.indexOf('.apps.'))}` : id);

export class GscStore {
  readonly dir: string;
  readonly protector: Protector;

  constructor(dir = defaultGscDir(), protector: Protector = defaultProtector()) {
    this.dir = dir;
    this.protector = protector;
  }

  private ensureDir(sub = ''): string {
    const d = path.join(this.dir, sub);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    return d;
  }

  private writeSecret(name: string, value: unknown): void {
    const file = path.join(this.ensureDir(), name);
    const data = this.protector.protect(Buffer.from(JSON.stringify(value), 'utf8'));
    const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([Buffer.from(`SEOTOOL-${this.protector.kind}\n`), data]), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  private readSecret<T>(name: string): T | undefined {
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file);
    const nl = raw.indexOf(0x0a);
    const header = raw.subarray(0, nl).toString('utf8');
    if (header !== `SEOTOOL-${this.protector.kind}`) throw new Error(`Skedari ${name} u ruajt me mbrojtje tjetër (${header}); shkëpute dhe lidhe sërish.`);
    return JSON.parse(this.protector.unprotect(raw.subarray(nl + 1)).toString('utf8')) as T;
  }

  private remove(name: string): void {
    fs.rmSync(path.join(this.dir, name), { force: true });
  }

  saveClient(c: OAuthClient): void {
    this.writeSecret('client.bin', c);
  }

  loadClient(): OAuthClient | undefined {
    return this.readSecret<OAuthClient>('client.bin');
  }

  saveToken(t: StoredToken): void {
    this.writeSecret('token.bin', t);
  }

  loadToken(): StoredToken | undefined {
    return this.readSecret<StoredToken>('token.bin');
  }

  deleteToken(): void {
    this.remove('token.bin');
  }

  deleteClient(): void {
    this.remove('client.bin');
  }

  // ------------------------------------------------------------ të dhënat e Search Analytics

  private dataFile(id: string): string | undefined {
    return /^[a-f0-9]{16}$/.test(id) ? path.join(this.dir, 'data', `${id}.json`) : undefined;
  }

  saveDataset(ds: { id: string }): void {
    const file = this.dataFile(ds.id);
    if (!file) throw new Error('id e pavlefshme');
    this.ensureDir('data');
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ds), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  loadDataset<T>(id: string): T | undefined {
    const file = this.dataFile(id);
    if (!file || !fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  listDatasets<T>(): T[] {
    const d = path.join(this.dir, 'data');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => /^[a-f0-9]{16}\.json$/.test(f)).map((f) => this.loadDataset<T>(f.slice(0, 16))).filter((x): x is T => !!x);
  }

  /** Fshin të gjitha të dhënat e Search Analytics (token-i dhe klienti mbeten). */
  deleteDatasets(): number {
    const d = path.join(this.dir, 'data');
    if (!fs.existsSync(d)) return 0;
    const n = fs.readdirSync(d).length;
    fs.rmSync(d, { recursive: true, force: true });
    return n;
  }

  /** Fshin gjithçka të GSC në këtë kompjuter: klientin, token-in dhe të dhënat. */
  deleteAll(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** Përgjigjja e fundit e Google për revokimin (pa sekrete), që shkëputja të verifikohet edhe më vonë. */
  saveRevokeResult(r: RevokeRecord): void {
    this.ensureDir();
    fs.writeFileSync(path.join(this.dir, 'revoke.json'), JSON.stringify(r), { mode: 0o600 });
  }

  loadRevokeResult(): RevokeRecord | undefined {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(this.dir, 'revoke.json'), 'utf8')) as RevokeRecord;
      return typeof r.at === 'string' && typeof r.confirmed === 'boolean' ? r : undefined;
    } catch {
      return undefined;
    }
  }
}

export interface RevokeRecord {
  at: string;
  /** true vetëm kur Google ktheu HTTP 200 te endpoint-i i revokimit. */
  confirmed: boolean;
  /** Statusi HTTP i Google (mungon kur kërkesa s'arriti te Google). */
  httpStatus?: number;
  /** Kodi i gabimit nga Google (p.sh. invalid_token) ose "network"; kurrë token. */
  error?: string;
}

/** Heq nga një tekst çdo gjë që ngjan me token Google (për mesazhet e gabimeve). */
export function redactSecrets(s: string): string {
  return s
    .replace(/ya29\.[\w.-]+/g, '[token i fshehur]')
    .replace(/1\/\/[\w.-]{10,}/g, '[token i fshehur]')
    .replace(/GOCSPX-[\w-]+/g, '[sekret i fshehur]')
    .replace(/(access_token|refresh_token|client_secret|code)=([^&\s]+)/g, '$1=[i fshehur]');
}
