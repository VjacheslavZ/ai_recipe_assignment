import type { z } from 'zod';

export type AiKind = 'text' | 'vision' | 'image';

export interface AiCallRecord {
  id: string;
  purpose: string;
  provider: 'openai' | 'mock';
  model: string;
  kind: AiKind;
  inputTokens: number;
  outputTokens: number;
  imageCount: number;
  webSearchCalls: number;
  /** null when the model is missing from the price table. */
  costUsd: number | null;
  durationMs: number;
  status: 'ok' | 'error';
  retryCount: number;
  error?: string;
  startedAt: string;
}

export interface WebSearchOptions {
  allowedDomains?: string[];
  country?: string;
  city?: string;
}

export interface Source {
  url: string;
  title?: string;
}

export interface StructuredRequest<T> {
  /** e.g. 'analysis.site', 'analysis.instagram', 'plan' — also the mock fixture key. */
  purpose: string;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  input: string;
  /** Absolute local file paths (png/jpg/webp), sent as base64 input_image. */
  images?: string[];
  /** Enables the hosted web_search tool. */
  webSearch?: WebSearchOptions;
  /** Which configured model to use; default 'text' ('vision' if images present). */
  model?: 'text' | 'vision';
}

export interface StructuredResult<T> {
  data: T;
  sources: Source[];
  call: AiCallRecord;
}

export interface ImageRequest {
  purpose: string;
  prompt: string;
  size?: string;
  quality?: string;
  /**
   * Generate around an existing image instead of from scratch (image edit): PNGs of the requested
   * size; the mask is opaque where the image must be kept and transparent where the model paints.
   */
  edit?: { image: Buffer; mask: Buffer };
}

export interface ImageResult {
  png: Buffer;
  call: AiCallRecord;
}

export interface AiClient {
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  generateImage(req: ImageRequest): Promise<ImageResult>;
}

/** purpose -> fixture data (must pass req.schema). See ai/mock.ts for the `__sources` convention. */
export type MockFixtures = Record<string, unknown>;

export type OnAiCall = (rec: AiCallRecord) => void;
