import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, paths } from './config.js';
import { trialsRouter } from './routes/trials.js';
import { evaluateRouter } from './routes/evaluate.js';
import { labRouter } from './routes/lab.js';
import { loadCatalog } from './catalog/store.js';
import { checkConnection } from './paperclip/tools.js';
import { checkBenchling } from './benchling/client.js';

/**
 * Response headers every route gets. The page loads no third-party code and
 * makes no cross-origin requests, so the policy can be as tight as "self" plus
 * inline styles — the report renders inline `style` attributes for meter widths
 * and heat fills, but never an inline script.
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

  app.get('/api/health', async (_req, res) => {
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

    res.json({
      ok: Boolean(config.paperclip.apiKey && config.anthropic.apiKey && catalog),
      keys: {
        paperclip: Boolean(config.paperclip.apiKey),
        anthropic: Boolean(config.anthropic.apiKey),
      },
      model: config.anthropic.model,
      effort: config.anthropic.evalEffort,
      runs: {
        enabled: config.runs.enabled,
        perWindow: config.runs.perWindow,
        windowMinutes: Math.round(config.runs.windowMs / 60000),
        concurrent: config.runs.concurrent,
      },
      catalog: catalog
        ? { generatedAt: catalog.generatedAt, trials: catalog.trials.length }
        : null,
      paperclip,
      benchling: await checkBenchling().catch((err) => ({ configured: false, error: err.message })),
    });
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
    if (!config.anthropic.apiKey) console.warn('  ! ANTHROPIC_API_KEY is not set');
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
