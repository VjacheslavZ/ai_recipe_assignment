import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockClient } from '../ai/mock.js';
import { parseConfig } from '../config.js';
import { RunStore } from '../run/store.js';
import { runPipeline } from './runner.js';
import { STAGES, type Stage, type StageDefinition } from './types.js';

let runsDir: string;
beforeEach(async () => {
  runsDir = await mkdtemp(path.join(os.tmpdir(), 'recipe-runner-'));
});
afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function setup(failAt?: Stage) {
  const config = parseConfig({ AI_PROVIDER: 'mock', RUNS_DIR: runsDir }, runsDir);
  const store = RunStore.create(runsDir, 'test', config);
  const ai = createMockClient(config, { delayMs: 0, onCall: (c) => store.recordAiCall(c) });
  const ran: Stage[] = [];
  const stages: StageDefinition[] = STAGES.map((id, i) => ({
    no: i + 1,
    id,
    title: id,
    run: async (ctx) => {
      ran.push(id);
      if (id === failAt) throw new Error(`${id} exploded`);
      ctx.store.writeJson(id, 'out.json', { id });
      if (id === 'create') await ctx.ai.generateImage({ purpose: 'create.bg', prompt: 'x', size: '8x8' });
    },
  }));
  const run = (o: { fromStep?: number; toStep?: number } = {}) => runPipeline({ stages, store, config, ai, ...o });
  return { store, ran, run, status: () => Object.fromEntries(STAGES.map((s) => [s, store.getState().stages[s].status])) };
}

describe('runPipeline', () => {
  it('runs all stages in order and writes a cost report', async () => {
    const { ran, run, status } = setup();
    const res = await run();
    expect(ran).toEqual([...STAGES]);
    expect(res.ran).toEqual([...STAGES]);
    expect(Object.values(status())).toEqual(Array(5).fill('done'));
    expect(res.costReport.totals).toMatchObject({ calls: 1, imageCount: 1 });
  });

  it('stops on failure, marks the stage failed and still writes the cost report', async () => {
    const { store, ran, run, status } = setup('plan');
    await expect(run()).rejects.toThrow('plan exploded');
    expect(ran).toEqual(['brief', 'analysis', 'plan']);
    expect(status()).toMatchObject({ brief: 'done', analysis: 'done', plan: 'failed', create: 'pending' });
    expect(store.getState().stages.plan.error).toBe('plan exploded');
    expect(existsSync(path.join(store.runDir, 'cost_report.json'))).toBe(true);
  });

  it('resumes from the first unfinished stage, or from an explicit step', async () => {
    const { ran, run } = setup();
    await run({ toStep: 2 });
    ran.length = 0;
    await run({ toStep: 3 });
    expect(ran).toEqual(['plan']);
    ran.length = 0;
    await run({ fromStep: 2, toStep: 3 });
    expect(ran).toEqual(['analysis', 'plan']);
  });

  it('honours toStep and resets stale later stages', async () => {
    const { ran, run, status } = setup();
    await run({ toStep: 3 });
    expect(ran).toEqual(['brief', 'analysis', 'plan']);
    expect(status()).toMatchObject({ plan: 'done', create: 'pending' });
    await run();
    await run({ fromStep: 2, toStep: 2 });
    expect(status()).toMatchObject({ analysis: 'done', plan: 'pending', review: 'pending' });
  });

  it('rejects resuming when an earlier step is not done', async () => {
    const { run } = setup();
    await expect(run({ fromStep: 3 })).rejects.toThrow(/earlier steps are not done: 1 brief \(pending\), 2 analysis/);
    await expect(run({ fromStep: 9 })).rejects.toThrow(/not a valid step/);
  });
});
