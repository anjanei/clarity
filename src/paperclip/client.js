import { config, requireKeys } from '../config.js';

const PROTOCOL_VERSION = '2025-06-18';

/**
 * Paperclip's published interface is an MCP server (Streamable HTTP) at
 * https://paperclip.gxl.ai/mcp authenticated with `X-API-Key`. The raw REST
 * shapes behind it are not documented, so this client speaks MCP JSON-RPC and
 * discovers the available tools at runtime (see tools.js) instead of hardcoding
 * endpoint paths we would only be guessing at.
 */

/** A Streamable-HTTP response may be JSON or an SSE frame sequence. */
function parseRpcBody(contentType, text) {
  if (!text.trim()) return [];
  if (contentType.includes('text/event-stream')) {
    const messages = [];
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // keep-alive comment or partial frame — ignore
      }
    }
    return messages;
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export class PaperclipError extends Error {
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.name = 'PaperclipError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export class PaperclipClient {
  #nextId = 1;
  #sessionId = null;
  #handshake = null;
  #toolsCache = null;

  constructor({ url = config.paperclip.mcpUrl, apiKey = config.paperclip.apiKey } = {}) {
    this.url = url;
    this.apiKey = apiKey;
  }

  #headers() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-API-Key': this.apiKey,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (this.#sessionId) headers['Mcp-Session-Id'] = this.#sessionId;
    return headers;
  }

  async #post(payload) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(payload),
    });

    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this.#sessionId = sessionId;

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      throw new PaperclipError(
        `Paperclip ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
        { status: res.status },
      );
    }
    return parseRpcBody(contentType, text);
  }

  /** Send a JSON-RPC request and return its `result`. */
  async #request(method, params) {
    const id = this.#nextId++;
    const messages = await this.#post({ jsonrpc: '2.0', id, method, params });
    const reply = messages.find((m) => m.id === id) ?? messages.find((m) => 'result' in m || 'error' in m);

    if (!reply) {
      throw new PaperclipError(`No JSON-RPC reply for ${method}`, { data: messages });
    }
    if (reply.error) {
      throw new PaperclipError(`Paperclip ${method} failed: ${reply.error.message}`, {
        code: reply.error.code,
        data: reply.error.data,
      });
    }
    return reply.result;
  }

  async #notify(method, params) {
    await this.#post({ jsonrpc: '2.0', method, params });
  }

  /** Idempotent: concurrent callers share one handshake. */
  async connect() {
    requireKeys('paperclip');
    this.#handshake ??= (async () => {
      const result = await this.#request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'fdaapproval', version: '0.1.0' },
      });
      await this.#notify('notifications/initialized');
      return result;
    })().catch((err) => {
      this.#handshake = null; // let the next caller retry
      throw err;
    });
    return this.#handshake;
  }

  async listTools({ refresh = false } = {}) {
    await this.connect();
    if (this.#toolsCache && !refresh) return this.#toolsCache;

    const tools = [];
    let cursor;
    do {
      const page = await this.#request('tools/list', cursor ? { cursor } : {});
      tools.push(...(page.tools || []));
      cursor = page.nextCursor;
    } while (cursor);

    this.#toolsCache = tools;
    return tools;
  }

  /**
   * Call a tool and flatten the MCP content array into plain text.
   * Returns `{ text, structured, isError, content }`.
   */
  async callTool(name, args = {}) {
    await this.connect();
    const result = await this.#request('tools/call', { name, arguments: args });

    const content = result.content || [];
    const text = content
      .map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'resource' && block.resource?.text) return block.resource.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');

    if (result.isError) {
      throw new PaperclipError(`Paperclip tool "${name}" reported an error: ${text.slice(0, 500)}`, {
        data: result,
      });
    }

    return { text, structured: result.structuredContent ?? null, isError: false, content };
  }
}

/** Shared client — the MCP handshake is worth reusing across requests. */
export const paperclip = new PaperclipClient();
