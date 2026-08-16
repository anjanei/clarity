import { structuredCall } from '../anthropic.js';
import { synthesizeEvidenceDossier, renderEvidenceDossier } from '../evidence/dossier.js';
import { EVIDENCE_DOSSIER_VERSION } from '../evidence/domains.js';
import { gatherEvidence } from '../paperclip/queries.js';
import { reviewSchema } from './schema.js';
import { DIMENSIONS, RUBRIC_VERSION, renderRubric, weightedScore } from './rubric.js';
import { config } from '../config.js';

/**
 * Stable across every trial, so it sits behind the cache breakpoint and is
 * billed at cache-read rates after the first review.
 */
const SYSTEM_PROMPT = [
  `You are a senior FDA review-team lead assembling an integrated assessment of an investigational
therapeutic. You have the perspective of a division that has issued both approvals and complete
response letters, and you are asked for a calibrated judgment, not an advocacy document.

You are given: (1) the registry record for one clinical trial, and (2) an evidence bundle retrieved
from clinical trial registries, FDA/EMA/PMDA review documents, and the primary literature.

How to reason:

- Ground every claim in the supplied evidence. When you rely on general knowledge of the modality
  or therapeutic class rather than program-specific data, say so explicitly and mark the relevant
  evidenceStrength as "weak" or "absent".
- Do not manufacture numbers. If the evidence does not report an ADA incidence, a discontinuation
  rate, or a hazard ratio, record that as an information gap rather than estimating one.
- Absence of evidence is not evidence of safety. A dimension with no program-specific data is
  uncharacterised risk: cap that score at 3 and set evidenceStrength to "absent".
- Distinguish what the sponsor has shown from what the sponsor asserts.
- Weigh the modality. Immunogenicity risk for an AAV gene therapy, a bispecific antibody and a
  small molecule are not comparable; neither is CMC risk for an autologous cell product versus a
  tablet. Score against what is achievable and expected for this modality.
- Account for the phase. A Phase 1 program is judged on whether it can credibly advance, not on
  whether it has already demonstrated efficacy.

Calibrating the probability:

- The question is the probability that this program successfully completes its clinical trial
  program to the point of supporting an approvable submission — not the probability of commercial
  success, and not the probability that this single trial reads out on time.
- Anchor on historical phase-transition base rates for the phase, modality and therapeutic area,
  then adjust for what the evidence shows. State the anchor and each adjustment in "basis".
- Resist optimism. Most Phase 1 and Phase 2 programs do not reach approval; a confident estimate
  above the base rate needs specific evidence behind it.
- Your confidence level describes how well the evidence supports any estimate, and is independent
  of whether the estimate is high or low.

Write in the register of a review memo: direct, specific, and readable by a colleague who has not
seen the file. Lead with conclusions. Every score must be defensible from what you were given.`,
  `# Scoring rubric (version ${RUBRIC_VERSION})\n\n${renderRubric()}`,
].join('\n\n');

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Enforce the bounds the JSON-schema layer cannot express. */
function normalizeReview(review) {
  const prob = review.probabilityOfTrialSuccess || {};
  let point = clampInt(prob.pointEstimate, 0, 100, 50);
  let low = clampInt(prob.low, 0, 100, Math.max(0, point - 15));
  let high = clampInt(prob.high, 0, 100, Math.min(100, point + 15));
  if (low > high) [low, high] = [high, low];
  point = Math.min(high, Math.max(low, point));

  const byId = new Map((review.criteria || []).map((c) => [c.id, c]));
  const criteria = DIMENSIONS.map((dimension) => {
    const found = byId.get(dimension.id);
    if (!found) {
      return {
        id: dimension.id,
        score: 3,
        evidenceStrength: 'absent',
        assessment: 'Not assessed — the model returned no entry for this dimension.',
        supportingFindings: [],
        concerns: [],
        informationGaps: ['Dimension missing from the generated review.'],
        label: dimension.label,
        weight: dimension.weight,
        missing: true,
      };
    }
    let score = clampInt(found.score, 1, 5, 3);
    // The prompt asks for this cap; enforce it so the UI never shows an
    // unsupported high score on a dimension with no evidence behind it.
    if (found.evidenceStrength === 'absent' && score > 3) score = 3;
    return { ...found, score, label: dimension.label, weight: dimension.weight };
  });

  return {
    ...review,
    criteria,
    probabilityOfTrialSuccess: { ...prob, pointEstimate: point, low, high },
    weightedRubricScore: weightedScore(criteria),
  };
}

/**
 * Full pipeline for one trial: retrieve evidence from Paperclip, then score it
 * with Claude against the rubric.
 */
export async function evaluateTrial(trial, { onStep, deepRead = true } = {}) {
  onStep?.({ stage: 'evidence', message: 'Retrieving evidence from Paperclip' });
  const bundle = await gatherEvidence(trial, {
    deepRead,
    onStep: (step) =>
      onStep?.({ stage: 'evidence', message: `${step.label} — ${step.source}` }),
  });

  if (!bundle.stats.sectionsWithContent) {
    throw new Error(
      'Paperclip returned no evidence for this therapeutic. Check PAPERCLIP_API_KEY and ' +
        'run `npm run probe` to confirm the search tool is reachable.',
    );
  }

  onStep?.({
    stage: 'dossier',
    message: `Organizing ${bundle.stats.sectionsWithContent} evidence sections into the CLARITY dossier`,
  });
  const dossier = await synthesizeEvidenceDossier(trial, bundle, { onStep });

  onStep?.({
    stage: 'review',
    message: `Scoring the cited ${dossier.domains.filter((domain) => domain.status === 'evaluated').length}-domain dossier against the rubric`,
  });

  const userContent = [
    '# Trial under review',
    '',
    '```json',
    JSON.stringify(trial, null, 2),
    '```',
    '',
    '# Evidence dossier',
    '',
    renderEvidenceDossier(dossier),
    '',
    '# Task',
    '',
    `Produce the integrated review for ${trial.therapeuticName} (${trial.trialId}). Score every ` +
      'rubric dimension, then give the calibrated probability that this program successfully ' +
      'completes clinical trials, with your reasoning for the anchor and each adjustment.',
  ].join('\n');

  const { data, usage, model } = await structuredCall({
    system: SYSTEM_PROMPT,
    userContent,
    schema: reviewSchema,
    effort: config.anthropic.evalEffort,
    maxTokens: 32000,
  });

  const review = normalizeReview(data);

  return {
    trial,
    review,
    evidence: {
      gatheredAt: bundle.gatheredAt,
      stats: bundle.stats,
      sections: bundle.sections.map(({ key, label, source, query, error, text }) => ({
        key,
        label,
        source,
        query,
        error: error ?? null,
        chars: text?.length ?? 0,
      })),
      dossier,
    },
    meta: {
      rubricVersion: RUBRIC_VERSION,
      evidenceDossierVersion: EVIDENCE_DOSSIER_VERSION,
      model,
      effort: config.anthropic.evalEffort,
      usage,
      evaluatedAt: new Date().toISOString(),
    },
  };
}
