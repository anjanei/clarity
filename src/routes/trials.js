import { Router } from 'express';
import { facets, filterTrials, getTrial, loadCatalog } from '../catalog/store.js';
import { DIMENSIONS, RUBRIC_VERSION } from '../evaluate/rubric.js';

export const trialsRouter = Router();

trialsRouter.get('/trials', async (req, res, next) => {
  try {
    const catalog = await loadCatalog();
    if (!catalog) {
      return res.status(503).json({
        error: 'catalog_missing',
        message: 'No trial catalog yet. Run `npm run catalog` to build data/trials.json.',
      });
    }

    const { q, phase, sponsor, area, registry } = req.query;
    const trials = filterTrials(catalog.trials, { q, phase, sponsor, area, registry });

    res.json({
      generatedAt: catalog.generatedAt,
      total: catalog.trials.length,
      count: trials.length,
      facets: facets(catalog.trials),
      trials,
    });
  } catch (err) {
    next(err);
  }
});

trialsRouter.get('/trials/:trialId', async (req, res, next) => {
  try {
    const trial = await getTrial(req.params.trialId);
    if (!trial) return res.status(404).json({ error: 'not_found', message: 'Unknown trial id.' });
    res.json({ trial });
  } catch (err) {
    next(err);
  }
});

/** The rubric, so the frontend renders labels and weights from one source. */
trialsRouter.get('/rubric', (_req, res) => {
  res.json({
    version: RUBRIC_VERSION,
    dimensions: DIMENSIONS.map(({ id, label, weight, focus, anchors }) => ({
      id,
      label,
      weight,
      focus,
      anchors,
    })),
  });
});
