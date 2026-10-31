import OpenAI from 'openai';
import type { Config } from '../config.js';
import { findPrice } from './pricing.js';

export interface ModelCheck {
  role: 'text' | 'vision' | 'image';
  model: string;
  available: boolean;
  /** Without a price entry, costs of this model are counted as unknown. */
  priced: boolean;
  shutdownDate: string | null;
  error?: string;
}

export interface OpenAiCheck {
  ok: boolean;
  keySet: boolean;
  /** Key rejected or API unreachable; set instead of per-model results. */
  error?: string;
  models: ModelCheck[];
}

/**
 * Checks the key and the configured model ids before a paid run (`GET /models/{id}`, free).
 * It does not prove a model accepts every parameter (e.g. the web_search tool); the first
 * stage that uses it will report that.
 */
export async function checkOpenAiSetup(config: Config, client?: OpenAI): Promise<OpenAiCheck> {
  const roles = [
    ['text', config.OPENAI_TEXT_MODEL],
    ['vision', config.OPENAI_VISION_MODEL],
    ['image', config.OPENAI_IMAGE_MODEL],
  ] as const;
  const base = (m: string) => ({ priced: Boolean(findPrice(m)), shutdownDate: null });
  if (!config.OPENAI_API_KEY && !client) {
    return {
      ok: false,
      keySet: false,
      error: 'OPENAI_API_KEY is not set. Add it to .env and restart: docker compose restart server.',
      models: roles.map(([role, model]) => ({ role, model, available: false, ...base(model) })),
    };
  }
  const api = client ?? new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 1, timeout: 15_000 });
  const models: ModelCheck[] = [];
  for (const [role, model] of roles) {
    try {
      const m = await api.models.retrieve(model);
      const shutdown = (m as { shutdown_date?: string | null }).shutdown_date ?? null;
      models.push({ role, model, available: true, ...base(model), shutdownDate: shutdown });
    } catch (err) {
      const status = err instanceof OpenAI.APIError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 401 || status === 403 || status === undefined) {
        // Not about this model: the key or the connection is wrong, so the other checks would fail the same way.
        return { ok: false, keySet: true, error: status ? `OpenAI rejected the key (${status}): ${message}` : `OpenAI not reachable: ${message}`, models: [] };
      }
      models.push({ role, model, available: false, ...base(model), error: status === 404 ? 'model not found for this key' : message });
    }
  }
  return { ok: models.every((m) => m.available), keySet: true, models };
}
