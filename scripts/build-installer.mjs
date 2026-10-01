// Ndërton paketën e Windows: build/SEO-Tool-<version>-windows-x64.zip
//
//   npm run installer            (ose: node scripts/build-installer.mjs [--no-prune-sentry])
//
// Pse ZIP + Instalo.cmd dhe jo një Setup.exe: Smart App Control i Windows 11 bllokon çdo .exe të panënshkruar
// (edhe instaluesit), ndërsa Node-i i paketuar është i nënshkruar dhe .cmd/cscript lejohen. Përdoruesi e
// nxjerr ZIP-in ku do; ajo dosje është dosja e instalimit. Instalo.cmd krijon shkurtoren dhe regjistrimin.
//
// Hapat: tsc → "stage" (Node i këtij kompjuteri + dist + vetëm varësitë e prodhimit, të pastruara) → ZIP me
// tar.exe të Windows. S'shkarkon asgjë: Node merret nga ai që ekzekuton këtë skript.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIcon } from './make-icon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const TOP = 'SEO Tool';
const STAGE = path.join(BUILD, 'stage', TOP);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pruneSentry = !process.argv.includes('--no-prune-sentry');

const log = (...a) => console.log('•', ...a);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) {
      bytes += fs.statSync(path.join(e.parentPath, e.name)).size;
      files++;
    }
  }
  return { bytes, files };
}

if (process.platform !== 'win32') throw new Error('Paketa e Windows ndërtohet vetëm në Windows.');

log('tsc');
// dist/ ndërtohet nga e para, që skedarë të vjetër (module të hequra) të mos hyjnë në paketë.
fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'inherit' });

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'runtime'), { recursive: true });
fs.mkdirSync(path.join(STAGE, 'app'), { recursive: true });

