// Routes backed by Modal.
//
// Both are opt-in and both cost GPU time, so they are guarded exactly like the
// review routes and never fire as a side effect of loading a panel. When Modal
// is not configured they answer 503 with the reason, and every caller has a
// defined behaviour for that — the construct panel keeps its derived schematic,
// the proof drawer keeps ending at the document.

import { Router } from 'express';
import { config, modalConfigured } from '../config.js';
import { getTrial } from '../catalog/store.js';
import { readEvaluation } from '../evaluate/store.js';
import { listRunTraces, readRunTrace } from '../evaluate/trace.js';
import { benchlingConfigured } from '../config.js';
import { findConstructFor } from '../benchling/client.js';
import { fromBenchling } from '../benchling/model.js';
import { ModalError } from '../modal/client.js';
import { foldSequence, groundClaim } from '../modal/tasks.js';
import { createConcurrencyGate, createRateLimiter } from '../utils/rate-limit.js';

export const modalRouter = Router();

/**
 * Grounding wants a language model and folding wants a structure predictor, so
 * a deployment can perfectly well have one and not the other. Each route checks
 * its own task rather than a global flag.
 */
const requireModal = (task) => (_req, res, next) => {
  if (modalConfigured(task)) return next();
  return res.status(503).json({
    error: 'modal_unconfigured',
    task,
    message:
      `Modal ${task} is not configured on this deployment. Set MODAL_${task.toUpperCase()}_URL ` +
      '(or MODAL_ENDPOINT_URL), MODAL_TOKEN_ID and MODAL_TOKEN_SECRET.',
  });
};

/** GPU work is charged by the second; treat it like the review routes. */
const guardModal = (task) => [
  requireModal(task),
  createRateLimiter({
    windowMs: config.runs.windowMs,
    max: config.runs.perWindow,
    message: 'Too many structure or grounding requests from this address.',
  }),
  createConcurrencyGate({ max: config.runs.concurrent, message: 'Modal is already busy with the maximum number of jobs.' }),
];

function reportModalError(res, err) {
  if (err instanceof ModalError) {
    return res.status(err.status >= 400 && err.status < 600 ? 502 : 502).json({
      error: 'modal_failed',
      message: err.message,
    });
  }
  return null;
}

/**
 * Fold the construct for one trial.
 *
 * A sequence is a precondition, not an inconvenience: the derived schematic has
 * no sequence, so there is nothing to fold, and the route says so rather than
 * folding something plausible and labelling it with the construct's name.
 */
modalRouter.post('/structure/:trialId/predict', guardModal('fold'), async (req, res, next) => {
  try {
    const trial = await getTrial(req.params.trialId);
    if (!trial) return res.status(404).json({ error: 'not_found', message: 'Unknown trial id.' });

    let sequence = '';
    let name = trial.therapeuticName;
    let unit = 'aa';

    if (benchlingConfigured()) {
      const match = await findConstructFor(trial.therapeuticName).catch(() => null);
      if (match) {
        const evaluation = await readEvaluation(trial.trialId).catch(() => null);
        const model = fromBenchling(match, trial, evaluation);
        sequence = model.sequence ?? '';
        name = model.name ?? name;
        unit = model.unit ?? unit;
      }
    }

    if (!sequence) {
      return res.status(422).json({
        error: 'no_sequence',
        message:
          'No real sequence is available for this programme, so there is nothing to fold. ' +
          'A predicted structure requires a Benchling-resolved construct; the derived schematic is architecture only.',
      });
    }

    const structure = await foldSequence({ sequence, name, unit });
    res.json({ trialId: trial.trialId, name, unit, structure });
  } catch (err) {
    if (reportModalError(res, err)) return;
    next(err);
  }
});

/**
 * Ground one claim to the exact passage that supports it.
 *
 * The passage text only exists where a full trace was captured — a cached review
 * keeps the retrieval metadata, not the source text. Where it was not retained
 * the route says so, which is the same answer the proof drawer already gives for
 * a chain link that does not exist.
 */
modalRouter.post('/ground/:trialId', guardModal('ground'), async (req, res, next) => {
  try {
    const trial = await getTrial(req.params.trialId);
    if (!trial) return res.status(404).json({ error: 'not_found', message: 'Unknown trial id.' });

    const claim = String(req.body?.claim ?? '').slice(0, 2000);
    if (!claim.trim()) return res.status(400).json({ error: 'bad_request', message: 'A claim is required.' });

    const domainId = req.body?.domainId ? String(req.body.domainId) : null;

    const traces = await listRunTraces(trial.trialId);
    const full = traces.find((entry) => entry.mode === 'full' && entry.status === 'completed');
    if (!full) {
      return res.status(409).json({
        error: 'no_retained_text',
        message:
          'This review did not retain its source text. Re-run it with Full trace enabled to ground claims to a passage.',
      });
    }

    const trace = await readRunTrace(trial.trialId, full.traceId);
    const sections = trace?.artifacts?.evidenceBundle?.sections ?? [];
    const passages = sections
      .filter((section) => section.text && (!domainId || section.domainId === domainId))
      .map((section) => ({ id: section.key, title: section.label, text: section.text }));

    if (!passages.length) {
      return res.status(409).json({
        error: 'no_retained_text',
        message: 'The retained trace holds no passage text for this claim.',
      });
    }

    const grounding = await groundClaim({ claim, passages });
    res.json({ trialId: trial.trialId, traceId: full.traceId, claim, ...grounding });
  } catch (err) {
    if (reportModalError(res, err)) return;
    next(err);
  }
});
