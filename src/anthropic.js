import Anthropic from '@anthropic-ai/sdk';
import { config, requireKeys } from './config.js';
import { recordModelCall } from './evaluate/trace.js';

let client = null;

/** Haiku 4.5 does not accept Claude's adaptive-thinking request parameter. */
export function supportsAdaptiveThinking(model) {
  return !/^claude-haiku(?:-|$)/i.test(String(model || ''));
}

/** Haiku 4.5 also does not support the output-config effort control. */
export function supportsEffort(model) {
  return !/^claude-haiku(?:-|$)/i.test(String(model || ''));
}

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
 * Convert concise local prompt declarations to Anthropic text blocks. An
 * explicit cache breakpoint is respected, which lets callers cache a shared
 * prefix before adding a domain-specific suffix.
 */
export function buildSystemBlocks(system, { cacheSystem = true } = {}) {
  const systemBlocks = (Array.isArray(system) ? system : [system]).map((block) => {
    if (block && typeof block === 'object' && !Array.isArray(block)) {
      const text = String(block.text ?? '');
      return block.cache === true || block.cache_control
        ? { type: 'text', text, cache_control: block.cache_control ?? { type: 'ephemeral' } }
        : { type: 'text', text };
    }
    return { type: 'text', text: String(block ?? '') };
  });

  if (cacheSystem && systemBlocks.length && !systemBlocks.some((block) => block.cache_control)) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
  }
  return systemBlocks;
}

/**
 * One structured-JSON call against the Messages API.
 *
 * - `output_config.format` guarantees the response validates against `schema`,
 *   so there is no parse-and-retry loop.
 * - Adaptive thinking is used for models that support it; Haiku omits it for
 *   fast, compatible workflow testing.
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
  trace,
  traceLabel = 'claude',
}) {
  const anthropic = getClient();
  const systemBlocks = buildSystemBlocks(system, { cacheSystem });

  const outputConfig = {
    format: { type: 'json_schema', schema },
  };
  if (supportsEffort(config.anthropic.model)) outputConfig.effort = effort;

  const params = {
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    output_config: outputConfig,
  };
  if (supportsAdaptiveThinking(config.anthropic.model)) {
    params.thinking = { type: 'adaptive' };
  }

  const startedAt = new Date().toISOString();
  const started = Date.now();
  let message;
  let jsonText = '';
  try {
    message = await runStream(anthropic, params, { useFallbacks, onProgress });

    if (message.stop_reason === 'refusal') {
      throw new RefusalError(message.stop_details);
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error(
        `Response hit max_tokens (${maxTokens}) before completing. Raise maxTokens or narrow the evidence bundle.`,
      );
    }

    jsonText = message.content.find((block) => block.type === 'text')?.text || '';
    if (!jsonText) throw new Error(`No text block in response (stop_reason: ${message.stop_reason}).`);
    const data = JSON.parse(jsonText);
    recordModelCall(trace, {
      label: traceLabel,
      status: 'ok',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      model: message.model,
      effort,
      maxTokens,
      usage: message.usage,
      stopReason: message.stop_reason,
      system,
      userContent,
      schema,
      responseText: jsonText,
    });
    return { data, usage: message.usage, model: message.model };
  } catch (err) {
    recordModelCall(trace, {
      label: traceLabel,
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      model: message?.model ?? config.anthropic.model,
      effort,
      maxTokens,
      usage: message?.usage ?? null,
      stopReason: message?.stop_reason ?? null,
      error: { name: err.name, message: err.message },
      system,
      userContent,
      schema,
      responseText: jsonText,
    });
    throw err;
  }
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
