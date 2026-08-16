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
  requireKeys('model');
  client ??= new Anthropic({ apiKey: config.model.apiKey });
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
  effort = config.model.evalEffort,
  maxTokens = 32000,
  cacheSystem = true,
  useFallbacks = true,
  onProgress,
  trace,
  traceLabel = 'model',
}) {
  if (config.model.provider === 'openai') {
    return structuredOpenAICompatibleCall({
      system,
      userContent,
      schema,
      effort,
      maxTokens,
      onProgress,
      trace,
      traceLabel,
    });
  }

  const anthropic = getClient();
  const systemBlocks = buildSystemBlocks(system, { cacheSystem });

  const outputConfig = {
    format: { type: 'json_schema', schema },
  };
  if (supportsEffort(config.model.name)) outputConfig.effort = effort;

  const params = {
    model: config.model.name,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    output_config: outputConfig,
  };
  if (supportsAdaptiveThinking(config.model.name)) {
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
      provider: config.model.provider,
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
      provider: config.model.provider,
      model: message?.model ?? config.model.name,
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

function systemText(system) {
  return (Array.isArray(system) ? system : [system])
    .map((block) => (block && typeof block === 'object' && !Array.isArray(block) ? block.text : block))
    .map((text) => String(text ?? ''))
    .filter(Boolean)
    .join('\n\n');
}

function jsonFromText(text) {
  const fenced = String(text ?? '').match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : text);
}

function normalizeOpenAIUsage(usage = {}) {
  return {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}

async function structuredOpenAICompatibleCall({
  system,
  userContent,
  schema,
  effort,
  maxTokens,
  onProgress,
  trace,
  traceLabel,
}) {
  requireKeys('model');
  const baseUrl = config.model.baseUrl.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  const url = `${baseUrl}/chat/completions`;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let responseText = '';
  let parsedBody = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.model.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model.name,
        messages: [
          { role: 'system', content: systemText(system) },
          { role: 'user', content: userContent },
        ],
        max_tokens: maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'clarity_structured_output',
            strict: true,
            schema,
          },
        },
      }),
    });
    responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Model endpoint failed (${response.status}): ${responseText.slice(0, 300)}`);
    }
    parsedBody = JSON.parse(responseText);
    const content = parsedBody?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Model endpoint returned no assistant content.');
    }
    onProgress?.(content);
    const data = jsonFromText(content);
    const usage = normalizeOpenAIUsage(parsedBody.usage);
    recordModelCall(trace, {
      label: traceLabel,
      status: 'ok',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      provider: config.model.provider,
      model: parsedBody.model ?? config.model.name,
      effort,
      maxTokens,
      usage,
      stopReason: parsedBody?.choices?.[0]?.finish_reason ?? null,
      system,
      userContent,
      schema,
      responseText: content,
    });
    return { data, usage, model: parsedBody.model ?? config.model.name, provider: config.model.provider };
  } catch (err) {
    recordModelCall(trace, {
      label: traceLabel,
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      provider: config.model.provider,
      model: parsedBody?.model ?? config.model.name,
      effort,
      maxTokens,
      usage: normalizeOpenAIUsage(parsedBody?.usage),
      stopReason: parsedBody?.choices?.[0]?.finish_reason ?? null,
      error: { name: err.name, message: err.message },
      system,
      userContent,
      schema,
      responseText,
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
