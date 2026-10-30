import type { AiClient } from '../ai/types.js';
import type { Config } from '../config.js';
import type { CostReport, RunStore } from '../run/store.js';
import type { PendingQuestion, Stage, StageContext, StageDefinition, StageStatus } from './types.js';

export interface RunPipelineOptions {
  stages: StageDefinition[];
  store: RunStore;
  config: Config;
  ai: AiClient;
  /** First step to run; default: the first stage that is not 'done'. */
  fromStep?: number;
  /** Last step to run; default: the last stage. */
  toStep?: number;
  ask?: (q: PendingQuestion) => Promise<string | null>;
  log?: (msg: string) => void;
  /** Brand kit root; default `config.BRAND_KIT_DIR` (the server passes a per-run copy with uploads). */
  brandKitDir?: string;
  /** Called after every stage status change (the server turns these into SSE events). */
  onStage?: (stage: Stage, status: StageStatus, error?: string) => void;
}

export interface RunPipelineResult {
  ran: Stage[];
  costReport: CostReport;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Runs stages [fromStep..toStep] in order, recording status in the store (ADR-008).
 * Stops at the first failure (marks it 'failed', rethrows). Stages after the range
 * that were already run are reset to 'pending' because their inputs are now stale.
 * The cost report is written at the end, also on failure.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { store, config, ai } = opts;
  const log = opts.log ?? (() => {});
  const ask = opts.ask ?? (async () => null);
  const mark = (stage: Stage, status: StageStatus, error?: string) => {
    store.markStage(stage, status, error ? { error } : {});
    opts.onStage?.(stage, status, error);
  };
  const stages = [...opts.stages].sort((a, b) => a.no - b.no);
  const first = stages[0];
  const last = stages.at(-1);
  if (!first || !last) throw new Error('No stages to run');

  const statusOf = (s: StageDefinition) => store.getState().stages[s.id].status;
  const toStep = opts.toStep ?? last.no;
  const fromStep = opts.fromStep ?? stages.find((s) => statusOf(s) !== 'done')?.no;

  if (fromStep === undefined) {
    log('All stages are already done; nothing to run.');
    return { ran: [], costReport: store.writeCostReport() };
  }
  for (const [name, n] of [['--from-step', fromStep], ['--to-step', toStep]] as const) {
    if (!stages.some((s) => s.no === n)) {
      throw new Error(`${name} ${n} is not a valid step (valid: ${stages.map((s) => s.no).join(', ')})`);
    }
  }
  if (fromStep > toStep) {
    if (opts.fromStep === undefined) {
      log(`Stages up to step ${toStep} are already done; nothing to run.`);
      return { ran: [], costReport: store.writeCostReport() };
    }
    throw new Error(`--from-step ${fromStep} is after --to-step ${toStep}`);
  }
  const notDone = stages.filter((s) => s.no < fromStep && statusOf(s) !== 'done');
  if (notDone.length > 0) {
    const list = notDone.map((s) => `${s.no} ${s.id} (${statusOf(s)})`).join(', ');
    throw new Error(`Cannot start from step ${fromStep}: earlier steps are not done: ${list}`);
  }

  for (const s of stages) {
    if (s.no > toStep && statusOf(s) !== 'pending') mark(s.id, 'pending');
  }

  const ctx: StageContext = {
    runId: store.runId,
    runDir: store.runDir,
    config,
    ai,
    store,
    brandKitDir: opts.brandKitDir ?? config.BRAND_KIT_DIR,
    log,
    ask,
  };
  const ran: Stage[] = [];
  let costReport: CostReport;
  try {
    for (const s of stages.filter((x) => x.no >= fromStep && x.no <= toStep)) {
      log(`[${s.no}/${last.no}] ${s.title}…`);
      mark(s.id, 'running');
      const t0 = Date.now();
      try {
        await s.run(ctx);
      } catch (err) {
        mark(s.id, 'failed', errorMessage(err));
        log(`[${s.no}/${last.no}] ${s.title} failed: ${errorMessage(err)}`);
        throw err;
      }
      mark(s.id, 'done');
      ran.push(s.id);
      log(`[${s.no}/${last.no}] ${s.title} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  } finally {
    costReport = store.writeCostReport();
  }
  return { ran, costReport };
}
