#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
  BRIEF_INPUT_FILE,
  config,
  createAiClient,
  mockFixtures,
  runPipeline,
  RunStore,
  STAGES,
  stages,
  type CostReport,
  type PendingQuestion,
} from '@recipe/core';
import YAML from 'yaml';

const HELP = `AI Recipe CLI — from an Instagram brand to three finished posts.

Usage:
  pnpm recipe <command> [options]

Commands:
  run            Run the pipeline (new run, or resume with --run-id)
  help           Show this help

Options for "run":
  --brief <file>      Path to the brief YAML file (required for a new run)
  --from-step <n>     Start at step n (1-${STAGES.length}): ${STAGES.map((s, i) => `${i + 1}=${s}`).join(', ')}
                      Default: the first step that is not done yet
  --to-step <n>       Stop after step n (default: ${STAGES.length})
  --run-id <id>       Existing run id to resume (folder name under RUNS_DIR)
  --yes               Non-interactive: never prompt, unanswered questions stay unanswered
  -h, --help          Show this help
`;

function parseStep(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > STAGES.length) {
    throw new Error(`${name} must be an integer between 1 and ${STAGES.length}, got "${raw}"`);
  }
  return n;
}

function brandSlugOf(brief: unknown): string {
  const slug = (brief as { brand?: { slug?: unknown } } | null)?.brand?.slug;
  return typeof slug === 'string' && slug.trim() ? slug : 'brand';
}

function makeAsk(interactive: boolean): (q: PendingQuestion) => Promise<string | null> {
  if (!interactive) return async () => null;
  return async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(`\n? ${q.question}`);
      if (q.context) console.log(`  ${q.context}`);
      const hint = q.suggestedAnswer ? ` [${q.suggestedAnswer}]` : '';
      const answer = (await rl.question(`  answer${hint} (empty = skip): `)).trim();
      return answer || q.suggestedAnswer || null;
    } finally {
      rl.close();
    }
  };
}

function printCostSummary(report: CostReport): void {
  const t = report.totals;
  const unpriced = t.unpricedCalls ? ` (+${t.unpricedCalls} call(s) with unknown price)` : '';
  console.log(
    `Cost: $${t.costUsd.toFixed(4)}${unpriced} · ${t.calls} AI call(s), ${t.errors} failed · ` +
      `${t.inputTokens} in / ${t.outputTokens} out tokens · ${t.imageCount} image(s) · ${t.webSearchCalls} web search(es)`,
  );
  for (const [stage, b] of Object.entries(report.byStage)) {
    console.log(`  ${stage.padEnd(10)} $${b.costUsd.toFixed(4)}  ${b.calls} call(s)  ${(b.durationMs / 1000).toFixed(1)} s`);
  }
}

async function run(values: Record<string, string | boolean | undefined>): Promise<void> {
  const fromStep = parseStep('--from-step', values['from-step'] as string | undefined);
  const toStep = parseStep('--to-step', values['to-step'] as string | undefined);
  const runId = values['run-id'] as string | undefined;
  const briefPath = values.brief as string | undefined;

  let store: RunStore;
  if (runId) {
    store = RunStore.open(config.RUNS_DIR, runId);
    if (briefPath) console.log(`Note: --brief is ignored when resuming; using ${BRIEF_INPUT_FILE} stored in the run.`);
  } else {
    if (!briefPath) throw new Error('--brief <file> is required for a new run (or pass --run-id to resume)');
    const briefText = readFileSync(briefPath, 'utf8');
    const brief: unknown = YAML.parse(briefText);
    store = RunStore.create(config.RUNS_DIR, brandSlugOf(brief), config);
    // Contract with the brief stage: it reads the brief from this file.
    store.writeText('brief', BRIEF_INPUT_FILE, briefText);
  }

  console.log(`Run ${store.runId} · provider ${config.AI_PROVIDER} · ${store.runDir}`);
  const ai = createAiClient(config, {
    fixtures: mockFixtures,
    onCall: (rec) => {
      store.recordAiCall(rec);
      const cost = rec.costUsd === null ? '?' : rec.costUsd.toFixed(4);
      const status = rec.status === 'ok' ? '' : ` ERROR: ${rec.error}`;
      console.log(`    ai ${rec.purpose} · ${rec.model} · ${(rec.durationMs / 1000).toFixed(1)} s · $${cost}${status}`);
    },
  });

  const interactive = !values.yes && process.stdin.isTTY === true;
  try {
    await runPipeline({
      stages,
      store,
      config,
      ai,
      fromStep,
      toStep,
      ask: makeAsk(interactive),
      log: (msg) => console.log(`  ${msg}`),
    });
  } finally {
    console.log(`\nRun dir: ${store.runDir}`);
    printCostSummary(store.writeCostReport());
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      brief: { type: 'string' },
      'from-step': { type: 'string' },
      'to-step': { type: 'string' },
      'run-id': { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(HELP);
  } else if (command === 'run') {
    await run(values);
  } else {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
