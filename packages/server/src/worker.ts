import { existsSync } from 'node:fs';
import path from 'node:path';
import { createAiClient, mockFixtures, runPipeline, RunStore, STAGES, stages, type Config } from '@recipe/core';
import { and, asc, eq } from 'drizzle-orm';
import { aiCalls, jobs, runs, steps, type Db } from './db.js';
import type { PendingQuestions, RunEvents } from './events.js';

export interface JobPayload {
  fromStep?: number;
  toStep?: number;
}

const now = () => new Date().toISOString();
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function enqueueRun(db: Db, runId: string, payload: JobPayload = {}): number {
  const row = db
    .insert(jobs)
    .values({ runId, type: 'run_pipeline', payload: JSON.stringify(payload), status: 'queued', createdAt: now() })
    .returning({ id: jobs.id })
    .get();
  db.update(runs).set({ status: 'queued', error: null, finishedAt: null }).where(eq(runs.id, runId)).run();
  return row.id;
}

/**
 * In-process job queue on the SQLite `jobs` table (ADR-007). One job at a time:
 * pipeline runs are long and rate-limited, parallel runs would only fight for quota.
 */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private busy: Promise<void> | null = null;

  constructor(
    private readonly deps: { db: Db; config: Config; events: RunEvents; questions: PendingQuestions; pollMs?: number },
  ) {}

  /** Jobs left `running` by a crash or restart go back to the queue. */
  requeueStale(): number {
    const stale = this.deps.db.update(jobs).set({ status: 'queued', lockedAt: null }).where(eq(jobs.status, 'running')).returning().all();
    for (const j of stale) this.deps.db.update(runs).set({ status: 'queued' }).where(eq(runs.id, j.runId)).run();
    return stale.length;
  }

  start(): void {
    this.requeueStale();
    this.timer = setInterval(() => void this.tick(), this.deps.pollMs ?? 500);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.busy;
  }

  /** Claims and runs the oldest queued job, if any. Exposed for tests. */
  async tick(): Promise<boolean> {
    if (this.busy) return false;
    const job = this.claim();
    if (!job) return false;
    this.busy = this.process(job).finally(() => {
      this.busy = null;
    });
    await this.busy;
    return true;
  }

  private claim() {
    const { db } = this.deps;
    const next = db.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.createdAt), asc(jobs.id)).get();
    if (!next) return null;
    // Conditional update = lock; a second worker would update 0 rows.
    const claimed = db
      .update(jobs)
      .set({ status: 'running', lockedAt: now(), attempts: next.attempts + 1 })
      .where(and(eq(jobs.id, next.id), eq(jobs.status, 'queued')))
      .returning()
      .get();
    return claimed ?? null;
  }

  private async process(job: typeof jobs.$inferSelect): Promise<void> {
    const { db, config, events, questions } = this.deps;
    const run = db.select().from(runs).where(eq(runs.id, job.runId)).get();
    if (!run) {
      db.update(jobs).set({ status: 'failed', lastError: 'run not found' }).where(eq(jobs.id, job.id)).run();
      return;
    }
    const payload = JSON.parse(job.payload) as JobPayload;
    const store = RunStore.open(config.RUNS_DIR, run.id);
    db.update(runs).set({ status: 'running' }).where(eq(runs.id, run.id)).run();
    events.publish(run.id, { type: 'run', status: 'running' });

    const ai = createAiClient(config, {
      fixtures: mockFixtures,
      onCall: (rec) => {
        store.recordAiCall(rec);
        db.insert(aiCalls).values({ ...rec, runId: run.id, error: rec.error ?? null }).onConflictDoNothing().run();
        events.publish(run.id, { type: 'ai_call', call: rec });
      },
    });

    try {
      await runPipeline({
        stages,
        store,
        config,
        ai,
        // Runs created before ADR-033 kept their files in <kit>/<slug>/.
        kitDir: existsSync(path.join(run.brandKitDir, run.brandSlug)) ? path.join(run.brandKitDir, run.brandSlug) : run.brandKitDir,
        fromStep: payload.fromStep,
        toStep: payload.toStep,
        ask: (q) => questions.ask(run.id, q),
        log: (message) => events.publish(run.id, { type: 'log', message }),
        onStage: (stage, status, error) => {
          db.insert(steps).values({ runId: run.id, stage, stepNo: STAGES.indexOf(stage) + 1, status, error: error ?? null, at: now() }).run();
          events.publish(run.id, { type: 'stage', stage, status, ...(error ? { error } : {}) });
        },
      });
      const cost = store.writeCostReport().totals.costUsd;
      db.update(runs).set({ status: 'succeeded', totalCostUsd: cost, finishedAt: now() }).where(eq(runs.id, run.id)).run();
      db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id)).run();
      events.publish(run.id, { type: 'run', status: 'succeeded' });
    } catch (err) {
      const error = errorMessage(err);
      const cost = store.writeCostReport().totals.costUsd;
      db.update(runs).set({ status: 'failed', error, totalCostUsd: cost, finishedAt: now() }).where(eq(runs.id, run.id)).run();
      // No automatic retry: AI calls already retry internally, and a failed stage
      // usually needs a human fix (brief, brand kit, key). Rerun via the API.
      db.update(jobs).set({ status: 'failed', lastError: error }).where(eq(jobs.id, job.id)).run();
      events.publish(run.id, { type: 'run', status: 'failed', error });
    }
  }
}
