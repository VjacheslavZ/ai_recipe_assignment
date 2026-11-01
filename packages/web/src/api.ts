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

export interface ModelCheck {
  role: 'text' | 'vision' | 'image';
  model: string;
  available: boolean;
  priced: boolean;
  shutdownDate: string | null;
  error?: string;
}

export interface OpenAiCheck {
  ok: boolean;
  keySet: boolean;
  error?: string;
  models: ModelCheck[];
}

export interface BriefView {
  brand: { name: string; slug: string; instagramHandle: string; instagramUrl: string; website: string; shopUrls: string[]; whyThisBrand: string };
  products: { name: string; url: string | null; imageFile: string | null; notes: string | null }[];
  audience: string;
  goals: string[];
  references: { url: string | null; file: string | null; note: string | null }[];
  constraints: string[];
  notes: string | null;
}

export interface KitStatus {
  logo: string | null;
  products: { name: string; imageFile: string | null; exists: boolean }[];
  instagramScreenshots: string[];
  missing: string[];
}

export interface KitItem {
  kind: 'logo' | 'product';
  product: string | null;
  file: string | null;
  status: 'collected' | 'kept' | 'not_found';
  sourceUrl: string | null;
  pageUrl: string | null;
  note: string;
}

export interface KitCollection {
  yaml: string;
  brief: BriefView;
  warnings: string[];
  items: KitItem[];
  kit: KitStatus;
  costUsd: number;
}

export interface BriefDraft {
  draftId: string;
  kit: KitStatus | null;
  yaml: string;
  brief: BriefView | null;
  missing: string[];
  issues: string[];
  warnings: string[];
  assumptions: { field: string; value: string }[];
}

export const api = {
  health: () => request<{ ok: boolean; provider: string; openaiKeySet: boolean }>('/api/health'),
  checkOpenAi: () => request<OpenAiCheck>('/api/openai/check'),
  exampleBrief: () => request<string>('/api/example-brief'),
  exampleRequest: () => request<string>('/api/example-request'),
  draftBrief: (text: string, productFiles: string[]) => request<BriefDraft>('/api/brief/draft', json({ text, productFiles })),
  collectKit: (yaml: string, draftId: string) => request<KitCollection>('/api/brief/collect', json({ yaml, draftId })),
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
