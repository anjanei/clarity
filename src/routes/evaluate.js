import { Router } from 'express';
import { getTrial } from '../catalog/store.js';
import { readEvaluation, runEvaluation } from '../evaluate/store.js';
import { listRunTraces, normalizeTraceMode, readRunTrace } from '../evaluate/trace.js';

export const evaluateRouter = Router();

async function requireTrial(req, res) {
  const trial = await getTrial(req.params.trialId);
  if (!trial) {
    res.status(404).json({ error: 'not_found', message: 'Unknown trial id.' });
    return null;
  }
  return trial;
}

function requestedTraceMode(req) {
  const requested = String(req.query.trace || '').toLowerCase();
  return ['metadata', 'full'].includes(requested) ? normalizeTraceMode(requested) : undefined;
}

/** Cached review only — never triggers a run. */
evaluateRouter.get('/evaluations/:trialId', async (req, res, next) => {
  try {
    const evaluation = await readEvaluation(req.params.trialId);
    if (!evaluation) {
      return res.status(404).json({ error: 'not_evaluated', message: 'No review cached for this trial.' });
    }
    res.json({ ...evaluation, cached: true });
  } catch (err) {
    next(err);
  }
});

/** Trace indexes and files are intentionally separate from the cached review. */
evaluateRouter.get('/evaluations/:trialId/traces', async (req, res, next) => {
  try {
    const trial = await requireTrial(req, res);
    if (!trial) return;
    res.json({ trialId: trial.trialId, traces: await listRunTraces(trial.trialId) });
  } catch (err) {
    next(err);
  }
});

evaluateRouter.get('/evaluations/:trialId/traces/:traceId', async (req, res, next) => {
  try {
    const trial = await requireTrial(req, res);
    if (!trial) return;
    const trace = await readRunTrace(trial.trialId, req.params.traceId);
    if (!trace) return res.status(404).json({ error: 'not_found', message: 'Unknown evaluation trace.' });
    res.json(trace);
  } catch (err) {
    next(err);
  }
});

/** Blocking run. Reviews take minutes — prefer the SSE route for UI. */
evaluateRouter.post('/evaluations/:trialId', async (req, res, next) => {
  try {
    const trial = await requireTrial(req, res);
    if (!trial) return;
    const evaluation = await runEvaluation(trial, {
      force: req.query.force === '1',
      traceMode: requestedTraceMode(req),
    });
    res.json(evaluation);
  } catch (err) {
    next(err);
  }
});

/** Progress-streaming run: `progress` events, then one `result` or `error`. */
evaluateRouter.get('/evaluations/:trialId/stream', async (req, res, next) => {
  try {
    const trial = await requireTrial(req, res);
    if (!trial) return;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    let open = true;
    const send = (event, data) => {
      if (!open) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Proxies drop idle connections; a review can run for minutes.
    const heartbeat = setInterval(() => open && res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => {
      open = false;
      clearInterval(heartbeat);
    });

    send('progress', { stage: 'start', message: `Reviewing ${trial.therapeuticName}` });

    try {
      const evaluation = await runEvaluation(trial, {
        force: req.query.force === '1',
        traceMode: requestedTraceMode(req),
        onStep: (step) => send('progress', step),
      });
      send('result', evaluation);
    } catch (err) {
      send('error', { message: err.message, name: err.name });
    } finally {
      clearInterval(heartbeat);
      if (open) res.end();
    }
  } catch (err) {
    next(err);
  }
});
