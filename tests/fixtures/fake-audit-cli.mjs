// CLI i simuluar për testet e punëve të dashboard-it: flet të njëjtin protokoll si `cli.ts --progress-json`.
// Sjellja varet nga objekti i auditit: "fail" → gabim; "slow" → progres pa fund (për anulim, me një
// proces nip dhe një screenshot të pjesshëm që duhen pastruar); "stubborn" → si "slow", por injoron mbylljen e
// stdin-it (anulimi duhet ta ndalë me forcë); "late" → shkruan raportin, pastaj pret; përndryshe sukses.
// Me --exit-with-stdin, mbyllja e stdin-it = ndërprerje: ndal nipin, fshin screenshot-et e pjesshme, del me 130.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const val = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const out = val('--out');
const kind = val('--folder') !== undefined ? 'folder' : val('--repo') !== undefined ? 'repo' : 'url';
const target = val('--folder') ?? val('--repo') ?? argv[argv.indexOf('--') + 1];
const emit = (e) => process.stderr.write(`${JSON.stringify(e)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanups = [];
if (argv.includes('--exit-with-stdin') && !/stubborn/.test(target)) {
  process.stdin.on('data', () => {});
  process.stdin.on('end', () => {
    for (const fn of cleanups.reverse()) fn();
    emit({ event: 'aborted', reason: 'stdin u mbyll' });
    process.exit(130);
  });
}

function writeReport() {
  const name = `fake-${kind}-${Date.now()}-${process.pid}.json`;
  const report = kind === 'url'
    ? { reportSchemaVersion: '4', url: target, finalUrl: target, status: 'completed', completedAt: new Date().toISOString(), health: { score: 90, status: 'EXCELLENT' }, categories: {}, issues: [] }
    : { reportSchemaVersion: 'source-1', reportType: 'source-audit', source: { kind, name: path.basename(target) }, status: 'completed', completedAt: new Date().toISOString(), findings: [], checks: [] };
  fs.writeFileSync(path.join(out, name), JSON.stringify(report));
  return name;
}

if (/fail/.test(target)) {
  emit({ event: 'step', text: 'hapi i parë' });
  emit({ event: 'error', exitCode: 2, message: `Gabim i simuluar për ${target}` });
  process.exit(2);
}
if (kind === 'url') emit({ event: 'status', status: 'crawling' });
emit({ event: 'step', text: `nisje ${kind}` });
if (/slow|stubborn/.test(target)) {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  cleanups.push(() => grandchild.kill());
  emit({ event: 'step', text: `grandchild ${grandchild.pid}` });
  const shots = path.join(out, 'visual', `fake-${process.pid}`);
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(shots, '1-desktop.jpg'), 'pjesshëm');
  cleanups.push(() => fs.rmSync(shots, { recursive: true, force: true }));
  emit({ event: 'step', text: `shots ${shots}` });
  for (let i = 1; ; i++) {
    emit({ event: 'crawl', done: i, max: 1000, url: `${target}p/${i}` });
    await sleep(100);
  }
}
for (let i = 1; i <= 3; i++) {
  if (kind === 'url') emit({ event: 'crawl', done: i, max: 3, url: `${target}p/${i}` });
  else emit({ event: 'step', text: `hapi ${i}` });
  await sleep(30);
}
if (kind === 'url') emit({ event: 'status', status: 'scoring' });
const file = writeReport();
emit({ event: 'report', file: path.join(out, file), status: 'completed' });
if (/late/.test(target)) await sleep(10_000);
process.exit(0);
