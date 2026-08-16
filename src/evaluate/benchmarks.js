// Cross-programme benchmarks, computed from the reviews on disk.
//
// A single probability is hard to read: 58% is only meaningful next to what this
// reviewer, on this rubric, has said about every other programme it has scored.
// Everything here is an aggregate of reviews that actually ran — there is no
// reference cohort, no industry prior and no imputation. Where n is small the
// payload says so, and the UI is expected to repeat it.

import fs from 'node:fs/promises';
import { paths } from '../config.js';
import { DIMENSIONS, RUBRIC_VERSION } from './rubric.js';

const CACHE_MS = 30_000;
let cache = { at: 0, payload: null };

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mean = (values) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const round = (value, places = 2) =>
  value == null ? null : Math.round(value * 10 ** places) / 10 ** places;

async function readEvaluations() {
  let files;
  try {
    files = await fs.readdir(paths.evaluations);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const parsed = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          return JSON.parse(await fs.readFile(`${paths.evaluations}/${file}`, 'utf8'));
        } catch {
          // A half-written or hand-edited review must not take the endpoint down.
          return null;
        }
      }),
  );
  return parsed.filter((evaluation) => evaluation?.review?.criteria?.length);
}

/** Aggregate every cached review into the distributions the lab plots against. */
export async function buildBenchmarks({ force = false } = {}) {
  if (!force && cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;

  const evaluations = await readEvaluations();
  const programmes = evaluations.map((evaluation) => ({
    trialId: evaluation.trial?.trialId ?? evaluation.review?.trialId ?? 'unknown',
    therapeuticName: evaluation.trial?.therapeuticName ?? evaluation.review?.therapeuticName ?? 'Unknown',
    phase: evaluation.trial?.phase ?? null,
    modality: evaluation.trial?.modality ?? null,
    therapeuticArea: evaluation.trial?.therapeuticArea ?? null,
    point: Number(evaluation.review?.probabilityOfTrialSuccess?.pointEstimate) || null,
    low: Number(evaluation.review?.probabilityOfTrialSuccess?.low) || null,
    high: Number(evaluation.review?.probabilityOfTrialSuccess?.high) || null,
    weightedRubricScore: Number(evaluation.review?.weightedRubricScore) || null,
    confidence: evaluation.review?.confidence?.level ?? null,
    evaluatedAt: evaluation.meta?.evaluatedAt ?? null,
    rubricVersion: evaluation.meta?.rubricVersion ?? null,
  }));

  const points = programmes.map((p) => p.point).filter((value) => Number.isFinite(value));

  const domains = DIMENSIONS.map((dimension) => {
    const scores = [];
    const strengths = { strong: 0, moderate: 0, weak: 0, absent: 0 };
    for (const evaluation of evaluations) {
      const criterion = evaluation.review.criteria.find((c) => c.id === dimension.id);
      if (!criterion) continue;
      if (Number.isFinite(Number(criterion.score))) scores.push(Number(criterion.score));
      if (criterion.evidenceStrength in strengths) strengths[criterion.evidenceStrength] += 1;
    }
    return {
      id: dimension.id,
      label: dimension.label,
      weight: dimension.weight,
      n: scores.length,
      mean: round(mean(scores)),
      median: round(median(scores)),
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      strengths,
    };
  });

  const confidence = { high: 0, moderate: 0, low: 0 };
  for (const programme of programmes) {
    if (programme.confidence in confidence) confidence[programme.confidence] += 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    rubricVersion: RUBRIC_VERSION,
    count: programmes.length,
    // Small-n is the normal state of this dataset, and the caller must say so
    // rather than plotting six points as if they were a distribution.
    sufficient: programmes.length >= 5,
    probability: {
      n: points.length,
      mean: round(mean(points), 1),
      median: round(median(points), 1),
      min: points.length ? Math.min(...points) : null,
      max: points.length ? Math.max(...points) : null,
    },
    programmes: programmes.sort((a, b) => (b.point ?? 0) - (a.point ?? 0)),
    domains,
    confidence,
  };

  cache = { at: Date.now(), payload };
  return payload;
}