// 1. Node: i njëjti binar (i nënshkruar) që ekzekuton këtë skript, me licencën e tij.
fs.copyFileSync(process.execPath, path.join(STAGE, 'runtime', 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) fs.copyFileSync(nodeLicense, path.join(STAGE, 'runtime', 'LICENSE-node.txt'));

// 2. Programi: dist pa source maps, package.json minimal (type: module), ikona.
fs.cpSync(path.join(ROOT, 'dist'), path.join(STAGE, 'app', 'dist'), { recursive: true, filter: (src) => !src.endsWith('.map') });
fs.writeFileSync(path.join(STAGE, 'app', 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module' }, null, 2));
makeIcon(path.join(STAGE, 'app', 'seo-tool.ico'));

// 3. Varësitë e prodhimit (pa devDependencies), sipas pemës që raporton npm.
const parseable = execFileSync('npm.cmd', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: ROOT, encoding: 'utf8', shell: true });
const pkgDirs = [...new Set(parseable.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && path.resolve(l) !== ROOT))];
for (const dir of pkgDirs) {
  const rel = path.relative(ROOT, dir);
  if (!rel.startsWith('node_modules')) continue;
  // Çdo paketë kopjohet pa node_modules e saj; paketat e mbivendosura janë në listë më vete.
  fs.cpSync(dir, path.join(STAGE, 'app', rel), { recursive: true, filter: (src) => path.relative(dir, src).split(path.sep)[0] !== 'node_modules' });
}
const deps = dirStats(path.join(STAGE, 'app', 'node_modules'));

// 4. Pastrimi: skedarë që s'nevojiten në ekzekutim.
const pruned = { files: 0, bytes: 0, sentry: 0 };
const removeFile = (f) => {
  const n = fs.statSync(f).size;
  pruned.bytes += n;
  pruned.files++;
  fs.rmSync(f);
  return n;
};
const removeDir = (d) => {
  if (!fs.existsSync(d)) return 0;
  const s = dirStats(d);
  pruned.bytes += s.bytes;
  pruned.files += s.files;
  fs.rmSync(d, { recursive: true, force: true });
  return s.bytes;
};
for (const e of fs.readdirSync(path.join(STAGE, 'app', 'node_modules'), { withFileTypes: true, recursive: true })) {
  if (!e.isFile()) continue;
  if (/\.(map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/i.test(e.name) || (/\.(md|markdown)$/i.test(e.name) && !/^licen[cs]e/i.test(e.name))) removeFile(path.join(e.parentPath, e.name));
}
// Lokalizimet e Lighthouse NUK hiqen: locales.js i importon të gjitha statikisht (provuar: pa to Lighthouse dështon).
// Sentry/OpenTelemetry: Lighthouse i ngarkon vetëm kur raportimi i gabimeve drejt Sentry është aktiv, gjë që
// ky tool s'e aktivizon kurrë (asnjë e dhënë s'del jashtë). Hiqen nga paketa.
if (pruneSentry) for (const d of ['@sentry', '@opentelemetry']) pruned.sentry += removeDir(path.join(STAGE, 'app', 'node_modules', d));

// 5. Skedarë për përdoruesin.
fs.writeFileSync(path.join(STAGE, 'version.txt'), `${pkg.version}\r\n`);
const cmd = (body) => `@echo off\r\n${body}\r\n`;
fs.writeFileSync(path.join(STAGE, 'Instalo.cmd'), cmd('rem Krijon shkurtoren e SEO Tool ne Start Menu dhe e regjistron per cinstalim (pa administrator).\r\n"%~dp0runtime\\node.exe" "%~dp0app\\dist\\app\\setup.js" install %*'));
fs.writeFileSync(path.join(STAGE, 'Hap SEO Tool.cmd'), cmd('rem Hap SEO Tool pa e instaluar (perdorim portativ).\r\n"%~dp0runtime\\node.exe" "%~dp0app\\dist\\app\\launch.js"'));
fs.writeFileSync(path.join(STAGE, 'seo-audit.cmd'), cmd('rem CLI-ja e SEO Tool (i njejti motor si dashboard-i). Shembull: seo-audit.cmd https://siti-yt.al --out raportet\r\n"%~dp0runtime\\node.exe" "%~dp0app\\dist\\cli.js" %*'));
fs.writeFileSync(
  path.join(STAGE, 'LEXOME.txt'),
  [
    `SEO Tool ${pkg.version} për Windows 10/11 (x64)`,
    '',
    'Instalimi',
    '  1. Kontrollo burimin: ZIP-i duhet të vijë nga vendi ku e ruan vetë (p.sh. dosja jote build\\ ose një kopje',
    '     që e ke bërë vetë). Krahaso SHA-256 me vlerën e ruajtur pranë tij (në cmd):',
    `       certutil -hashfile "SEO-Tool-${pkg.version}-windows-x64.zip" SHA256`,
    '  2. Nëse ZIP-i u shkarkua ose u kopjua nga interneti: kliko djathtas mbi ZIP > Properties (Vetitë) >',
    '     shëno "Unblock" (Zhblloko) > OK. Programi s\'e heq vetë këtë shënim; pa këtë hap, Instalo.cmd ndalon',
    '     (dhe me Smart App Control Windows e bllokon).',
    '  3. Nxirre ZIP-in (kliko djathtas > Extract All) në dosjen ku do ta mbash programin.',
    '  4. Hap "Instalo.cmd" nga dosja e nxjerrë dhe përgjigju pyetjeve. Krijohet shkurtorja "SEO Tool" në Start Menu.',
    '  S\'nevojiten të drejta administratori, PowerShell ose Node.js i instaluar veçmas.',
    '',
    'Përdorimi',
    '  Start Menu > SEO Tool. Hapet një dritare (programi) dhe dashboard-i në shfletues, vetëm në këtë',
    '  kompjuter (127.0.0.1). Mbyll dritaren për ta ndalur; auditet në punë anulohen dhe pastrojnë vetë.',
    '  Pa shkurtore: hap "Hap SEO Tool.cmd" në këtë dosje.',
    '',
    'Të dhënat: %LOCALAPPDATA%\\SEO Tool (raportet në output\\, config.json, skedarët e përkohshëm në tmp\\).',
    'Dashboard-i ka butonin "Hap dosjen e raporteve".',
    'Lighthouse dhe pamja vizuale përdorin Google Chrome ose Microsoft Edge të instaluar; auditi i repo-ve',
    'përdor Git for Windows. S\'paketohen: nëse mungojnë, dashboard-i tregon çfarë të instalosh.',
    '',
    'Përditësimi: nxirre versionin e ri mbi këtë dosje (ose në një dosje të re) dhe hap Instalo.cmd. Skedarët e',
    'vjetër të programit hiqen; raportet, konfigurimi dhe skedarët e tu s\'preken.',
    'Çinstalimi: Cilësimet > Aplikacionet > SEO Tool. Raportet ruhen si parazgjedhje; fshihen vetëm nëse e zgjedh ti.',
    'CLI: seo-audit.cmd --help',
    '',
  ].join('\r\n'),
);

// 6. Lista e skedarëve të këtij versioni (për përditësimin mbi të njëjtën dosje: Instalo.cmd heq të vjetrit).
const manifest = [];
for (const top of ['runtime', 'app']) {
  for (const e of fs.readdirSync(path.join(STAGE, top), { withFileTypes: true, recursive: true })) {
    if (e.isFile()) manifest.push(path.relative(STAGE, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
  }
}
manifest.push('app/manifest.txt');
fs.writeFileSync(path.join(STAGE, 'app', 'manifest.txt'), `${manifest.sort().join('\r\n')}\r\n`);

const app = dirStats(STAGE);
log(`varësitë e prodhimit: ${pkgDirs.length} paketa, ${mb(deps.bytes)}; hequr ${mb(pruned.bytes)} (${pruned.files} skedarë: Sentry/OpenTelemetry ${mb(pruned.sentry)})`);
log(`programi në disk: ${mb(app.bytes)} në ${app.files} skedarë (node.exe ${mb(fs.statSync(path.join(STAGE, 'runtime', 'node.exe')).size)})`);

// 7. ZIP me tar.exe të Windows (bsdtar), me dosjen "SEO Tool" në krye.
const zip = path.join(BUILD, `SEO-Tool-${pkg.version}-windows-x64.zip`);
execFileSync(path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', path.join(BUILD, 'stage'), TOP], { stdio: 'inherit' });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(`${zip}.sha256`, `${sha256}  ${path.basename(zip)}\n`);
log(`paketa: ${zip} (${mb(fs.statSync(zip).size)})`);
log(`SHA-256: ${sha256} (edhe te ${path.basename(zip)}.sha256)`);
