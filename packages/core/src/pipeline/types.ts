import type { AiClient } from '../ai/types.js';
import type { Config } from '../config.js';
import type { RunStore } from '../run/store.js';

/** Ordered pipeline stages; position + 1 is the step number used by --from-step/--to-step. */
export const STAGES = ['brief', 'analysis', 'plan', 'create', 'review'] as const;
export type Stage = (typeof STAGES)[number];

export type StageStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PendingQuestion {
  id: string;
  question: string;
  context?: string;
  suggestedAnswer?: string;
}

export interface StageContext {
  runId: string;
  runDir: string;
  config: Config;
  ai: AiClient;
  store: RunStore;
  brandKitDir: string;
  log: (msg: string) => void;
  /** Ask the human (CLI prompt now, UI form later). Returns null if unanswered/non-interactive. */
  ask: (q: PendingQuestion) => Promise<string | null>;
}

export interface StageDefinition {
  no: number;
  id: Stage;
  title: string;
  run: (ctx: StageContext) => Promise<void>;
}
