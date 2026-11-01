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
  /** Short name from the brief (or its products); null only if the brief could not be read. */
  title: string | null;
  status: RunStatus;
  provider: string;
  error: string | null;
  totalCostUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** Questions the run is waiting on right now (price confirmations). */
  pendingQuestions?: number;
  /** The run folder was deleted from disk; the run can only be deleted. */
  filesMissing?: boolean;
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

/** Input files of a run or of the page being prepared: paths relative to the kit folder. */
export interface KitFiles {
  logo: string | null;
  products: string[];
  instagram: string[];
}

export interface RunDetail extends RunRow {
  state: { stages: Record<Stage, StageState> };
  questions: Question[];
  /** The files the run was made from; `base` + `/` + path is their URL. Null for older runs. */
  inputs: (KitFiles & { base: string }) | null;
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

/** An error response of the API; `status` tells e.g. a deleted run folder (410) from a missing run (404). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status);
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
  title: string | null;
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
  files: KitFiles;
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
  createKit: () => request<{ kitId: string; files: KitFiles }>('/api/kits', { method: 'POST' }),
  uploadKitFiles: (kitId: string, field: 'logo' | 'products' | 'screenshots', files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append(field, f);
    return request<KitFiles>(`/api/kits/${kitId}/files`, { method: 'POST', body: form });
  },
  removeKitFile: (kitId: string, rel: string) => request<KitFiles>(`/api/kits/${kitId}/files/${rel}`, { method: 'DELETE' }),
  loadKitExample: (kitId: string) => request<KitFiles>(`/api/kits/${kitId}/example`, { method: 'POST' }),
  kitFileUrl: (kitId: string, rel: string, version: number) => `/api/kits/${kitId}/files/${rel}?v=${version}`,
  draftBrief: (text: string, kitId: string) => request<BriefDraft>('/api/brief/draft', json({ text, kitId })),
  collectKit: (yaml: string, draftId: string, kitId: string) => request<KitCollection>('/api/brief/collect', json({ yaml, draftId, kitId })),
  assignPhoto: (yaml: string, kitId: string, product: string, imageFile: string | null) =>
    request<Pick<KitCollection, 'yaml' | 'brief' | 'warnings' | 'kit'>>('/api/brief/photo', json({ yaml, kitId, product, imageFile })),
  listRuns: () => request<RunRow[]>('/api/runs'),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  createRun: (briefYaml: string, draftId: string, kitId: string) => request<{ runId: string }>('/api/runs', json({ briefYaml, draftId, kitId })),
  deleteRun: (id: string) => request<{ deleted: string }>(`/api/runs/${id}`, { method: 'DELETE' }),
  rerun: (id: string, fromStep: number) => request<{ queued: boolean }>(`/api/runs/${id}/rerun`, json({ fromStep })),
  answer: (id: string, questionId: string, answer: string | null) => request<{ ok: boolean }>(`/api/runs/${id}/answers`, json({ questionId, answer })),
  posts: (id: string) => request<PostsResponse>(`/api/runs/${id}/posts`),
  costs: (id: string) => request<CostReport>(`/api/runs/${id}/costs`),
  file: (id: string, rel: string) => request<string>(`/api/runs/${id}/files/${rel}`),
  downloadUrl: (id: string) => `/api/runs/${id}/download`,
};
