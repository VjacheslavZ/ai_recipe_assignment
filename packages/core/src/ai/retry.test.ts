import { APIError } from 'openai';
import { describe, expect, it } from 'vitest';
import { isRetryableError, RetryError, withRetry } from './retry.js';

const apiError = (status: number) => APIError.generate(status, undefined, `HTTP ${status}`, new Headers());
const noSleep = async () => {};

describe('withRetry', () => {
  it('retries retryable errors and reports the retry count', async () => {
    let n = 0;
    const res = await withRetry(
      async () => {
        if (n++ < 2) throw apiError(429);
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(res).toEqual({ value: 'ok', retryCount: 2 });
  });

  it('gives up after maxRetries', async () => {
    const err = await withRetry(() => Promise.reject(apiError(503)), { sleep: noSleep, maxRetries: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryError);
    expect((err as RetryError).retryCount).toBe(3);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(apiError(400));
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('400');
    expect(calls).toBe(1);
    expect(isRetryableError(apiError(500))).toBe(true);
    expect(isRetryableError(new Error('schema mismatch'))).toBe(false);
  });
});
