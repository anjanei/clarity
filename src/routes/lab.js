// Routes backing the lab surface: the real pipeline topology, and gene models.
import { Router } from 'express';
import { getTrial } from '../catalog/store.js';
import { readEvaluation } from '../evaluate/store.js';
import { DIMENSIONS, RUBRIC_VERSION } from '../evaluate/rubric.js';
import {
  EVIDENCE_DOMAINS,
  EVIDENCE_DOSSIER_VERSION,
  activeDomainsForPhase,
  clarityPhaseLabel,
  normalizeClarityPhase,
  outputsForDomain,
} from '../evidence/domains.js';
import { benchlingConfigured, config } from '../config.js';
import { checkBenchling, findConstructFor } from '../benchling/client.js';
import { deriveConstruct, fromBenchling } from '../benchling/model.js';

export const labRouter = Router();

/**
 * The graph the frontend animates. Emitted from the same constants the pipeline
 * actually executes, so the picture cannot drift from the run.
 */
labRouter.get('/pipeline', (req, res) => {
  const phase = req.query.phase ? normalizeClarityPhase(req.query.phase) : null;
  const active = phase ? new Set(activeDomainsForPhase(phase).map((d) => d.id)) : null;

  res.json({
    dossierVersion: EVIDENCE_DOSSIER_VERSION,
    rubricVersion: RUBRIC_VERSION,
    phase,
    phaseLabel: phase ? clarityPhaseLabel(phase) : null,
    model: config.anthropic.model,
    concurrency: {
      paperclip: config.evidence.paperclipConcurrency,
      domain: config.evidence.domainConcurrency,
    },
    domains: EVIDENCE_DOMAINS.map((domain) => ({
      id: domain.id,
      label: domain.label,
      activeFrom: domain.activeFrom,
      active: active ? active.has(domain.id) : null,
      outputs: phase ? outputsForDomain(domain, phase) : [],
      searches: domain.searches.map((search) => ({
        key: search.key,
        label: search.label,
        scope: search.scope,
      })),
    })),
    rubric: DIMENSIONS.map(({ id, label, weight }) => ({ id, label, weight })),
  });
});

labRouter.get('/benchling/status', async (_req, res, next) => {
  try {
    res.json(await checkBenchling());
  } catch (err) {
    next(err);
  }
});

/**
 * A construct model for one trial. Benchling is consulted first when configured;
 * the modality-derived schematic is the labelled fallback, never a silent one.
 */
labRouter.get('/gene-model/:trialId', async (req, res, next) => {
  try {
    const trial = await getTrial(req.params.trialId);
    if (!trial) return res.status(404).json({ error: 'not_found', message: 'Unknown trial id.' });

    const evaluation = await readEvaluation(trial.trialId).catch(() => null);
    const lookup = { attempted: benchlingConfigured(), matched: false, error: null };

    if (benchlingConfigured()) {
      try {
        const match = await findConstructFor(trial.therapeuticName);
        if (match) {
          lookup.matched = true;
          return res.json({ trialId: trial.trialId, lookup, model: fromBenchling(match, trial, evaluation) });
        }
      } catch (err) {
        lookup.error = err.message;
      }
    }

    res.json({ trialId: trial.trialId, lookup, model: deriveConstruct(trial, evaluation) });
  } catch (err) {
    next(err);
  }
});
