import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * The one place a model provider is chosen.
 *
 * Before this, `https://api.anthropic.com/v1/messages` was hardcoded in two
 * files with duplicated headers, model resolution and token accounting, while
 * `AI_PROVIDER` sat in .env.example read by nothing. Everything now resolves
 * here, so switching providers is an env change and not a code change.
 *
 * `openai-compatible` is what makes "bring your own model" real: Ollama, vLLM,
 * LM Studio, Together, DeepSeek and most self-hosted servers all speak the
 * OpenAI wire format, so they need a baseURL rather than a new adapter.
 */

export type ProviderId = 'anthropic' | 'openai' | 'openai-compatible';

/**
 * A valid model id per provider. This exists because the previous default was
 * `'claude-sonnet-5'` — not a real Anthropic model id — so the very first call
 * after setting a key would 404. A wrong default is worse than no default: it
 * fails at request time, far from the config that caused it.
 *
 * Haiku 4.5 for classification: at ~53 mentions/day the entire spread between
 * the cheapest credible model and the best is about $15/year, so this is chosen
 * on instruction-following and on keeping one vendor across classification, the
 * assistant and the MCP tooling — not on price.
 */
const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  'openai-compatible': 'llama3.1',
};

export function providerId(): ProviderId {
  const raw = (process.env.AI_PROVIDER || 'anthropic').trim() as ProviderId;
  if (!(raw in DEFAULT_MODEL)) {
    throw new Error(
      `AI_PROVIDER='${raw}' is not supported — use one of: ${Object.keys(DEFAULT_MODEL).join(', ')}`
    );
  }
  return raw;
}

export function modelId(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL[providerId()];
}

/**
 * The resolved model, ready for generateObject/generateText. Resolved per call
 * rather than memoised so a key or model swap takes effect on the next request
 * instead of needing a restart.
 */
export function model() {
  const id = modelId();
  switch (providerId()) {
    // Factories, not the exported singletons: those read ANTHROPIC_API_KEY /
    // OPENAI_API_KEY, and Pulse deliberately uses ONE vendor-neutral
    // AI_API_KEY so switching providers is a single env change. Using the
    // singletons silently ignores AI_API_KEY and fails with "API key is
    // missing" even though a key is set.
    case 'anthropic':
      return createAnthropic({ apiKey: process.env.AI_API_KEY })(id);
    case 'openai':
      return createOpenAI({ apiKey: process.env.AI_API_KEY })(id);
    case 'openai-compatible': {
      const baseURL = process.env.AI_BASE_URL;
      if (!baseURL) {
        throw new Error("AI_PROVIDER='openai-compatible' requires AI_BASE_URL (e.g. http://localhost:11434/v1)");
      }
      // apiKey is optional: a local Ollama or vLLM server usually wants none,
      // but the SDK still expects the field, so pass a placeholder.
      return createOpenAICompatible({
        name: 'custom',
        baseURL,
        apiKey: process.env.AI_API_KEY || 'not-needed',
      })(id);
    }
  }
}

/** Provenance stamped onto every classified mention, so a re-sweep can tell
 *  which model produced a label and stale rows can be found later. */
export const modelVersion = () => `${providerId()}/${modelId()}`;
