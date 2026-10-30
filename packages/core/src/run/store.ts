import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import type { AiCallRecord } from '../ai/types.js';
import { compactTimestamp, writeFileAtomic } from '../fs.js';
import { STAGES, type Stage, type StageStatus } from '../pipeline/types.js';

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Paths relative to the run dir. */
  artifacts: string[];
}

export interface RunState {
  runId: string;
  brandSlug: string;
  createdAt: string;
  updatedAt: string;
  /** Effective config without secrets (ADR-009). */
  configSnapshot: Record<string, unknown>;
  stages: Record<Stage, StageState>;
}

/** One line of ai_calls.jsonl: the call plus the stage that was running when it happened. */
export type StoredAiCall = AiCallRecord & { stage: Stage | null };

export interface CostBucket {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  webSearchCalls: number;
  costUsd: number;
  durationMs: number;
  /** Calls whose cost is unknown (model missing from the price table); costUsd excludes them. */
  unpricedCalls: number;
}

export interface CostReport {
  runId: string;
  generatedAt: string;
  totals: CostBucket;
  byStage: Record<string, CostBucket>;
  byPurpose: Record<string, CostBucket>;
  byModel: Record<string, CostBucket>;
  unpriced: { id: string; purpose: string; model: string }[];
}

const STATE_FILE = 'state.json';
const AI_CALLS_FILE = 'ai_calls.jsonl';
const COST_FILE = 'cost_report.json';
const SECRET_KEYS = new Set(['OPENAI_API_KEY']);

