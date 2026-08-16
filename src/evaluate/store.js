import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';
import { EVIDENCE_DOSSIER_VERSION } from '../evidence/domains.js';
import { evaluateTrial } from './evaluate.js';
import { config } from '../config.js';
import {
  createRunTrace,
  finishRunTrace,
  normalizeTraceMode,
  traceEvent,
  writeRunTrace,
} from './trace.js';

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

// Serverless hosts (Vercel) mount the bundle read-only, so a completed review
// cannot be persisted next to the ones committed to the repo. Losing the review
// the caller just paid minutes for is the worse failure, so writes fall back to
// a process-lifetime cache: warm invocations still serve it, cold ones re-run.
const memoryCache = new Map();
const READ_ONLY_FS = new Set(['EROFS', 'EACCES', 'EPERM']);

export async function readEvaluation(trialId) {
  const cached = memoryCache.get(String(trialId).toLowerCase());
  if (cached) return cached;
  try {
    return JSON.parse(await fs.readFile(filePath(trialId), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeEvaluation(trialId, evaluation) {
  try {
    await fs.mkdir(paths.evaluations, { recursive: true });
    await fs.writeFile(filePath(trialId), `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');
  } catch (err) {
    if (!READ_ONLY_FS.has(err.code)) throw err;
    memoryCache.set(String(trialId).toLowerCase(), evaluation);
    console.warn(`Read-only filesystem: cached ${trialId} in memory only (${err.code}).`);
  }
}

const inFlight = new Map();

/**
 * Run (or join) an evaluation for one trial. Concurrent callers share a single
 * run so a double-click does not pay for two reviews; `onStep` is fanned out to
 * every listener.
 */
export function runEvaluation(trial, { onStep, force = false, traceMode } = {}) {
  const mode = normalizeTraceMode(traceMode, config.trace.mode);
  // A full trace is intentionally independent from a normal in-flight run: it
  // must not silently join a run that was not retaining prompts and artifacts.
  const key = `${trial.trialId.toLowerCase()}:${mode === 'full' ? 'full' : 'standard'}`;
  const existing = inFlight.get(key);

  if (existing) {
    if (onStep) existing.listeners.add(onStep);
    return existing.promise;
  }

  const listeners = new Set(onStep ? [onStep] : []);
  const trace = createRunTrace(trial, { mode });
  const emit = (step) => {
    traceEvent(trace, 'progress', step);
    for (const listener of listeners) {
      try {
        listener(step);
      } catch {
        // a disconnected SSE client must not fail the run
      }
    }
  };

  const completeTrace = async (error) => {
    if (!trace) return null;
    finishRunTrace(trace, { error });
    try {
      return await writeRunTrace(trace);
    } catch (traceError) {
      console.error('Unable to persist evaluation trace:', traceError);
      return { mode: trace.mode, status: 'write_error', error: traceError.message };
    }
  };

  const promise = (async () => {
    try {
      if (!force) {
        const cached = await readEvaluation(trial.trialId);
        if (cached?.meta?.evidenceDossierVersion === EVIDENCE_DOSSIER_VERSION) {
          emit({ stage: 'cache', message: 'Returning cached review' });
          traceEvent(trace, 'cache_hit');
          const traceRef = await completeTrace();
          return {
            ...cached,
            meta: traceRef ? { ...cached.meta, trace: traceRef } : cached.meta,
            cached: true,
          };
        }
      }
      const evaluation = await evaluateTrial(trial, { onStep: emit, trace });
      const traceRef = await completeTrace();
      if (traceRef) evaluation.meta.trace = traceRef;
      await writeEvaluation(trial.trialId, evaluation);
      return { ...evaluation, cached: false };
    } catch (err) {
      await completeTrace(err);
      throw err;
    }
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, { promise, listeners });
  return promise;
}
