// The Modal transport.
//
// Modal is the lab's second compute provider. Claude does the reading and the
// judgement; Modal does the two jobs that want a GPU rather than a language
// model — folding a sequence into a structure, and grounding a claim to the
// exact passage that supports it.
//
// Three rules hold for everything below, and they are the same rules the rest of
// the pipeline follows:
//
//   1. It is optional. Every caller has a defined, honest behaviour when Modal
//      is not configured, and that behaviour is the default. Nothing degrades
//      into a guess.
//   2. The secret never leaves the server. The browser cannot reach Modal at all
//      — the content policy is `connect-src 'self'` — so every call proxies
//      through this process, which is where the token belongs.
//   3. A failure is reported, not absorbed. A structure that could not be
//      predicted is absent, never approximated.

import { config, modalConfigured } from '../config.js';

export class ModalError extends Error {
  constructor(message, { status = 0, cause } = {}) {
    super(message);
    this.name = 'ModalError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/**
 * Proxy-auth headers. Modal accepts the pair either as one bearer token joined
 * by a period, or as two headers. Shared OpenAI-compatible Endpoints expect the
 * bearer form; plain Web Functions use the key/secret headers.
 */
function authHeaders({ openai = false } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (openai) {
    headers.Authorization = `Bearer ${config.modal.tokenId}.${config.modal.tokenSecret}`;
  } else {
    headers['Modal-Key'] = config.modal.tokenId;
    headers['Modal-Secret'] = config.modal.tokenSecret;
  }
  return headers;
}

/** Never let a token reach a log line, a response body or a trace. */
export function redact(text) {
  return String(text ?? '').replace(/\b(wk|ws|ak|as)-[A-Za-z0-9_-]{6,}/g, '$1-***');
}

/**
 * One request to the deployed endpoint.
 *
 * `mode: 'json'` posts the task payload as-is, which is what a hand-written
 * Modal web function expects. `mode: 'openai'` wraps it as a chat completion for
 * Modal's OpenAI-compatible Auto Endpoints and unwraps the reply, so the same
 * task definitions work against either shape without the callers knowing which.
 */
export async function callModal(task, payload, { signal, timeoutMs = config.modal.timeoutMs } = {}) {
  const wiring = config.modal.tasks[task];
  if (!wiring) throw new ModalError(`Unknown Modal task "${task}".`);
  if (!modalConfigured(task)) {
    throw new ModalError(
      `Modal ${task} is not configured. Set MODAL_${task.toUpperCase()}_URL (or MODAL_ENDPOINT_URL), ` +
        'MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller that gives up should cancel the upstream request too, rather than
  // leaving a GPU call running that nobody will read.
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  const openai = wiring.mode === 'openai';
  const url = openai ? `${wiring.url}/v1/chat/completions` : wiring.url;
  const body = openai
    ? {
        model: wiring.model || 'default',
        messages: [
          { role: 'system', content: `You are the ${task} worker for a regulatory evidence pipeline. Reply with JSON only.` },
          { role: 'user', content: JSON.stringify({ task, ...payload }) },
        ],
        temperature: 0,
      }
    : { task, ...payload };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: authHeaders({ openai }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ModalError(
      controller.signal.aborted ? `Modal ${task} timed out after ${timeoutMs}ms.` : `Modal ${task} was unreachable: ${redact(err.message)}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new ModalError(`Modal ${task} failed (${response.status}): ${redact(text).slice(0, 300)}`, {
      status: response.status,
    });
  }

  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new ModalError(`Modal ${task} returned a body that is not JSON.`, { cause: err });
  }

  if (!openai) return parsed;

  // Unwrap the chat completion. A worker that answers in a fenced block is
  // common enough to be worth handling rather than failing on.
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new ModalError(`Modal ${task} returned no assistant content.`);
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : content);
  } catch (err) {
    throw new ModalError(`Modal ${task} content was not JSON.`, { cause: err });
  }
}

/**
 * Presence only — this is served to the browser and must expose no secret.
 * Reported per task, so the lab can offer grounding on a deployment that has an
 * LLM and no folder, rather than showing a control that can only fail.
 */
export function modalStatus() {
  const tasks = Object.fromEntries(
    Object.entries(config.modal.tasks).map(([task, wiring]) => [
      task,
      {
        configured: modalConfigured(task),
        mode: wiring.mode,
        model: wiring.model || null,
        // The host helps debug a misconfiguration; the token never does.
        host: wiring.url ? safeHost(wiring.url) : null,
      },
    ]),
  );
  return {
    configured: modalConfigured(),
    hasTokenId: Boolean(config.modal.tokenId),
    hasTokenSecret: Boolean(config.modal.tokenSecret),
    tasks,
  };
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
