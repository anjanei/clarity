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
};

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
