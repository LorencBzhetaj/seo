#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { runningInstance } from './instance.js';
import { removeSync } from '../core/fsutil.js';

/**
 * Instalimi i SEO Tool në Windows, pa ekzekutues të panënshkruar (Smart App Control i bllokon) dhe pa PowerShell.
 * Paketa (ZIP) nxirret aty ku zgjedh përdoruesi; ajo dosje është dosja e instalimit. `Instalo.cmd` ekzekuton
 * këtë skript me Node-in e paketuar (i nënshkruar nga OpenJS):
 *   install    shkurtore në Start Menu (+ Desktop sipas zgjedhjes), regjistrim te "Aplikacionet" e Windows
 *              (HKCU, pa administrator), heqje e versionit të mëparshëm (në dosje tjetër, ose skedarët e vjetër
 *              të programit kur versioni i ri nxirret mbi të njëjtën dosje)
 *   uninstall  heq shkurtoret, regjistrimin dhe skedarët e programit; raportet vetëm me zgjedhje të qartë
 *
 * Të dhënat e përdoruesit (%LOCALAPPDATA%\SEO Tool) s'janë kurrë brenda dosjes së instalimit.
 */
export const APP_NAME = 'SEO Tool';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SEOTool';
/** Vetëm këto fshihen nga dosja e instalimit; çdo skedar tjetër i përdoruesit mbetet. */
export const OWNED = ['runtime', 'app', 'Instalo.cmd', 'Hap SEO Tool.cmd', 'seo-audit.cmd', 'LEXOME.txt', 'version.txt'];
/** Lista e skedarëve të këtij versioni brenda runtime\ dhe app\ (shkruhet nga scripts/build-installer.mjs). */
export const MANIFEST = 'app/manifest.txt';

/**
 * Përditësim mbi të njëjtën dosje: fshin skedarët e versionit të vjetër që s'janë në listën e versionit të ri,
 * vetëm brenda runtime\ dhe app\ (dosjet e programit). Skedarët e përdoruesit jashtë tyre s'preken kurrë.
 */
export function pruneStale(dir: string): string[] {
  const manifestFile = path.join(dir, ...MANIFEST.split('/'));
  if (!fs.existsSync(manifestFile)) return [];
  const keep = new Set(fs.readFileSync(manifestFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.toLowerCase()));
  const removed: string[] = [];
  for (const top of ['runtime', 'app']) {
    const root = path.join(dir, top);
    if (!fs.existsSync(root)) continue;
    const entries = fs.readdirSync(root, { withFileTypes: true, recursive: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(e.parentPath, e.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (!keep.has(rel.toLowerCase())) {
        removeSync(full);
        removed.push(rel);
      }
    }
    // Dosjet që mbetën bosh (nga më e thella te më e cekëta)
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(e.parentPath, e.name)).sort((a, b) => b.length - a.length);
    for (const d of dirs) {
      try {
        // Bosh: fshihet me riprovim (antivirusi/indeksimi mund ta mbajnë hapur për pak çaste).
        if (fs.readdirSync(d).length === 0) removeSync(d, { retries: 5, retryDelayMs: 200 });
      } catch {
        /* s'është bosh */
      }
    }
  }
  return removed;
}

export function installDirOf(scriptUrl = import.meta.url): string {
  // <dosja>\app\dist\app\setup.js
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), '..', '..', '..');
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), APP_NAME);
}

const norm = (p: string) => `${path.resolve(p).toLowerCase().replace(/[\\/]+$/, '')}\\`;
const inside = (child: string, parent: string) => norm(child).startsWith(norm(parent));

