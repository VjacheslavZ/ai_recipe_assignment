import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Walks up from `start` until it finds pnpm-workspace.yaml (the repo root). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export const envSchema = z.object({
  // `mock` returns schema-valid fixtures so the pipeline runs without a key (ADR-019).
  AI_PROVIDER: z.enum(['openai', 'mock']).default('openai'),
  OPENAI_API_KEY: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  // Defaults mirror .env.example: cheapest models for development (ADR-020).
  OPENAI_TEXT_MODEL: z.string().min(1).default('gpt-6-luna'),
  OPENAI_VISION_MODEL: z.string().min(1).default('gpt-6-luna'),
  OPENAI_IMAGE_MODEL: z.string().min(1).default('gpt-image-1-mini'),
  IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).default('low'),
  IMAGE_SIZE: z
    .string()
    .regex(/^(\d+x\d+|auto)$/, 'IMAGE_SIZE must be WIDTHxHEIGHT or "auto"')
    .default('1024x1024'),
  // edit = the image model paints the scene around the real product (RF-001); generate = empty scene, product composited on top.
  BACKGROUND_MODE: z.enum(['edit', 'generate']).default('edit'),
  QA_SCORE_THRESHOLD: z.coerce.number().min(0).max(10).default(7),
  MAX_REGENERATIONS: z.coerce.number().int().min(0).default(1),
  DATABASE_PATH: z.string().min(1).default('./data/recipe.db'),
  RUNS_DIR: z.string().min(1).default('./runs'),
  PORT: z.coerce.number().int().positive().default(3001),
  // compose.yaml sets 0.0.0.0 so the web container can reach the API.
  HOST: z.string().min(1).default('127.0.0.1'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  /** Absolute repo root; relative paths in env are resolved against it. */
  rootDir: string;
}

/** Parses an env record into a typed config. Throws a readable error on invalid values. */
export function parseConfig(env: Record<string, string | undefined>, rootDir = findRepoRoot()): Config {
  // Treat empty strings as "not set" so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = result.data;
  const abs = (p: string) => path.resolve(rootDir, p);
  return {
    ...e,
    rootDir,
    DATABASE_PATH: abs(e.DATABASE_PATH),
    RUNS_DIR: abs(e.RUNS_DIR),
  };
}

function loadDotEnv(rootDir: string): void {
  const file = path.join(rootDir, '.env');
  // Values already present in process.env take precedence over .env.
  if (existsSync(file)) process.loadEnvFile(file);
}

const rootDir = findRepoRoot();
loadDotEnv(rootDir);

/** Typed, validated configuration loaded from process.env and the repo-root .env. */
export const config: Config = parseConfig(process.env, rootDir);

/** Returns the OpenAI key or throws. Call only where an OpenAI request is actually made. */
export function requireOpenAIKey(cfg: Pick<Config, 'OPENAI_API_KEY'> = config): string {
  if (!cfg.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  return cfg.OPENAI_API_KEY;
}
