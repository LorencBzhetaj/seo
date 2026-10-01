import fs from 'node:fs';
import path from 'node:path';

/**
 * Fshirje sinkrone e një skedari ose dosjeje (rekursive), në vend të `fs.rmSync`.
 *
 * Pse: në Node 24.11 në Windows, `fs.rmSync` s'bën asgjë (dhe s'jep gabim) kur shtegu ka karaktere jo-ASCII
 * (p.sh. "C:\Users\Ëndrit\…" ose "…\Programe ë ç\…"); u provua. `unlinkSync`/`rmdirSync` funksionojnë.
 * Riprovon kur skedari është i zënë për pak çaste (antivirus, Chrome që po mbyllet) dhe heq atributin
 * read-only (p.sh. objektet e .git). Shteg që s'ekziston = s'ka gabim.
 */
export function removeSync(target: string, opts: { retries?: number; retryDelayMs?: number } = {}): void {
  const retries = opts.retries ?? 3;
  const delay = opts.retryDelayMs ?? 200;
  for (let attempt = 0; ; attempt++) {
    try {
      removeOnce(target);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= retries || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE'].includes(code ?? '')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    }
  }
}

function removeOnce(target: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(target)) removeOnce(path.join(target, name));
    try {
      fs.rmdirSync(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return;
  }
  try {
    fs.unlinkSync(target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code !== 'EPERM' && code !== 'EACCES') throw e;
    // Skedar read-only (p.sh. .git/objects): hiqet atributi, pastaj fshihet.
    fs.chmodSync(target, 0o666);
    fs.unlinkSync(target);
  }
}