export function stageDirName(stage: Stage): string {
  return `${String(STAGES.indexOf(stage) + 1).padStart(2, '0')}_${stage}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'brand'
  );
}

function stripSecrets(cfg: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(cfg).filter(([k]) => !SECRET_KEYS.has(k)));
}

function emptyBucket(): CostBucket {
  return { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, imageCount: 0, webSearchCalls: 0, costUsd: 0, durationMs: 0, unpricedCalls: 0 };
}

function addTo(b: CostBucket, c: AiCallRecord): void {
  b.calls++;
  if (c.status === 'error') b.errors++;
  b.inputTokens += c.inputTokens;
  b.outputTokens += c.outputTokens;
  b.imageCount += c.imageCount;
  b.webSearchCalls += c.webSearchCalls;
  b.durationMs += c.durationMs;
  if (c.costUsd === null) b.unpricedCalls++;
  else b.costUsd += c.costUsd;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * File-based run store (ADR-008): `<runsDir>/<runId>/` with `NN_stage/` dirs,
 * `state.json`, `ai_calls.jsonl` and `cost_report.json`. Synchronous on purpose:
 * files are small and it keeps callers free of ordering bugs. A DB-backed store
 * (M5) should keep this public API.
 */
export class RunStore {
  private state: RunState;
  private currentStage: Stage | null = null;

  private constructor(
    readonly runDir: string,
    state: RunState,
  ) {
    this.state = state;
  }

  get runId(): string {
    return this.state.runId;
  }

  static create(runsDir: string, brandSlug: string, configSnapshot: object): RunStore {
    const slug = slugify(brandSlug);
    const base = `${slug}_${compactTimestamp()}`;
    let runId = base;
    for (let i = 2; existsSync(path.join(runsDir, runId)); i++) runId = `${base}-${i}`;
    const runDir = path.join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    for (const s of STAGES) mkdirSync(path.join(runDir, stageDirName(s)), { recursive: true });

    const now = new Date().toISOString();
    const snapshot = stripSecrets(configSnapshot);
    const stages = {} as Record<Stage, StageState>;
    for (const s of STAGES) stages[s] = { status: 'pending', artifacts: [] };
    const store = new RunStore(runDir, { runId, brandSlug: slug, createdAt: now, updatedAt: now, configSnapshot: snapshot, stages });
    writeFileAtomic(path.join(runDir, 'config.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    store.saveState();
    return store;
  }

  static open(runsDir: string, runId: string): RunStore {
    if (!/^[\w.-]+$/.test(runId) || runId.startsWith('.')) throw new Error(`Invalid run id: ${runId}`);
    const runDir = path.join(runsDir, runId);
    const file = path.join(runDir, STATE_FILE);
    if (!existsSync(file)) throw new Error(`Run "${runId}" not found (no ${file})`);
    return new RunStore(runDir, JSON.parse(readFileSync(file, 'utf8')) as RunState);
  }

  stageDir(stage: Stage): string {
    return path.join(this.runDir, stageDirName(stage));
  }

  /** Absolute path of a stage artifact; rejects paths escaping the stage dir. */
  path(stage: Stage, file: string): string {
    const dir = this.stageDir(stage);
    const full = path.resolve(dir, file);
    if (!full.startsWith(dir + path.sep)) throw new Error(`Artifact path escapes stage dir: ${file}`);
    return full;
  }

  writeJson(stage: Stage, file: string, data: unknown): string {
    const full = this.path(stage, file);
    writeFileAtomic(full, `${JSON.stringify(data, null, 2)}\n`);
    return full;
  }

  readJson<T>(stage: Stage, file: string, schema?: z.ZodType<T>): T {
    const full = this.path(stage, file);
    const raw: unknown = JSON.parse(readFileSync(full, 'utf8'));
    if (!schema) return raw as T;
    const res = schema.safeParse(raw);
    if (!res.success) throw new Error(`Invalid ${stageDirName(stage)}/${file}: ${res.error.message}`);
    return res.data;
  }

  writeText(stage: Stage, file: string, text: string): string {
    const full = this.path(stage, file);
    writeFileAtomic(full, text);
    return full;
  }

  writeBuffer(stage: Stage, file: string, buf: Buffer): string {
    const full = this.path(stage, file);
    writeFileAtomic(full, buf);
    return full;
  }

  exists(stage: Stage, file: string): boolean {
    return existsSync(this.path(stage, file));
  }

  getState(): RunState {
    return structuredClone(this.state);
  }

  /** `artifacts` replaces the stage's list when given; otherwise the previous list is kept. */
  markStage(stage: Stage, status: StageStatus, extra: { error?: string; artifacts?: string[] } = {}): void {
    const prev = this.state.stages[stage];
    const now = new Date().toISOString();
    const next: StageState = { status, artifacts: extra.artifacts ?? prev.artifacts };
    if (status === 'running') {
      next.startedAt = now;
      this.currentStage = stage;
    } else {
      if (prev.startedAt) next.startedAt = prev.startedAt;
      if (status === 'done' || status === 'failed') next.finishedAt = now;
      if (this.currentStage === stage) this.currentStage = null;
    }
    if (status === 'failed' && extra.error !== undefined) next.error = extra.error;
    this.state.stages[stage] = next;
    this.saveState();
  }

  recordAiCall(rec: AiCallRecord): void {
    const line: StoredAiCall = { ...rec, stage: this.currentStage ?? stageFromPurpose(rec.purpose) };
    appendFileSync(path.join(this.runDir, AI_CALLS_FILE), `${JSON.stringify(line)}\n`);
  }

  readAiCalls(): StoredAiCall[] {
    const file = path.join(this.runDir, AI_CALLS_FILE);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as StoredAiCall);
  }

  writeCostReport(): CostReport {
    const calls = this.readAiCalls();
    const totals = emptyBucket();
    const byStage: Record<string, CostBucket> = {};
    const byPurpose: Record<string, CostBucket> = {};
    const byModel: Record<string, CostBucket> = {};
    for (const c of calls) {
      addTo(totals, c);
      addTo((byStage[c.stage ?? 'unknown'] ??= emptyBucket()), c);
      addTo((byPurpose[c.purpose] ??= emptyBucket()), c);
      addTo((byModel[`${c.provider}:${c.model}`] ??= emptyBucket()), c);
    }
    for (const b of [totals, ...Object.values(byStage), ...Object.values(byPurpose), ...Object.values(byModel)]) {
      b.costUsd = round6(b.costUsd);
    }
    const report: CostReport = {
      runId: this.runId,
      generatedAt: new Date().toISOString(),
      totals,
      byStage,
      byPurpose,
      byModel,
      unpriced: calls.filter((c) => c.costUsd === null).map(({ id, purpose, model }) => ({ id, purpose, model })),
    };
    writeFileAtomic(path.join(this.runDir, COST_FILE), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  private saveState(): void {
    this.state.updatedAt = new Date().toISOString();
    writeFileAtomic(path.join(this.runDir, STATE_FILE), `${JSON.stringify(this.state, null, 2)}\n`);
  }
}

function stageFromPurpose(purpose: string): Stage | null {
  const head = purpose.split('.')[0];
  return (STAGES as readonly string[]).includes(head ?? '') ? (head as Stage) : null;
}
