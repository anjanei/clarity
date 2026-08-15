import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { evaluateTrial } from './evaluate.js';

/** Registry IDs are alphanumeric with dashes; anything else is not a real ID. */
function safeName(trialId) {
  const cleaned = String(trialId).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`Invalid trial id: ${trialId}`);
  }
  return `${cleaned}.json`;
}

function filePath(trialId) {
  return path.join(paths.evaluations, safeName(trialId));
}

export async function readEvaluation(trialId) {
  try {
    return JSON.parse(await fs.readFile(filePath(trialId), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeEvaluation(trialId, evaluation) {
  await fs.mkdir(paths.evaluations, { recursive: true });
  await fs.writeFile(filePath(trialId), `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
}

const inFlight = new Map();

/**
 * Run (or join) an evaluation for one trial. Concurrent callers share a single
 * run so a double-click does not pay for two reviews; `onStep` is fanned out to
 * every listener.
 */
export function runEvaluation(trial, { onStep, force = false } = {}) {
  const key = trial.trialId.toLowerCase();
  const existing = inFlight.get(key);

  if (existing) {
    if (onStep) existing.listeners.add(onStep);
    return existing.promise;
  }

  const listeners = new Set(onStep ? [onStep] : []);
  const emit = (step) => {
    for (const listener of listeners) {
      try {
        listener(step);
      } catch {
        // a disconnected SSE client must not fail the run
      }
    }
  };

  const promise = (async () => {
    if (!force) {
      const cached = await readEvaluation(trial.trialId);
      if (cached) {
        emit({ stage: 'cache', message: 'Returning cached review' });
        return { ...cached, cached: true };
      }
    }
    const evaluation = await evaluateTrial(trial, { onStep: emit });
    await writeEvaluation(trial.trialId, evaluation);
    return { ...evaluation, cached: false };
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, { promise, listeners });
  return promise;
}
