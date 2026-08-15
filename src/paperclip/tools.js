import { paperclip, PaperclipError } from './client.js';

/**
 * Paperclip's hosted MCP server exposes exactly one tool — `paperclip` — whose
 * only argument is a CLI command string (without the `paperclip` prefix), e.g.
 *   search -s fda "pembrolizumab" -n 20
 *   search -n 40 "breast cancer HER2" /trials/us
 *   map --from s_1907a2d0 "What were the primary endpoints?"
 *
 * This module is the single place that builds those command strings. Verified
 * against `paperclip skill` (the server's own documentation) — see README.
 */

const TOOL_NAME = 'paperclip';

/** Sources accepted by `-s`. Region scoping is a path, not a source. */
export const SOURCES = {
  papers: 'papers',
  pmc: 'pmc',
  biorxiv: 'biorxiv',
  medrxiv: 'medrxiv',
  arxiv: 'arxiv',
  abstracts: 'abstracts',
  fda: 'fda',
  trials: 'trials',
  proteins: 'proteins',
  clipboard: 'clipboard',
};

/** Virtual directory paths usable as a search scope. */
export const PATHS = {
  trialsUs: '/trials/us',
  trialsEu: '/trials/eu',
  trialsJp: '/trials/jp',
  trialsCn: '/trials/cn',
  trialsIntl: '/trials/intl',
  fdaUs: '/fda/us',
  fdaEu: '/fda/eu',
  fdaJp: '/fda/jp',
};

/** Quote an argument for the server-side command parser. */
export function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Collapse whitespace — a multi-line query breaks command parsing. */
function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

let connectionPromise = null;

/**
 * Confirm the hosted server still exposes the single `paperclip` tool.
 * Cached: the MCP handshake is worth reusing across requests.
 */
export async function checkConnection({ refresh = false } = {}) {
  if (!connectionPromise || refresh) {
    connectionPromise = (async () => {
      const tools = await paperclip.listTools({ refresh });
      const tool = tools.find((t) => t.name === TOOL_NAME);
      if (!tool) {
        throw new PaperclipError(
          `Paperclip MCP server exposes no "${TOOL_NAME}" tool (found: ${
            tools.map((t) => t.name).join(', ') || 'none'
          }). Run \`npm run probe\` — the server interface may have changed.`,
        );
      }
      return { toolName: tool.name, tools: tools.map((t) => t.name) };
    })().catch((err) => {
      connectionPromise = null;
      throw err;
    });
  }
  return connectionPromise;
}

/** Run a raw Paperclip CLI command. Returns `{ command, text }`. */
export async function run(command) {
  await checkConnection();
  const cmd = oneLine(command);
  const result = await paperclip.callTool(TOOL_NAME, { command: cmd });
  return { command: cmd, text: result.text, structured: result.structured };
}

/**
 * `search` — the `-s` source flag is mandatory unless a virtual directory path
 * is supplied as the scope instead.
 */
export async function search(query, { source, path, limit = 20, ranking, saveAs, extra } = {}) {
  if (!source && !path) {
    throw new PaperclipError('Paperclip search requires either a source (-s) or a virtual path scope.');
  }

  const parts = ['search'];
  if (source) parts.push('-s', Array.isArray(source) ? source.join(',') : source);
  if (limit) parts.push('-n', String(limit));
  if (ranking) parts.push('--ranking', ranking);
  if (saveAs) parts.push('--save-as', saveAs);
  if (extra) parts.push(extra);
  parts.push(quote(oneLine(query)));
  if (path) parts.push(path);

  return run(parts.join(' '));
}

/** `map` — per-paper LLM reader over a saved result set (`s_…` id or alias). */
export async function map(fromId, question, { outputSchema } = {}) {
  const parts = ['map', '--from', fromId];
  if (outputSchema) parts.push('--output-schema', quote(JSON.stringify(outputSchema)));
  parts.push(quote(oneLine(question)));
  return run(parts.join(' '));
}

/** `reduce` — synthesize map results. */
export async function reduce(fromId, question, { strategy = 'summarize' } = {}) {
  return run(`reduce --from ${fromId} --strategy ${strategy} ${quote(oneLine(question))}`);
}

/** `sql` — metadata and aggregation over the `documents` table only. */
export async function sql(query) {
  return run(`sql ${quote(oneLine(query))}`);
}

export async function cat(path) {
  return run(`cat ${path}`);
}

/** `skill` — the server's own documentation, optionally for one domain. */
export async function skill(domain) {
  return run(domain ? `skill ${domain}` : 'skill');
}
