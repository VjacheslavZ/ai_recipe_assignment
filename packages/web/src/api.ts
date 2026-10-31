// Thin client for the Fastify API (packages/server). Types mirror the JSON it returns.

export const STAGES = ['brief', 'analysis', 'plan', 'create', 'review'] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus = 'pending' | 'running' | 'done' | 'failed';
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export const STAGE_TITLES: Record<Stage, string> = {
  brief: 'Brief',
  analysis: 'Brand analysis',
  plan: 'Content plan',
  create: 'Create posts',
  review: 'Review',
};

export interface RunRow {
  id: string;
  brandSlug: string;
  status: RunStatus;
  provider: string;
  error: string | null;
  totalCostUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** Questions the run is waiting on right now (price confirmations). */
  pendingQuestions?: number;
}

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface Question {
  id: string;
  question: string;
  context?: string;
  suggestedAnswer?: string;
  /** After this moment the stage continues without an answer. */
  expiresAt: string;
}

export interface RunDetail extends RunRow {
  state: { stages: Record<Stage, StageState> };
  questions: Question[];
}

export interface AiCall {
  id: string;
  purpose: string;
  model: string;
  kind: string;
  costUsd: number | null;
  durationMs: number;
  status: 'ok' | 'error';
  error?: string;
}

export type RunEvent =
  | { type: 'snapshot'; status: RunStatus; error: string | null; state: RunDetail['state']; questions: Question[] }
  | { type: 'log'; message: string }
  | { type: 'stage'; stage: Stage; status: StageStatus; error?: string }
  | { type: 'ai_call'; call: AiCall }
  | { type: 'question'; question: Question }
  | { type: 'question_answered'; id: string }
  | { type: 'run'; status: RunStatus; error?: string };

export interface SlideView {
  index: number;
  role: string;
  headline: string;
  url: string;
  qa: { score: number; passed: boolean; attempts: number; issues: string[] } | null;
}

export interface PostView {
  number: 1 | 2 | 3;
  format: 'carousel' | 'single' | 'story';
  goal: string;
  concept: string;
  rationale: string;
  caption: string;
  instagramText: string;
  captionCheck: { passed: boolean; claims: { text: string; supported: boolean; factId: string | null }[]; languageIssues: string[]; codeIssues: string[] } | null;
  slides: SlideView[];
}

export interface PostsResponse {
  reviewed: boolean;
  passed: boolean | null;
  needsHumanAttention: string[];
  posts: PostView[];
}

export interface CostBucket {
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  webSearchCalls: number;
  costUsd: number;
  durationMs: number;
  unpricedCalls: number;
}

export interface CostReport {
  totals: CostBucket;
  byStage: Record<string, CostBucket>;
  byModel: Record<string, CostBucket>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<{ ok: boolean; provider: string }>('/api/health'),
  exampleBrief: () => request<string>('/api/example-brief'),
  listRuns: () => request<RunRow[]>('/api/runs'),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  createRun: (form: FormData) => request<{ runId: string }>('/api/runs', { method: 'POST', body: form }),
  rerun: (id: string, fromStep: number) => request<{ queued: boolean }>(`/api/runs/${id}/rerun`, json({ fromStep })),
  answer: (id: string, questionId: string, answer: string | null) => request<{ ok: boolean }>(`/api/runs/${id}/answers`, json({ questionId, answer })),
  posts: (id: string) => request<PostsResponse>(`/api/runs/${id}/posts`),
  costs: (id: string) => request<CostReport>(`/api/runs/${id}/costs`),
  file: (id: string, rel: string) => request<string>(`/api/runs/${id}/files/${rel}`),
  downloadUrl: (id: string) => `/api/runs/${id}/download`,
};