/** Pse s'mund të instalohet në këtë dosje (ose undefined). */
export function installDirProblem(dir: string, opts: { dataDir: string; tempDir: string }): string | undefined {
  if (dir.startsWith('\\\\')) return 'Shtigjet e rrjetit s\'mbështeten: nxirre paketën në një disk lokal.';
  if (inside(dir, opts.tempDir)) return 'Programi po ekzekutohet nga një dosje e përkohshme (ndoshta direkt nga ZIP-i). Nxirre ZIP-in më parë (Extract All) në dosjen ku do ta mbash, pastaj hap Instalo.cmd prej andej.';
  if (inside(dir, opts.dataDir) || inside(opts.dataDir, dir)) return `Dosja e programit s'mund të jetë dosja e raporteve (${opts.dataDir}) ose ta përmbajë atë.`;
  if (/[%!^"]/.test(dir)) return 'Shtegu i dosjes përmban karaktere të papranueshme (% ! ^ "). Zgjidh një dosje tjetër.';
  if (dir.length > 180) return 'Shtegu i dosjes është shumë i gjatë: zgjidh një dosje më të shkurtër (p.sh. C:\\Programet\\SEO Tool).';
  return undefined;
}

// ------------------------------------------------------------------ regjistri (reg.exe, i nënshkruar)

/**
 * Lexon një vlerë tekst nga çelësi i çinstalimit. `reg query` shkruan në faqen e kodit të konsolës (ë/ç
 * prishen), prandaj përdoret `reg export`, që shkruan UTF-16 në një skedar të përkohshëm.
 */
function regQuery(name: string, key = REG_KEY): string | undefined {
  const file = path.join(os.tmpdir(), `seo-tool-reg-${process.pid}-${Date.now()}.reg`);
  try {
    execFileSync('reg.exe', ['export', key, file, '/y'], { windowsHide: true, stdio: 'ignore' });
    return parseRegExport(fs.readFileSync(file).toString('utf16le'), name);
  } catch {
    return undefined;
  } finally {
    removeSync(file);
  }
}

/**
 * Vlera tekst nga një skedar .reg: `"emri"="..."` (REG_SZ, me \\ dhe \" të escape-uara) ose
 * `"emri"=hex(2):..` (REG_EXPAND_SZ, bajte UTF-16LE, mund të vazhdojë në rreshta të tjerë me "\").
 */
export function parseRegExport(text: string, name: string): string | undefined {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`"${name}"=`));
  if (i < 0) return undefined;
  const value = lines[i]!.slice(name.length + 3);
  if (value.startsWith('"')) return value.slice(1).replace(/"\s*$/, '').replace(/\\(.)/g, '$1');
  if (!value.startsWith('hex(2):')) return undefined;
  let hex = value.slice(7);
  for (let j = i + 1; hex.trimEnd().endsWith('\\') && j < lines.length; j++) hex = hex.trimEnd().slice(0, -1) + lines[j]!.trim();
  const bytes = Buffer.from(hex.split(',').filter(Boolean).map((h) => parseInt(h, 16)));
  return bytes.toString('utf16le').replace(/\0+$/, '');
}

/** %USERPROFILE% etj. → vlerat e mjedisit (si ExpandEnvironmentStrings). */
export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (m, k: string) => {
    const hit = Object.keys(env).find((e) => e.toLowerCase() === k.toLowerCase());
    return hit ? env[hit]! : m;
  });
}

function regSet(name: string, value: string | number): void {
  const type = typeof value === 'number' ? 'REG_DWORD' : 'REG_SZ';
  execFileSync('reg.exe', ['add', REG_KEY, '/v', name, '/t', type, '/d', String(value), '/f'], { windowsHide: true, stdio: 'ignore' });
}

export function previousInstallDir(): string | undefined {
  return regQuery('InstallLocation');
}

// ------------------------------------------------------------------ shkurtoret

/**
 * Dosjet e Start Menu dhe Desktop sipas Windows (User Shell Folders): Desktop mund të jetë i ridrejtuar,
 * p.sh. te OneDrive\Desktop, prandaj s'merret si %USERPROFILE%\Desktop.
 */
