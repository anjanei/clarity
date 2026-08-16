import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(here, '..', 'data');
const evaluationsDirectory = process.env.EVALUATIONS_DIR
  ? path.resolve(process.env.EVALUATIONS_DIR)
  : path.join(dataDirectory, 'evaluations');
const tracesDirectory = process.env.TRACES_DIR
  ? path.resolve(process.env.TRACES_DIR)
  : path.join(dataDirectory, 'traces');

/**
 * One Modal task's wiring. `MODAL_<TASK>_URL` wins over the shared
 * `MODAL_ENDPOINT_URL`, so a deployment can point grounding at an LLM and
 * folding at a structure predictor without either knowing about the other.
 *
 * Modal web functions live at https://<workspace>--<app>-<fn>.modal.run and
 * Auto Endpoints at https://<endpoint>.<region>.modal.direct.
 */
function modalTask(name, defaultMode) {
  const url = process.env[`MODAL_${name}_URL`] || process.env.MODAL_ENDPOINT_URL || '';
  const mode = (process.env[`MODAL_${name}_MODE`] || process.env.MODAL_MODE || defaultMode).toLowerCase();
  return {
    url: url.replace(/\/+$/, ''),
    // `json` posts the task payload as-is, for a hand-written web function.
    // `openai` wraps it as a chat completion, for an OpenAI-compatible server.
    mode: mode === 'openai' ? 'openai' : 'json',
    model: process.env[`MODAL_${name}_MODEL`] || process.env.MODAL_MODEL || '',
  };
}

export const paths = {
  root: path.resolve(here, '..'),
  public: path.resolve(here, '..', 'public'),
  data: dataDirectory,
  catalog: path.join(dataDirectory, 'trials.json'),
  evaluations: evaluationsDirectory,
  traces: tracesDirectory,
  probe: path.join(dataDirectory, 'probe'),
};

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  paperclip: {
    apiKey: process.env.PAPERCLIP_API_KEY || '',
    mcpUrl: process.env.PAPERCLIP_MCP_URL || 'https://paperclip.gxl.ai/mcp',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    // Opus is the default for the judgment-heavy regulatory review.
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    evalEffort: process.env.EVAL_EFFORT || 'high',
    extractEffort: process.env.EXTRACT_EFFORT || 'low',
  },

  evidence: {
    // Keep remote work bounded so a Phase 3 sweep is faster without overrunning service limits.
    paperclipConcurrency: Math.max(1, Number(process.env.PAPERCLIP_CONCURRENCY) || 4),
    domainConcurrency: Math.max(1, Number(process.env.DOMAIN_CONCURRENCY) || 2),
  },

  trace: {
    mode: process.env.TRACE_MODE || 'off',
  },

  // The run routes are the only ones that spend money, and they sit on a public
  // URL with no authentication. These are the levers that bound the damage.
  runs: {
    // `off` serves cached reviews only — the right setting for a public demo.
    enabled: String(process.env.PUBLIC_RUNS ?? 'on').toLowerCase() !== 'off',
    windowMs: Math.max(1000, Number(process.env.RUN_WINDOW_MS) || 10 * 60 * 1000),
    perWindow: Math.max(1, Number(process.env.RUN_LIMIT) || 6),
    concurrent: Math.max(1, Number(process.env.RUN_CONCURRENCY) || 2),
  },

  // Modal is the second compute provider, alongside Claude. It carries the two
  // jobs that want a GPU rather than a language model: folding a sequence into a
  // structure, and grounding a reviewer's claim to the exact passage that
  // supports it. Both are additive — every surface that uses Modal has a defined
  // behaviour when it is not configured, and that is the default.
  // The two tasks are almost never the same deployment: grounding wants a
  // language model, folding wants a structure predictor. They therefore get
  // their own endpoint and their own protocol, each falling back to the shared
  // MODAL_ENDPOINT_URL when a deployment really does serve both.
  modal: {
    tokenId: process.env.MODAL_TOKEN_ID || '',
    tokenSecret: process.env.MODAL_TOKEN_SECRET || '',
    timeoutMs: Math.max(1000, Number(process.env.MODAL_TIMEOUT_MS) || 120_000),
    tasks: {
      ground: modalTask('GROUND', 'openai'),
      fold: modalTask('FOLD', 'json'),
    },
  },

  // Benchling is tenant-scoped: the same app credentials are meaningless without
  // knowing which tenant to authenticate against. Absent a tenant the gene-model
  // panel renders modality-derived schematics and says so, rather than guessing.
  benchling: {
    tenant: process.env.BENCHLING_TENANT || '',
    apiKey: process.env.BENCHLING_API_KEY || '',
    clientId: process.env.BENCHLING_CLIENT_ID || '',
    clientSecret: process.env.BENCHLING_CLIENT_SECRET || '',
    appId: process.env.BENCHLING_APP_ID || '',
  },
};

/**
 * Modal needs a destination and both halves of the proxy token to be usable, and
 * it is answered per task — a deployment may well have grounding and not folding.
 */
export const modalConfigured = (task) => {
  if (!config.modal.tokenId || !config.modal.tokenSecret) return false;
  if (task) return Boolean(config.modal.tasks[task]?.url);
  return Object.values(config.modal.tasks).some((entry) => entry.url);
};

export const benchlingConfigured = () =>
  Boolean(
    config.benchling.tenant &&
      (config.benchling.apiKey || (config.benchling.clientId && config.benchling.clientSecret)),
  );

/** Throws a readable error rather than letting an SDK 401 surface later. */
export function requireKeys(...which) {
  const missing = [];
  if (which.includes('paperclip') && !config.paperclip.apiKey) missing.push('PAPERCLIP_API_KEY');
  if (which.includes('anthropic') && !config.anthropic.apiKey) missing.push('ANTHROPIC_API_KEY');
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(' and ')}. Copy .env.example to .env and fill them in.`,
    );
  }
}
