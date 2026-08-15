import express from 'express';
import { config, paths } from './config.js';
import { trialsRouter } from './routes/trials.js';
import { evaluateRouter } from './routes/evaluate.js';
import { loadCatalog } from './catalog/store.js';
import { checkConnection } from './paperclip/tools.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', trialsRouter);
app.use('/api', evaluateRouter);

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
    catalog: catalog
      ? { generatedAt: catalog.generatedAt, trials: catalog.trials.length }
      : null,
    paperclip,
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

app.listen(config.port, () => {
  console.log(`fdaapproval listening on http://localhost:${config.port}`);
  if (!config.paperclip.apiKey) console.warn('  ! PAPERCLIP_API_KEY is not set');
  if (!config.anthropic.apiKey) console.warn('  ! ANTHROPIC_API_KEY is not set');
});
