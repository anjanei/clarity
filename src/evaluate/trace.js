import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../config.js';

export const TRACE_VERSION = '1.0.0';
export const TRACE_MODES = ['off', 'metadata', 'full'];

function safeSegment(value, label) {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`Invalid ${label}.`);
  return cleaned;
}

export function normalizeTraceMode(value, fallback = 'off') {
  const fallbackMode = String(fallback ?? 'off').trim().toLowerCase();
  const safeFallback = TRACE_MODES.includes(fallbackMode) ? fallbackMode : 'off';
  const mode = String(value ?? safeFallback).trim().toLowerCase();
  return TRACE_MODES.includes(mode) ? mode : safeFallback;
}

function isoNow() {
  return new Date().toISOString();
}

function elapsedMs(trace) {
  return Math.max(0, Date.now() - trace.startedAtMs);
}

/** Create an auditable evaluation trace. Full traces include public prompts and evidence. */
export function createRunTrace(trial, { mode = 'off' } = {}) {
  const normalizedMode = normalizeTraceMode(mode);
  if (normalizedMode === 'off') return null;

  const startedAt = isoNow();
  const trace = {
    version: TRACE_VERSION,
    traceId: randomUUID(),
    mode: normalizedMode,
    status: 'running',
    startedAt,
    startedAtMs: Date.now(),
    trial: { ...trial },
    events: [],
    stages: [],
    paperclipCalls: [],
    modelCalls: [],
    artifacts: {},
  };
  traceEvent(trace, 'run_started');
  return trace;
}

export function traceEvent(trace, name, details = {}) {
  if (!trace) return;
  trace.events.push({ name, at: isoNow(), elapsedMs: elapsedMs(trace), ...details });
}

export async function traceStage(trace, name, operation, details = {}) {
  if (!trace) return operation();
  const startedAt = isoNow();
  const started = Date.now();
  traceEvent(trace, 'stage_started', { stage: name, ...details });
  try {
    const result = await operation();
    const entry = {
      name,
      status: 'ok',
      startedAt,
      completedAt: isoNow(),
      durationMs: Date.now() - started,
      ...details,
    };
    trace.stages.push(entry);
    traceEvent(trace, 'stage_completed', { stage: name, durationMs: entry.durationMs });
    return result;
  } catch (err) {
    const entry = {
      name,
      status: 'error',
      startedAt,
      completedAt: isoNow(),
      durationMs: Date.now() - started,
      error: { name: err.name, message: err.message },
      ...details,
    };
    trace.stages.push(entry);
    traceEvent(trace, 'stage_failed', { stage: name, durationMs: entry.durationMs, error: entry.error });
    throw err;
  }
}

export function recordPaperclipCall(trace, call) {
  if (!trace) return;
  const { rawText, structured, ...metadata } = call;
  const entry = { ...metadata };
  if (trace.mode === 'full') {
    entry.rawText = rawText ?? '';
    if (structured != null) entry.structured = structured;
  }
  trace.paperclipCalls.push(entry);
}

export function recordModelCall(trace, call) {
  if (!trace) return;
  const { system, userContent, schema, responseText, ...metadata } = call;
  const entry = {
    ...metadata,
    systemChars: Array.isArray(system)
      ? system.reduce((total, block) => total + String(block?.text ?? block ?? '').length, 0)
      : String(system ?? '').length,
    userContentChars: String(userContent ?? '').length,
    schemaChars: JSON.stringify(schema ?? {}).length,
    responseChars: String(responseText ?? '').length,
  };
  if (trace.mode === 'full') {
    entry.system = system;
    entry.userContent = userContent;
    entry.schema = schema;
    entry.responseText = responseText ?? '';
  }
  trace.modelCalls.push(entry);
}

export function captureTraceArtifact(trace, name, artifact, summary = {}) {
  if (!trace) return;
  trace.artifacts[name] = trace.mode === 'full' ? artifact : summary;
}

export function finishRunTrace(trace, { error } = {}) {
  if (!trace || trace.status !== 'running') return trace;
  trace.status = error ? 'error' : 'completed';
  trace.completedAt = isoNow();
  trace.durationMs = elapsedMs(trace);
  if (error) trace.error = { name: error.name, message: error.message };
  traceEvent(trace, 'run_completed', { status: trace.status, durationMs: trace.durationMs });
  delete trace.startedAtMs;
  return trace;
}

function traceFilePath(trialId, traceId, root) {
  return path.join(root, safeSegment(trialId, 'trial id'), `${safeSegment(traceId, 'trace id')}.json`);
}

export async function writeRunTrace(trace, { root = paths.traces } = {}) {
  if (!trace) return null;
  const file = traceFilePath(trace.trial.trialId, trace.traceId, root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return {
    traceId: trace.traceId,
    mode: trace.mode,
    status: trace.status,
    capturedAt: trace.completedAt ?? trace.startedAt,
  };
}

export async function readRunTrace(trialId, traceId, { root = paths.traces } = {}) {
  try {
    return JSON.parse(await fs.readFile(traceFilePath(trialId, traceId, root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function listRunTraces(trialId, { root = paths.traces } = {}) {
  const directory = path.join(root, safeSegment(trialId, 'trial id'));
  try {
    const files = await fs.readdir(directory);
    const traces = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          const trace = await readRunTrace(trialId, file.slice(0, -'.json'.length), { root });
          return trace
            ? {
                traceId: trace.traceId,
                mode: trace.mode,
                status: trace.status,
                startedAt: trace.startedAt,
                completedAt: trace.completedAt ?? null,
                durationMs: trace.durationMs ?? null,
              }
            : null;
        }),
    );
    return traces.filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}
