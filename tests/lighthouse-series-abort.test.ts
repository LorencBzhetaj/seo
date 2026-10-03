import { describe, expect, it } from 'vitest';
import { AbortedError, isAborting, runCleanups } from '../src/core/cleanup.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import type { LighthouseData } from '../src/lighthouse/run-lighthouse.js';
import { runLighthouseSeries } from '../src/lighthouse/series.js';
import { lighthouseFixture } from './helpers.js';

// Skedar më vete: ndërprerja (runCleanups) është gjendje globale e procesit dhe s'kthehet mbrapsht.
describe('Seria: anulimi gjatë serisë', () => {
  it('anulimi gjatë matjes 2/4 ndalon serinë: s\'niset matja 3, s\'kthehet rezultat i pjesshëm', async () => {
    const calls: number[] = [];
    const steps: string[] = [];
    const runOnce = async (): Promise<LighthouseData> => {
      calls.push(calls.length + 1);
      if (calls.length === 2) {
        // dashboard-i mbyll stdin → motori liron Chrome-in; matja në punë dështon
        await runCleanups();
        throw new Error('Chrome u mbyll gjatë matjes');
      }
      return lighthouseFixture();
    };
    const cfg = { ...DEFAULT_CONFIG, lighthouse: { ...DEFAULT_CONFIG.lighthouse, runs: 4 } };
    await expect(runLighthouseSeries('https://e.com/', cfg, runOnce, (m) => steps.push(m))).rejects.toBeInstanceOf(AbortedError);
    expect(isAborting()).toBe(true);
    expect(calls).toEqual([1, 2]);
    expect(steps).toEqual(['Lighthouse (mobile): matja 1/4', 'Lighthouse (mobile): matja 2/4']);
    // pas anulimit, një seri e re s'nis asnjë matje
    await expect(runLighthouseSeries('https://e.com/', cfg, runOnce)).rejects.toBeInstanceOf(AbortedError);
    expect(calls).toEqual([1, 2]);
  });
});
