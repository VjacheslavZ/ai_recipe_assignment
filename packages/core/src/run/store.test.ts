import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AiCallRecord } from '../ai/types.js';
import { RunStore } from './store.js';

let runsDir: string;
beforeEach(async () => {
  runsDir = await mkdtemp(path.join(os.tmpdir(), 'recipe-store-'));
});
afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

const call = (over: Partial<AiCallRecord>): AiCallRecord => ({
  id: Math.random().toString(36),
  purpose: 'analysis.site',
  provider: 'openai',
  model: 'gpt-6-luna',
  kind: 'text',
  inputTokens: 100,
  outputTokens: 50,
  imageCount: 0,
  webSearchCalls: 0,
  costUsd: 0.001,
  durationMs: 10,
  status: 'ok',
  retryCount: 0,
  startedAt: new Date().toISOString(),
  ...over,
});

describe('RunStore', () => {
  it('creates the run layout and reopens it', async () => {
    const store = RunStore.create(runsDir, 'GymBeam HR', { AI_PROVIDER: 'mock', OPENAI_API_KEY: 'sk-secret' });
    expect(store.runId).toMatch(/^gymbeam-hr_\d{8}-\d{6}$/);
    expect(path.basename(store.stageDir('analysis'))).toBe('02_analysis');

    const reopened = RunStore.open(runsDir, store.runId);
    expect(reopened.getState().stages.brief.status).toBe('pending');
    expect(() => RunStore.open(runsDir, 'nope')).toThrow(/not found/);
    expect(() => RunStore.open(runsDir, '../etc')).toThrow(/Invalid run id/);
  });

  it('never stores the API key in the snapshot', async () => {
    const store = RunStore.create(runsDir, 'b', { OPENAI_API_KEY: 'sk-secret', OPENAI_TEXT_MODEL: 'gpt-6-luna' });
    expect(store.getState().configSnapshot).toEqual({ OPENAI_TEXT_MODEL: 'gpt-6-luna' });
    const files = ['state.json', 'config.json'].map((f) => readFile(path.join(store.runDir, f), 'utf8'));
    for (const text of await Promise.all(files)) expect(text).not.toContain('sk-secret');
  });

  it('round-trips JSON with schema validation', () => {
    const store = RunStore.create(runsDir, 'b', {});
    const schema = z.object({ posts: z.array(z.string()) });
    store.writeJson('plan', 'plan.json', { posts: ['a', 'b'] });
    expect(store.readJson('plan', 'plan.json', schema)).toEqual({ posts: ['a', 'b'] });
    store.writeJson('plan', 'bad.json', { posts: 'nope' });
    expect(() => store.readJson('plan', 'bad.json', schema)).toThrow(/Invalid 03_plan\/bad.json/);
    expect(store.exists('plan', 'plan.json')).toBe(true);
    expect(store.exists('plan', 'missing.json')).toBe(false);
    store.writeBuffer('create', 'img/a.png', Buffer.from([1, 2]));
    expect(store.exists('create', 'img/a.png')).toBe(true);
    expect(() => store.writeText('plan', '../../escape.txt', 'x')).toThrow(/escapes/);
  });

  it('tracks stage transitions and persists them', () => {
    const store = RunStore.create(runsDir, 'b', {});
    store.markStage('brief', 'running');
    expect(store.getState().stages.brief).toMatchObject({ status: 'running', startedAt: expect.any(String) });
    store.markStage('brief', 'done', { artifacts: ['01_brief/brief.json'] });
    store.markStage('analysis', 'running');
    store.markStage('analysis', 'failed', { error: 'boom' });
    const state = RunStore.open(runsDir, store.runId).getState();
    expect(state.stages.brief).toMatchObject({ status: 'done', artifacts: ['01_brief/brief.json'], finishedAt: expect.any(String) });
    expect(state.stages.analysis).toMatchObject({ status: 'failed', error: 'boom' });
    store.markStage('analysis', 'running');
    expect(store.getState().stages.analysis.error).toBeUndefined();
  });

  it('logs AI calls and aggregates the cost report', async () => {
    const store = RunStore.create(runsDir, 'b', {});
    store.markStage('analysis', 'running');
    store.recordAiCall(call({ webSearchCalls: 1 }));
    store.recordAiCall(call({ model: 'mystery', costUsd: null }));
    store.markStage('analysis', 'done');
    store.recordAiCall(call({ purpose: 'create.bg', kind: 'image', model: 'gpt-image-1-mini', imageCount: 1, costUsd: 0.01 }));

    const report = store.writeCostReport();
    expect(report.totals).toMatchObject({ calls: 3, inputTokens: 300, imageCount: 1, webSearchCalls: 1, unpricedCalls: 1, costUsd: 0.011 });
    expect(report.byStage.analysis?.calls).toBe(2);
    expect(report.byStage.create?.calls).toBe(1); // inferred from purpose prefix
    expect(report.byModel['openai:mystery']?.unpricedCalls).toBe(1);
    expect(report.unpriced).toHaveLength(1);
    const onDisk = JSON.parse(await readFile(path.join(store.runDir, 'cost_report.json'), 'utf8'));
    expect(onDisk.totals.calls).toBe(3);
    expect(store.readAiCalls().map((c) => c.stage)).toEqual(['analysis', 'analysis', 'create']);
  });
});