const USER_SHELL_FOLDERS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
function shellFolder(name: 'Programs' | 'Desktop', fallback: string): string {
  const v = regQuery(name, USER_SHELL_FOLDERS);
  return v ? expandEnv(v) : fallback;
}
function startMenuDir(env = process.env): string {
  return shellFolder('Programs', path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
}
const desktopDir = () => shellFolder('Desktop', path.join(os.homedir(), 'Desktop'));
export const startMenuLink = () => path.join(startMenuDir(), `${APP_NAME}.lnk`);
export const desktopLink = () => path.join(desktopDir(), `${APP_NAME}.lnk`);

export class ShortcutError extends Error {}

/**
 * Shkurtorja krijohet me API-në zyrtare të Windows (WScript.Shell, përmes cscript.exe të nënshkruar dhe një
 * skripti JScript të krijuar lokalisht), në një dosje të përkohshme, dhe lexohet përsëri për verifikim. Nëse
 * Windows Script Host është i çaktivizuar ose shkurtorja s'del e saktë → ShortcutError (s'ka shkurtore gjysmake).
 * SEO_TOOL_CSCRIPT: VETËM për prova (p.sh. një shteg që s'ekziston, për të simuluar WSH të çaktivizuar).
 */
export function buildVerifiedShortcut(spec: { target: string; script: string; workingDir: string; icon: string; description: string }, tmpDir: string): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const js = path.join(tmpDir, `mklnk-${id}.js`);
  const lnk = path.join(tmpDir, `SEO Tool-${id}.lnk`);
  const check = path.join(tmpDir, `mklnk-${id}.txt`);
  fs.writeFileSync(
    js,
    [
      'var a = WScript.Arguments, sh = WScript.CreateObject("WScript.Shell"), s = sh.CreateShortcut(a(0));',
      // WSH i heq thonjëzat nga argumentet: shtegu i skriptit kalon pa to dhe thonjëzat shtohen këtu.
      's.TargetPath = a(1); s.Arguments = String.fromCharCode(34) + a(2) + String.fromCharCode(34); s.WorkingDirectory = a(3); s.IconLocation = a(4) + ",0"; s.Description = a(5);',
      's.Save();',
      // Verifikim: lexohet përsëri dhe shkruhet në UTF-16 (që ë/ç të mos prishen).
      'var r = sh.CreateShortcut(a(0)), f = WScript.CreateObject("Scripting.FileSystemObject").CreateTextFile(a(6), true, true);',
      'f.WriteLine(r.TargetPath); f.WriteLine(r.Arguments); f.WriteLine(r.WorkingDirectory); f.Close();',
    ].join('\r\n'),
  );
  try {
    execFileSync(process.env.SEO_TOOL_CSCRIPT ?? 'cscript.exe', ['//nologo', '//B', '//E:jscript', js, lnk, spec.target, spec.script, spec.workingDir, spec.icon, spec.description, check], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 30_000,
    });
  } catch (e) {
    removeSync(lnk);
    throw new ShortcutError(`Windows Script Host (cscript.exe) s'punoi: ${(e as Error).message.split(/\r?\n/)[0]}`);
  } finally {
    removeSync(js);
  }
  let got: string[] = [];
  try {
    got = fs.readFileSync(check).toString('utf16le').replace(/^\uFEFF/, '').split(/\r?\n/);
  } catch {
    /* s'u shkrua verifikimi */
  } finally {
    removeSync(check);
  }
  const want = [spec.target, `"${spec.script}"`, spec.workingDir];
  if (!fs.existsSync(lnk) || want.some((w, i) => (got[i] ?? '').toLowerCase() !== w.toLowerCase())) {
    removeSync(lnk);
    throw new ShortcutError(`Shkurtorja u krijua jo saktë (lexuar: ${got.slice(0, 3).join(' | ') || 'asgjë'}).`);
  }
  return lnk;
}

// ------------------------------------------------------------------ ndihmës

async function dashboardRunning(dataDir: string): Promise<boolean> {
  return (await runningInstance(path.join(dataDir, 'output'))) !== undefined;
}

/**
 * Skedarët e programit që mbajnë shënimin "shkarkuar nga interneti" (Mark-of-the-Web, rrjedha Zone.Identifier).
 * Me Smart App Control, Windows nuk e hap programin nga Start Menu kur node.exe e ka këtë shënim.
 */
export function markedFromWeb(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const f = path.join(e.parentPath, e.name);
    if (fs.existsSync(`${f}:Zone.Identifier`)) out.push(f);
  }
  return out;
}

function dirSizeKb(dir: string): number {
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
  return Math.round(bytes / 1024);
}

interface Io {
  yes: boolean;
  ask(question: string, def: boolean): Promise<boolean>;
  close(): void;
}

function makeIo(yes: boolean): Io {
  const rl = yes ? undefined : readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    yes,
    async ask(question, def) {
      if (!rl) return def;
      const a = (await rl.question(`${question} ${def ? '[P/j]' : '[p/J]'} `)).trim().toLowerCase();
      return a === '' ? def : a.startsWith('p') || a.startsWith('y');
    },
    close: () => rl?.close(),
  };
}

