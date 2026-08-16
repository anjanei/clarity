import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, modelConfigured, paths } from './config.js';
import { trialsRouter } from './routes/trials.js';
import { evaluateRouter } from './routes/evaluate.js';
import { labRouter } from './routes/lab.js';
import { modalRouter } from './routes/modal.js';
import { modalStatus } from './modal/client.js';
import { loadCatalog } from './catalog/store.js';
import { checkConnection } from './paperclip/tools.js';
import { checkBenchling } from './benchling/client.js';

/**
 * Response headers every route gets. The page loads no third-party code and
 * makes no cross-origin requests, so the policy can be as tight as "self" plus
 * inline styles — the report renders inline `style` attributes for meter widths
 * and heat fills, but never an inline script.
 *
 * This covers everything Express handles. It is deliberately duplicated in the
 * `headers` block of vercel.json, because files under `public/` are served
 * straight from the CDN and never reach this middleware — which would leave the
 * HTML page, the surface that matters most for XSS and clickjacking, with no
 * policy at all. Keep the two copies identical.
 */
function securityHeaders(_req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  next();
}

export function createApp() {
  const app = express();
  // Vercel and every other proxy set X-Forwarded-For; without this Express
  // reports the proxy's address and the rate limiter counts every caller as one.
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', trialsRouter);
  app.use('/api', evaluateRouter);
  app.use('/api', labRouter);
  app.use('/api', modalRouter);

  app.get('/api/health', async (_req, res, next) => {
    try {
      res.json(await health());
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(paths.public, { extensions: ['html'] }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'not_found', message: `No route for ${req.path}` });
    }
    res.sendFile('index.html', { root: paths.public });
  });

  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error', message: err.message });
  });

  return app;
}

/**
 * Health is the one unauthenticated route that reaches *out*: it probes
 * Paperclip over MCP and Benchling over HTTP to report whether they answer. Run
 * uncached, a loop over `/api/health` turns this lab into an amplifier pointed
 * at two upstreams that are not ours to hammer — and the page pays the round
 * trip on every load.
 *
 * So the payload is memoised for a few seconds, and concurrent callers share the
 * one in-flight probe rather than each starting their own. A failed probe is
 * cached for less time than a healthy one, so a service that comes back is
 * reported as back quickly rather than after a full window.
 */
const HEALTH_TTL_MS = 15_000;
const HEALTH_ERROR_TTL_MS = 4_000;
let healthCache = null;
let healthInFlight = null;

function health() {
  const now = Date.now();
  if (healthCache && now < healthCache.until) return Promise.resolve(healthCache.payload);
  if (healthInFlight) return healthInFlight;

  healthInFlight = buildHealth()
    .then((payload) => {
      const degraded = !payload.ok || payload.paperclip?.reachable === false;
      healthCache = { payload, until: Date.now() + (degraded ? HEALTH_ERROR_TTL_MS : HEALTH_TTL_MS) };
      return payload;
    })
    .finally(() => {
      healthInFlight = null;
    });

  return healthInFlight;
}

async function buildHealth() {
  const catalog = await loadCatalog().catch(() => null);

  let paperclip = { reachable: false };
  if (config.paperclip.apiKey) {
    try {
      const connection = await checkConnection();
      paperclip = { reachable: true, tool: connection.toolName, tools: connection.tools };
    } catch (err) {
      paperclip = { reachable: false, error: err.message };
    }
  }

  return {
    ok: Boolean(config.paperclip.apiKey && modelConfigured() && catalog),
    keys: {
      paperclip: Boolean(config.paperclip.apiKey),
      model: modelConfigured(),
    },
    provider: config.model.provider,
    model: config.model.name,
    effort: config.model.evalEffort,
    runs: {
      enabled: config.runs.enabled,
      perWindow: config.runs.perWindow,
      windowMinutes: Math.round(config.runs.windowMs / 60000),
      concurrent: config.runs.concurrent,
    },
    auditMemory: {
      store: config.auditMemory.store,
      mongodbConfigured: Boolean(config.auditMemory.mongodbUri),
      database: config.auditMemory.mongodbUri ? config.auditMemory.mongodbDb : null,
      collection: config.auditMemory.mongodbUri ? config.auditMemory.mongodbCollection : null,
    },
    catalog: catalog
      ? { generatedAt: catalog.generatedAt, trials: catalog.trials.length }
      : null,
    paperclip,
    modal: modalStatus(),
    benchling: await checkBenchling().catch((err) => ({ configured: false, error: err.message })),
  };
}

export function startServer() {
  const app = createApp();
  return app.listen(config.port, config.host, () => {
    console.log(`fdaapproval listening on http://${config.host}:${config.port}`);
    if (config.host === '0.0.0.0') {
      // Reachable from the network, and there is no auth on these routes.
      for (const address of lanAddresses()) {
        console.log(`  http://${address}:${config.port}`);
      }
      console.log('  ! bound to all interfaces — no authentication on /api routes');
    }
    if (!config.paperclip.apiKey) console.warn('  ! PAPERCLIP_API_KEY is not set');
    if (!modelConfigured()) console.warn(`  ! ${config.model.provider === 'openai' ? 'MODEL_API_KEY or OPENAI_API_KEY' : 'MODEL_API_KEY or ANTHROPIC_API_KEY'} is not set`);
    console.log(
      config.runs.enabled
        ? `  runs: ${config.runs.perWindow} per ${Math.round(config.runs.windowMs / 60000)} min per address, ${config.runs.concurrent} concurrent`
        : '  runs: disabled (PUBLIC_RUNS=off) — cached reviews only',
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}

// Serverless hosts (Vercel's Express preset) import this module and invoke its
// default export per request. An Express app is already a (req, res) handler, so
// the app itself is the export; nothing here binds a port.
export default createApp();

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((nic) => nic && nic.family === 'IPv4' && !nic.internal)
    .map((nic) => nic.address);
}
