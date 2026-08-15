import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const paths = {
  root: path.resolve(here, '..'),
  public: path.resolve(here, '..', 'public'),
  data: path.resolve(here, '..', 'data'),
  catalog: path.resolve(here, '..', 'data', 'trials.json'),
  evaluations: path.resolve(here, '..', 'data', 'evaluations'),
  probe: path.resolve(here, '..', 'data', 'probe'),
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
    // Opus 5 is the default: this is a judgment-heavy regulatory review.
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    evalEffort: process.env.EVAL_EFFORT || 'high',
    extractEffort: process.env.EXTRACT_EFFORT || 'low',
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