// ------------------------------------------------------------------ instalimi

/** Udhëzimi kur skedarët e programit kanë ende shënimin "shkarkuar nga interneti". */
export function motwInstructions(count: number, dir: string): string {
  return [
    `${count} skedarë të programit kanë shënimin "shkarkuar nga interneti" (ZIP-i s'u zhbllokua para nxjerrjes).`,
    'Instalimi u ndal pa ndryshuar asgjë. Ky shënim s\'hiqet automatikisht. Bëj këto:',
    '  1. Kontrollo që ZIP-i vjen nga burimi yt dhe që SHA-256 përputhet (në cmd):',
    '       certutil -hashfile "SEO-Tool-<versioni>-windows-x64.zip" SHA256',
    '  2. Kliko djathtas mbi ZIP-in > Properties (Vetitë) > shëno "Unblock" (Zhblloko) > OK.',
    `  3. Fshi dosjen e nxjerrë (${dir}), nxirre ZIP-in përsëri (Extract All) dhe hap Instalo.cmd.`,
  ].join('\n');
}

/** Udhëzimi kur shkurtorja s'krijohet (p.sh. Windows Script Host i çaktivizuar). */
export function noShortcutInstructions(reason: string, dir: string): string {
  return [
    `Shkurtorja në Start Menu s'u krijua: ${reason}`,
    'Instalimi NUK u përfundua: s\'u krijua asnjë shkurtore dhe programi s\'u regjistrua te Aplikacionet.',
    'Programi është i plotë dhe mund të hapet pa shkurtore:',
    `  - hap "Hap SEO Tool.cmd" te ${dir}`,
    `  - ose në cmd: "${path.join(dir, 'runtime', 'node.exe')}" "${path.join(dir, 'app', 'dist', 'app', 'launch.js')}"`,
    'Për shkurtoren: aktivizo Windows Script Host (ose kërkoji administratorit) dhe hap përsëri Instalo.cmd.',
  ].join('\n');
}

/** Shtegu për t'u shfaqur (dritarja e Setup.exe, konsola): pa emrin e përdoruesit, që pamjet të ndahen pa të. */
export function shownPath(p: string, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  for (const [base, label] of [[env.LOCALAPPDATA, '%LOCALAPPDATA%'], [env.APPDATA, '%APPDATA%'], [home, '%USERPROFILE%']] as const) {
    if (!base) continue;
    const b = base.replace(/[\\/]+$/, '');
    const lp = p.toLowerCase(), lb = b.toLowerCase();
    if (lp === lb || lp.startsWith(`${lb}\\`) || lp.startsWith(`${lb}/`)) return label + p.slice(b.length);
  }
  return p;
}

