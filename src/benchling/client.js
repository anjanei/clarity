// Benchling API client — personal API key or OAuth2 client-credentials.
//
// The app secret never reaches the browser. The frontend only ever talks to
// /api/benchling/*, which calls this module server-side.
//
// Benchling is tenant-scoped: credentials do not remove the need to know the
// tenant URL. BENCHLING_TENANT is therefore required, and its absence is
// reported as "not configured" rather than papered over.
import { Buffer } from 'node:buffer';
import { benchlingConfigured, config } from '../config.js';

const TOKEN_SKEW_MS = 60_000;
let cachedToken = null;

function baseUrl() {
  const tenant = config.benchling.tenant.trim();
  // Accept "sameer", "sameer.benchling.com" or a full origin.
  if (/^https?:\/\//i.test(tenant)) return `${tenant.replace(/\/+$/, '')}/api/v2`;
  if (tenant.includes('.')) return `https://${tenant}/api/v2`;
  return `https://${tenant}.benchling.com/api/v2`;
}

export function benchlingStatus() {
  return {
    configured: benchlingConfigured(),
    tenant: config.benchling.tenant || null,
    appId: config.benchling.appId || null,
    authMode: config.benchling.apiKey ? 'api_key' : config.benchling.clientId ? 'oauth_app' : null,
    hasApiKey: Boolean(config.benchling.apiKey),
    // Presence only — never the value.
    hasClientId: Boolean(config.benchling.clientId),
    hasClientSecret: Boolean(config.benchling.clientSecret),
  };
}

/** Client-credentials token, cached until shortly before it expires. */
async function accessToken() {
  if (!benchlingConfigured()) {
    throw Object.assign(new Error('Benchling is not configured (set BENCHLING_TENANT).'), {
      code: 'benchling_unconfigured',
    });
  }
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > Date.now()) return cachedToken.value;

  const credentials = Buffer.from(
    `${config.benchling.clientId}:${config.benchling.clientSecret}`,
  ).toString('base64');

  const res = await fetch(`${baseUrl()}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Benchling token request failed (${res.status}). ${detail.slice(0, 300)}`),
      { code: 'benchling_auth_failed', status: res.status },
    );
  }

  const body = await res.json();
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return cachedToken.value;
}

async function authHeaders() {
  if (!benchlingConfigured()) {
    throw Object.assign(new Error('Benchling is not configured (set BENCHLING_TENANT and BENCHLING_API_KEY or app credentials).'), {
      code: 'benchling_unconfigured',
    });
  }

  if (config.benchling.apiKey) {
    return {
      Authorization: `Basic ${Buffer.from(`${config.benchling.apiKey}:`).toString('base64')}`,
      Accept: 'application/json',
    };
  }

  return {
    Authorization: `Bearer ${await accessToken()}`,
    Accept: 'application/json',
  };
}

async function apiGet(pathname, params = {}) {
  const url = new URL(`${baseUrl()}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, { headers: await authHeaders() });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Benchling ${pathname} failed (${res.status}). ${detail.slice(0, 300)}`), {
      code: 'benchling_request_failed',
      status: res.status,
    });
  }
  return res.json();
}

/** Reachability probe used by /api/health and the lab status strip. */
export async function checkBenchling() {
  const status = benchlingStatus();
  if (!status.configured) return { ...status, reachable: false };
  try {
    await apiGet('/folders', { pageSize: 1 });
    return { ...status, reachable: true };
  } catch (err) {
    return { ...status, reachable: false, error: err.message };
  }
}

export async function searchDnaSequences(name, { pageSize = 10 } = {}) {
  const body = await apiGet('/dna-sequences', { name, pageSize });
  return body.dnaSequences ?? [];
}

export async function searchAaSequences(name, { pageSize = 10 } = {}) {
  const body = await apiGet('/aa-sequences', { name, pageSize });
  return body.aaSequences ?? [];
}

/**
 * Best-effort lookup of a construct for one therapeutic. Benchling name search
 * is exact-ish, so the therapeutic name is tried whole and then on its most
 * distinctive token ("CTX001" out of "CTX001 (exagamglogene autotemcel)").
 */
export async function findConstructFor(therapeuticName) {
  const candidates = [];
  const whole = String(therapeuticName || '').trim();
  if (whole) candidates.push(whole);
  const token = whole.match(/\b[A-Z]{2,}[-\s]?\d{2,}\b/)?.[0];
  if (token && token !== whole) candidates.push(token);

  for (const candidate of candidates) {
    const [dna, aa] = await Promise.all([
      searchDnaSequences(candidate, { pageSize: 5 }).catch(() => []),
      searchAaSequences(candidate, { pageSize: 5 }).catch(() => []),
    ]);
    if (dna.length) return { kind: 'dna', query: candidate, sequence: dna[0], alternatives: dna.slice(1) };
    if (aa.length) return { kind: 'aa', query: candidate, sequence: aa[0], alternatives: aa.slice(1) };
  }
  return null;
}
