import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(here, '..', 'data');

export const paths = {
  root: path.resolve(here, '..'),
  public: path.resolve(here, '..', 'public'),
  data: dataDirectory,
  catalog: path.join(dataDirectory, 'trials.json'),
  evaluations: path.join(dataDirectory, 'evaluations'),
  traces: path.join(dataDirectory, 'traces'),
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
  modal: {
    // The deployed endpoint's URL. Modal web functions are
    // https://<workspace>--<app>-<fn>.modal.run; Auto Endpoints are
    // https://<endpoint>.<region>.modal.direct.
    url: (process.env.MODAL_ENDPOINT_URL || '').replace(/\/+$/, ''),
    // Proxy-auth token pair. The id is `wk-…`, the secret `ws-…`; the secret is
    // shown once at creation and lives only in the server environment.
    tokenId: process.env.MODAL_TOKEN_ID || '',
    tokenSecret: process.env.MODAL_TOKEN_SECRET || '',
    // `json` posts the task payload as-is. `openai` wraps it as a chat
    // completion, which is what Modal's OpenAI-compatible endpoints expect.
    mode: (process.env.MODAL_MODE || 'json').toLowerCase() === 'openai' ? 'openai' : 'json',
    model: process.env.MODAL_MODEL || '',
    timeoutMs: Math.max(1000, Number(process.env.MODAL_TIMEOUT_MS) || 120_000),
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

/** Modal needs a destination and both halves of the proxy token to be usable. */
export const modalConfigured = () =>
  Boolean(config.modal.url && config.modal.tokenId && config.modal.tokenSecret);

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
