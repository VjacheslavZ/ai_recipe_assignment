import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Index and live state for the UI. Artifacts stay in runs/<runId>/ (ADR-008);
// these tables are what the API lists, filters and streams.

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), // = RunStore runId (folder name)
  brandSlug: text('brand_slug').notNull(),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] }).notNull(),
  runDir: text('run_dir').notNull(),
  brandKitDir: text('brand_kit_dir').notNull(),
  provider: text('provider').notNull(),
  error: text('error'),
  totalCostUsd: real('total_cost_usd'),
  createdAt: text('created_at').notNull(),
  finishedAt: text('finished_at'),
});

export const steps = sqliteTable('steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  stage: text('stage').notNull(),
  stepNo: integer('step_no').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  at: text('at').notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  type: text('type', { enum: ['run_pipeline'] }).notNull(),
  payload: text('payload').notNull(), // JSON: { fromStep?, toStep? }
  status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lockedAt: text('locked_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
});

export const aiCalls = sqliteTable('ai_calls', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  purpose: text('purpose').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  kind: text('kind').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  imageCount: integer('image_count').notNull(),
  webSearchCalls: integer('web_search_calls').notNull(),
  costUsd: real('cost_usd'),
  durationMs: integer('duration_ms').notNull(),
  status: text('status').notNull(),
  retryCount: integer('retry_count').notNull(),
  error: text('error'),
  startedAt: text('started_at').notNull(),
});

export const schema = { runs, steps, jobs, aiCalls };
export type Db = BetterSQLite3Database<typeof schema>;

// Bootstrap DDL instead of drizzle-kit migrations: one file, created on start,
// nothing to run by hand (ADR-023). Must mirror the table definitions above.
const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, brand_slug TEXT NOT NULL, status TEXT NOT NULL, run_dir TEXT NOT NULL,
  brand_kit_dir TEXT NOT NULL, provider TEXT NOT NULL, error TEXT, total_cost_usd REAL,
  created_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), stage TEXT NOT NULL,
  step_no INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), type TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, locked_at TEXT,
  last_error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), purpose TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, kind TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  image_count INTEGER NOT NULL, web_search_calls INTEGER NOT NULL, cost_usd REAL, duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL, retry_count INTEGER NOT NULL, error TEXT, started_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS steps_run_idx ON steps(run_id);
CREATE INDEX IF NOT EXISTS ai_calls_run_idx ON ai_calls(run_id);
`;

/** Opens (and creates) the SQLite database; `:memory:` for tests. */
export function openDb(file: string): { db: Db; close: () => void } {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(DDL);
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}
