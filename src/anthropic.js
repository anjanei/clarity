import Anthropic from '@anthropic-ai/sdk';
import { config, requireKeys } from './config.js';

let client = null;

function getClient() {
  requireKeys('anthropic');
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

export class RefusalError extends Error {
  constructor(stopDetails) {
    super(
      `Claude declined this request${stopDetails?.category ? ` (${stopDetails.category})` : ''}` +
        `${stopDetails?.explanation ? `: ${stopDetails.explanation}` : '.'}`,
    );
    this.name = 'RefusalError';
    this.stopDetails = stopDetails ?? null;
  }
}

/**
 * One structured-JSON call against the Messages API.
 *
 * - `output_config.format` guarantees the response validates against `schema`,
 *   so there is no parse-and-retry loop.
 * - Adaptive thinking is on (the default on Opus 5) — this is judgment work.
 * - Streaming is used because evidence payloads are large and `max_tokens` is
 *   high; a non-streaming request at this size risks an HTTP timeout.
 * - `system` is cached: the rubric and reviewer persona are byte-stable across
 *   every trial, so only the evidence is re-billed at full rate.
 * - Server-side fallbacks are enabled by default so a safety-classifier decline
 *   is re-served instead of failing the request.
 */
export async function structuredCall({
  system,
  userContent,
  schema,
  effort = config.anthropic.evalEffort,
  maxTokens = 32000,
  cacheSystem = true,
  useFallbacks = true,
  onProgress,
}) {
  const anthropic = getClient();

  const systemBlocks = (Array.isArray(system) ? system : [system]).map((text) => ({
    type: 'text',
    text,
  }));
  if (cacheSystem && systemBlocks.length) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
  }

  const params = {
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
  };

  const message = await runStream(anthropic, params, { useFallbacks, onProgress });

  if (message.stop_reason === 'refusal') {
    throw new RefusalError(message.stop_details);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Response hit max_tokens (${maxTokens}) before completing. Raise maxTokens or narrow the evidence bundle.`,
    );
  }

  const jsonText = message.content.find((block) => block.type === 'text')?.text;
  if (!jsonText) throw new Error(`No text block in response (stop_reason: ${message.stop_reason}).`);

  return {
    data: JSON.parse(jsonText),
    usage: message.usage,
    model: message.model,
  };
}

async function runStream(anthropic, params, { useFallbacks, onProgress }) {
  const attempt = async (withFallbacks) => {
    const body = withFallbacks
      ? { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
      : params;

    const stream = withFallbacks
      ? anthropic.beta.messages.stream(body)
      : anthropic.messages.stream(body);

    if (onProgress) stream.on('text', onProgress);
    return stream.finalMessage();
  };

  if (!useFallbacks) return attempt(false);

  try {
    return await attempt(true);
  } catch (err) {
    // The fallback beta is not available everywhere; degrade rather than fail.
    const message = String(err?.message || '');
    const isFallbackRejection =
      err?.status === 400 && /fallback|beta/i.test(message);
    if (!isFallbackRejection) throw err;
    return attempt(false);
  }
}