export async function install(opts: { yes: boolean; desktop?: boolean; open?: boolean; keepPrevious?: boolean }): Promise<number> {
  const dir = installDirOf();
  const dataDir = defaultDataDir();
  const problem = installDirProblem(dir, { dataDir, tempDir: os.tmpdir() });
  if (problem) {
    console.error(problem);
    return 2;
  }
  const version = fs.readFileSync(path.join(dir, 'version.txt'), 'utf8').trim();
  const io = makeIo(opts.yes);
  try {
    console.log(`${APP_NAME} ${version}`);
    console.log(`Dosja e programit: ${shownPath(dir)}`);
    console.log(`Raportet dhe konfigurimi: ${shownPath(dataDir)} (përditësimi s'i prek; çinstalimi i ruan si parazgjedhje)`);
    console.log('');

    // 1. Kontrollet, para çdo ndryshimi.
    const marked = markedFromWeb(dir);
    if (marked.length) {
      console.error(motwInstructions(marked.length, dir));
      return 4;
    }
    if (await dashboardRunning(dataDir)) {
      console.error(`${APP_NAME} është i hapur. Mbyll dritaren e tij dhe hap përsëri Instalo.cmd.`);
      return 3;
    }
    const prev = previousInstallDir();
    const other = prev && norm(prev) !== norm(dir) && fs.existsSync(path.join(prev, 'runtime', 'node.exe')) ? prev : undefined;
    let removeOther = false;
    if (other) {
      console.log(`Versioni i mëparshëm është te: ${shownPath(other)}`);
      // --keep-previous (Setup.exe /KEEPPREVIOUS ose 'Jo' në dritare): programi i vjetër mbetet ku është.
      removeOther = opts.keepPrevious ? false : await io.ask('Të hiqen skedarët e programit të vjetër? (raportet dhe skedarët e tu mbeten)', true);
      if (!removeOther) console.log('Programi i vjetër mbetet; Start Menu dhe çinstalimi tregojnë tani këtë instalim.');
    }
    const desktop = opts.desktop ?? (opts.yes ? false : await io.ask('Shkurtore edhe në Desktop?', false));

    // 2. Shkurtorja krijohet dhe verifikohet në një dosje të përkohshme; pa të, s'ndryshohet asgjë.
    const tmp = path.join(dataDir, 'tmp');
    const spec = {
      target: path.join(dir, 'runtime', 'node.exe'),
      script: path.join(dir, 'app', 'dist', 'app', 'launch.js'),
      workingDir: dir,
      icon: path.join(dir, 'app', 'seo-tool.ico'),
      description: 'SEO Tool: auditim lokal i website-eve',
    };
    let built: string;
    try {
      built = buildVerifiedShortcut(spec, tmp);
    } catch (e) {
      if (!(e instanceof ShortcutError)) throw e;
      console.error(noShortcutInstructions(e.message, dir));
      return 5;
    }

    // 3. Ndryshimet.
    const removeOld = () => {
      if (!(other && removeOther)) return;
      for (const name of OWNED) removeSync(path.join(other, name));
      try {
        fs.rmdirSync(other);
      } catch {
        /* dosja s'është bosh: mbeten skedarët e përdoruesit */
      }
      console.log('U hoq versioni i vjetër.');
    };
    const stale = pruneStale(dir);
    if (stale.length) console.log(`U hoqën ${stale.length} skedarë të versionit të mëparshëm nga runtime\\ dhe app\\: ${stale.slice(0, 5).join(', ')}${stale.length > 5 ? ' …' : ''}`);
    // Shkurtoret vendosen të gjitha ose asnjë: nëse njëra dështon, hiqen të vendosurat dhe s'regjistrohet asgjë.
    const targets = [startMenuLink(), ...(desktop ? [desktopLink()] : [])];
    const placed: string[] = [];
    try {
      for (const t of targets) {
        fs.mkdirSync(path.dirname(t), { recursive: true });
        fs.copyFileSync(built, t);
        placed.push(t);
      }
    } catch (e) {
      for (const t of placed) removeSync(t);
      console.error(noShortcutInstructions(`s'u vendos te ${targets[placed.length]}: ${(e as Error).message}`, dir));
      return 5;
    } finally {
      removeSync(built);
    }
    for (const t of placed) console.log(`Shkurtorja: ${shownPath(t)}`);
    removeOld();

    const node = spec.target;
    const setup = path.join(dir, 'app', 'dist', 'app', 'setup.js');
    regSet('DisplayName', APP_NAME);
    regSet('DisplayVersion', version);
    regSet('Publisher', 'SEO Tool (lokal)');
    regSet('InstallLocation', dir);
    regSet('DisplayIcon', spec.icon);
    regSet('UninstallString', `"${node}" "${setup}" uninstall`);
    regSet('QuietUninstallString', `"${node}" "${setup}" uninstall --yes`);
    regSet('EstimatedSize', dirSizeKb(dir));
    regSet('NoModify', 1);
    regSet('NoRepair', 1);
    regSet('InstallDate', new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    console.log('U regjistrua te Cilësimet > Aplikacionet (për çinstalim).');
    console.log('');
    console.log(`${APP_NAME} u instalua. Hape nga Start Menu: ${APP_NAME}.`);

    const open = opts.open ?? (opts.yes ? false : await io.ask(`Të hapet ${APP_NAME} tani?`, true));
    if (open) spawn('explorer.exe', [startMenuLink()], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    return 0;
  } finally {
    io.close();
  }
}

// ------------------------------------------------------------------ çinstalimi

export async function uninstall(opts: { yes: boolean; deleteData?: boolean }): Promise<number> {
  const dir = installDirOf();
  const dataDir = defaultDataDir();
  const io = makeIo(opts.yes);
  try {
    if (await dashboardRunning(dataDir)) {
      console.error(`${APP_NAME} është i hapur. Mbyll dritaren e tij dhe provo përsëri.`);
      return 3;
    }
    if (!(await io.ask(`Të çinstalohet ${APP_NAME} nga ${dir}?`, true))) return 1;
    let deleteData = opts.deleteData ?? false;
    if (opts.deleteData === undefined && !opts.yes && fs.existsSync(dataDir)) {
      console.log(`Raportet, screenshot-et, konfigurimi dhe lidhja me Search Console (gsc\\) janë te: ${shownPath(dataDir)}`);
      console.log(`Fshirja s'e revokon token-in te Google: për këtë përdor "Shkëput llogarinë" në dashboard para çinstalimit.`);
      deleteData = await io.ask('Të fshihen edhe ato? (parazgjedhje: JO, mbeten në kompjuter)', false);
    }

    for (const lnk of [startMenuLink(), desktopLink()]) removeSync(lnk);
    if (norm(previousInstallDir() ?? dir) === norm(dir)) {
      try {
        execFileSync('reg.exe', ['delete', REG_KEY, '/f'], { windowsHide: true, stdio: 'ignore' });
      } catch {
        /* s'ishte i regjistruar */
      }
    }
    if (deleteData && fs.existsSync(dataDir)) {
      // Vetëm dosja e njohur e të dhënave (%LOCALAPPDATA%\SEO Tool), asgjë tjetër.
      if (path.basename(dataDir) !== APP_NAME) throw new Error(`Dosje e papritur të dhënash: ${dataDir}`);
      removeSync(dataDir, { retries: 3 });
      console.log(`U fshinë raportet dhe konfigurimi: ${shownPath(dataDir)}`);
    } else if (fs.existsSync(dataDir)) {
      console.log(`Raportet mbetën te: ${shownPath(dataDir)}`);
    }

    // Node-i që ekzekuton këtë skript është brenda dosjes: fshirjen e bën cmd.exe pasi ky proces të dalë.
    // Shtegu kalon si variabël mjedisi (jo brenda komandës), që hapësirat/ë/ç dhe karakteret e cmd të mos interpretohen.
    const del = OWNED.map((n) => (n.includes('.') ? `del /f /q "%SEO_DIR%\\${n}" 2>nul` : `rmdir /s /q "%SEO_DIR%\\${n}" 2>nul`)).join(' & ');
    const script = `for /l %i in (1,1,30) do @(if exist "%SEO_DIR%\\runtime\\node.exe" (del /f /q "%SEO_DIR%\\runtime\\node.exe" 2>nul & ping -n 2 127.0.0.1 >nul)) & ${del} & rmdir "%SEO_DIR%" 2>nul`;
    spawn('cmd.exe', ['/d', '/c', script], { env: { ...process.env, SEO_DIR: dir }, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    console.log(`${APP_NAME} u çinstalua. Skedarët e programit hiqen pas pak sekondash.`);
    return 0;
  } finally {
    io.close();
  }
}

// ------------------------------------------------------------------ hyrja

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (f: string) => rest.includes(f);
  const yes = flag('--yes');
  if (cmd === 'install') {
    return install({ yes, desktop: flag('--desktop') ? true : flag('--no-desktop') ? false : undefined, open: flag('--open') ? true : flag('--no-open') ? false : undefined, keepPrevious: flag('--keep-previous') });
  }
  if (cmd === 'uninstall') return uninstall({ yes, deleteData: flag('--delete-data') ? true : flag('--keep-data') ? false : undefined });
  console.log('Përdorimi: setup.js install [--yes] [--desktop] [--open] [--keep-previous] | uninstall [--yes] [--delete-data|--keep-data]');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.title = `${APP_NAME}: instalimi`;
  main()
    .catch((e: Error) => {
      console.error(`Gabim: ${e.message}`);
      return 1;
    })
    .then(async (code) => {
      // Dritarja e hapur nga Instalo.cmd/Cilësimet mbetet pak, që mesazhi të lexohet.
      if (!process.argv.includes('--yes')) await new Promise((r) => setTimeout(r, code === 0 ? 4000 : 20_000));
      process.exit(code);
    });
}
