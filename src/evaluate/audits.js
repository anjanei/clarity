import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { EVIDENCE_DOSSIER_VERSION } from '../evidence/domains.js';
import { auditCollection, mongoAuditConfigured } from '../utils/mongodb.js';
import { RUBRIC_VERSION } from './rubric.js';

export const AUDIT_VERSION = '1.0.0';

const memoryAudits = new Map();
const READ_ONLY_FS = new Set(['EROFS', 'EACCES', 'EPERM']);

function stripMongoId(document) {
  if (!document) return null;
  const { _id, ...audit } = document;
  return audit;
}

function safeSegment(value, label) {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`Invalid ${label}.`);
  return cleaned;
}

function auditDirectory(trialId, root) {
  return path.join(root, safeSegment(trialId, 'trial id'));
}

function auditFilePath(trialId, auditId, root) {
  return path.join(auditDirectory(trialId, root), `${safeSegment(auditId, 'audit id')}.json`);
}

function isoNow() {
  return new Date().toISOString();
}

function trialSummary(trial) {
  return {
    trialId: trial.trialId,
    therapeuticName: trial.therapeuticName,
    sponsor: trial.sponsor ?? '',
    phase: trial.phase ?? '',
    therapeuticArea: trial.therapeuticArea ?? '',
    modality: trial.modality ?? '',
  };
}

function evaluationSummary(evaluation) {
  if (!evaluation) return null;
  const probability = evaluation.review?.probabilityOfTrialSuccess;
  return {
    evaluatedAt: evaluation.meta?.evaluatedAt ?? null,
    weightedRubricScore: evaluation.review?.weightedRubricScore ?? null,
    probabilityOfTrialSuccess: probability
      ? {
          pointEstimate: probability.pointEstimate ?? null,
          low: probability.low ?? null,
          high: probability.high ?? null,
          confidence: probability.confidence ?? null,
        }
      : null,
    evidenceSections: evaluation.evidence?.sections?.length ?? 0,
  };
}

export function createEvaluationAudit(trial, { force = false, traceMode = 'off' } = {}) {
  const startedAt = isoNow();
  return {
    version: AUDIT_VERSION,
    auditId: randomUUID(),
    status: 'running',
    startedAt,
    completedAt: null,
    durationMs: null,
    trial: trialSummary(trial),
    request: {
      force: Boolean(force),
      traceMode,
    },
    pipeline: {
      rubricVersion: RUBRIC_VERSION,
      evidenceDossierVersion: EVIDENCE_DOSSIER_VERSION,
      model: {
        provider: config.model.provider,
        name: config.model.name,
        evalEffort: config.model.evalEffort,
        extractEffort: config.model.extractEffort,
      },
      concurrency: {
        paperclip: config.evidence.paperclipConcurrency,
        domain: config.evidence.domainConcurrency,
      },
    },
    outcome: null,
    trace: null,
    error: null,
  };
}

export function finishEvaluationAudit(audit, { status = 'completed', cached = false, evaluation, trace, error } = {}) {
  if (!audit || audit.status !== 'running') return audit;
  audit.status = error ? 'error' : status;
  audit.completedAt = isoNow();
  audit.durationMs = Math.max(0, Date.parse(audit.completedAt) - Date.parse(audit.startedAt));
  audit.outcome = {
    cached: Boolean(cached),
    evaluation: evaluationSummary(evaluation),
    usage: evaluation?.meta?.usage ?? null,
    usageByStage: evaluation?.meta?.usageByStage ?? null,
  };
  audit.trace = trace ?? evaluation?.meta?.trace ?? null;
  if (error) audit.error = { name: error.name, message: error.message };
  return audit;
}

export async function writeEvaluationAudit(audit, { root = paths.audits } = {}) {
  if (!audit) return null;
  if (root === paths.audits && mongoAuditConfigured()) {
    try {
      const collection = await auditCollection();
      await collection.updateOne(
        { auditId: audit.auditId },
        { $set: audit, $setOnInsert: { _id: audit.auditId } },
        { upsert: true },
      );
      return {
        auditId: audit.auditId,
        status: audit.status,
        startedAt: audit.startedAt,
        completedAt: audit.completedAt,
        durationMs: audit.durationMs,
        store: 'mongodb',
      };
    } catch (err) {
      console.warn(`MongoDB audit write failed; falling back to local audit store: ${err.message}`);
    }
  }

  const file = auditFilePath(audit.trial.trialId, audit.auditId, root);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  } catch (err) {
    if (!READ_ONLY_FS.has(err.code)) throw err;
    const key = audit.trial.trialId.toLowerCase();
    const rows = memoryAudits.get(key) ?? [];
    memoryAudits.set(key, [audit, ...rows.filter((row) => row.auditId !== audit.auditId)]);
    console.warn(`Read-only filesystem: cached audit ${audit.auditId} in memory only (${err.code}).`);
    return {
      auditId: audit.auditId,
      status: audit.status,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt,
      durationMs: audit.durationMs,
      store: 'memory',
    };
  }
  return {
    auditId: audit.auditId,
    status: audit.status,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    durationMs: audit.durationMs,
    store: 'filesystem',
  };
}

export async function readEvaluationAudit(trialId, auditId, { root = paths.audits } = {}) {
  if (root === paths.audits && mongoAuditConfigured()) {
    try {
      const collection = await auditCollection();
      const audit = await collection.findOne({ auditId, 'trial.trialId': String(trialId) });
      if (audit) return stripMongoId(audit);
    } catch (err) {
      console.warn(`MongoDB audit read failed; checking local audit store: ${err.message}`);
    }
  }

  const key = String(trialId).toLowerCase();
  const cached = memoryAudits.get(key)?.find((audit) => audit.auditId === auditId);
  if (cached) return cached;
  try {
    return JSON.parse(await fs.readFile(auditFilePath(trialId, auditId, root), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function listEvaluationAudits(trialId, { root = paths.audits } = {}) {
  if (root === paths.audits && mongoAuditConfigured()) {
    try {
      const collection = await auditCollection();
      const audits = await collection
        .find({ 'trial.trialId': String(trialId) })
        .sort({ startedAt: -1 })
        .limit(200)
        .toArray();
      return auditSummaries(audits.map(stripMongoId));
    } catch (err) {
      console.warn(`MongoDB audit list failed; checking local audit store: ${err.message}`);
    }
  }

  const directory = auditDirectory(trialId, root);
  let audits = [];
  try {
    const files = await fs.readdir(directory);
    audits = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => readEvaluationAudit(trialId, file.slice(0, -'.json'.length), { root })),
    );
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const key = String(trialId).toLowerCase();
  const byId = new Map();
  for (const audit of [...audits.filter(Boolean), ...(memoryAudits.get(key) ?? [])]) {
    byId.set(audit.auditId, audit);
  }

  return auditSummaries([...byId.values()]);
}

function auditSummaries(audits) {
  return audits
    .filter(Boolean)
    .map((audit) => ({
      auditId: audit.auditId,
      status: audit.status,
      startedAt: audit.startedAt,
      completedAt: audit.completedAt ?? null,
      durationMs: audit.durationMs ?? null,
      cached: Boolean(audit.outcome?.cached),
      model: audit.pipeline?.model ?? null,
      trace: audit.trace ?? null,
      probabilityOfTrialSuccess: audit.outcome?.evaluation?.probabilityOfTrialSuccess ?? null,
      weightedRubricScore: audit.outcome?.evaluation?.weightedRubricScore ?? null,
      error: audit.error ?? null,
    }))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}
