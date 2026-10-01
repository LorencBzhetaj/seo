import { spawnSync } from 'node:child_process';

/**
 * A është Git në PATH? Auditi i repo-ve ka nevojë për të (klon i cekët); programi s'e paketon. Pa Git,
 * auditet e URL-së dhe të dosjeve vazhdojnë normalisht.
 */
export function gitAvailable(): boolean {
  try {
    const r = spawnSync('git', ['--version'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
    return r.status === 0;
  } catch {
    return false;
  }
}
