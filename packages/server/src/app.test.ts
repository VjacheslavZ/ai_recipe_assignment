import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot, parseConfig } from '@recipe/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { jobs, openDb, runs } from './db.js';
import { PendingQuestions, RunEvents, type RunEvent } from './events.js';
import { JobWorker } from './worker.js';

const root = findRepoRoot();
const briefYaml = readFileSync(path.join(root, 'brief.example.yaml'), 'utf8');
const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function setup(questionTimeoutMs = 20) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'recipe-server-'));
  const config = parseConfig({ AI_PROVIDER: 'mock', RUNS_DIR: path.join(tmp, 'runs'), BRAND_KIT_DIR: path.join(tmp, 'kit') }, root);
  const { db, close } = openDb(':memory:');
  closers.push(close);
  const events = new RunEvents();
  const questions = new PendingQuestions(events, questionTimeoutMs);
  const worker = new JobWorker({ db, config, events, questions });
  const app = await buildApp({ config, db, events, questions, worker });
  closers.push(() => void app.close());
  return { app, db, events, questions, worker, config };
}

describe('server', () => {
  it('rejects an invalid brief', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/runs', payload: { briefYaml: 'brand: {}' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates a run, processes the queued job end to end and serves posts, files, costs and the zip', async () => {
    const { app, worker } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/runs', payload: { briefYaml } });
    expect(created.statusCode).toBe(201);
    const { runId } = created.json<{ runId: string }>();

    expect((await app.inject(`/api/runs/${runId}`)).json()).toMatchObject({ status: 'queued' });
    expect(await worker.tick()).toBe(true);

    const run = (await app.inject(`/api/runs/${runId}`)).json<{ status: string; state: { stages: Record<string, { status: string }> } }>();
    expect(run.status).toBe('succeeded');
    expect(Object.values(run.state.stages).every((s) => s.status === 'done')).toBe(true);

    const posts = (await app.inject(`/api/runs/${runId}/posts`)).json<{ reviewed: boolean; posts: { slides: { url: string; qa: unknown }[] }[] }>();
    expect(posts.reviewed).toBe(true);
    expect(posts.posts).toHaveLength(3);
    const slide = await app.inject(posts.posts[0]!.slides[0]!.url);
    expect(slide.statusCode).toBe(200);
    expect(slide.headers['content-type']).toBe('image/png');

    expect((await app.inject(`/api/runs/${runId}/artifacts/plan`)).json()).toHaveProperty('posts');
    expect((await app.inject(`/api/runs/${runId}/costs`)).json()).toHaveProperty('totals');
    const zip = await app.inject(`/api/runs/${runId}/download`);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect((await app.inject('/api/runs')).json()).toHaveLength(1);
  });

  it('does not serve files outside the run folder', async () => {
    const { app } = await setup();
    const { runId } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { briefYaml } })).json<{ runId: string }>();
    const res = await app.inject(`/api/runs/${runId}/files/..%2F..%2F.env`);
    expect(res.statusCode).toBe(404);
  });

  it('streams stage events and lets a human answer the price question through the API', async () => {
    const { app, events, worker } = await setup(5_000);
    const { runId } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { briefYaml } })).json<{ runId: string }>();
    const seen: RunEvent[] = [];
    events.subscribe(runId, (e) => {
      seen.push(e);
      if (e.type === 'question') void app.inject({ method: 'POST', url: `/api/runs/${runId}/answers`, payload: { questionId: e.question.id, answer: '24.90' } });
    });
    await worker.tick();

    expect(seen.some((e) => e.type === 'stage' && e.stage === 'review' && e.status === 'done')).toBe(true);
    expect(seen.filter((e) => e.type === 'question').length).toBeGreaterThan(0);
    expect(seen.filter((e) => e.type === 'question_answered').length).toBe(seen.filter((e) => e.type === 'question').length);
    const analysis = (await app.inject(`/api/runs/${runId}/artifacts/analysis`)).json<{ products: { price: { status: string; amount: number | null } }[] }>();
    expect(analysis.products.some((p) => p.price.status === 'confirmed_by_user' && p.price.amount === 24.9)).toBe(true);
    expect(seen.at(-1)).toEqual({ type: 'run', status: 'succeeded' });
  });

  it('requeues jobs left running by a crash and rejects reruns of an active run', async () => {
    const { app, db, worker } = await setup();
    const { runId } = (await app.inject({ method: 'POST', url: '/api/runs', payload: { briefYaml } })).json<{ runId: string }>();
    expect((await app.inject({ method: 'POST', url: `/api/runs/${runId}/rerun`, payload: { fromStep: 3 } })).statusCode).toBe(409);

    db.update(jobs).set({ status: 'running' }).run();
    expect(worker.requeueStale()).toBe(1);
    await worker.tick();
    expect(db.select().from(runs).get()?.status).toBe('succeeded');

    const rerun = await app.inject({ method: 'POST', url: `/api/runs/${runId}/rerun`, payload: { fromStep: 4 } });
    expect(rerun.statusCode).toBe(202);
    await worker.tick();
    expect(db.select().from(jobs).all().map((j) => j.status)).toEqual(['done', 'done']);
  });
});
