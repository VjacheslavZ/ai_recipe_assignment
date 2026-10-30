import { APIConnectionError, APIError } from 'openai';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;
}

/** 429, 408/409, 5xx, timeouts and connection failures are worth retrying; 4xx validation errors are not. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true; // includes APIConnectionTimeoutError
  if (err instanceof APIError) {
    const s = err.status;
    return s === undefined || s === 408 || s === 409 || s === 429 || s >= 500;
  }
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(code);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RetryError extends Error {
  constructor(
    override readonly cause: unknown,
    readonly retryCount: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * Runs `fn` with exponential backoff + full jitter. Resolves with the result and
 * the number of retries used; rejects with RetryError carrying the retry count.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<{ value: T; retryCount: number }> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 20_000, sleep = defaultSleep } = opts;
  const retryable = opts.isRetryable ?? isRetryableError;
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: await fn(attempt), retryCount: attempt };
    } catch (err) {
      if (attempt >= maxRetries || !retryable(err)) throw new RetryError(err, attempt);
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(cap / 2 + Math.random() * (cap / 2));
    }
  }
}
