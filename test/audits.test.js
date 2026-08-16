import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createEvaluationAudit,
  finishEvaluationAudit,
  listEvaluationAudits,
  readEvaluationAudit,
  writeEvaluationAudit,
} from '../src/evaluate/audits.js';

const trial = {
  trialId: 'NCT00000007',
  therapeuticName: 'Memory-101',
  sponsor: 'Acme Bio',
  phase: 'Phase 2',
};

test('persists and lists run audit records', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdaapproval-audits-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const audit = createEvaluationAudit(trial, { force: true, traceMode: 'metadata' });
  finishEvaluationAudit(audit, {
    cached: false,
    trace: { traceId: 'trace-1', mode: 'metadata', status: 'completed' },
    evaluation: {
      review: {
        weightedRubricScore: 3.7,
        probabilityOfTrialSuccess: { pointEstimate: 42, low: 30, high: 55, confidence: 'medium' },
      },
      evidence: { sections: [{ key: 'registry' }] },
      meta: {
        evaluatedAt: '2026-08-16T00:00:00.000Z',
        usage: { input_tokens: 100, output_tokens: 20 },
        usageByStage: { rubricReview: { input_tokens: 60 } },
      },
    },
  });

  const ref = await writeEvaluationAudit(audit, { root });
  const restored = await readEvaluationAudit(trial.trialId, ref.auditId, { root });
  const listed = await listEvaluationAudits(trial.trialId, { root });

  assert.equal(ref.store, 'filesystem');
  assert.equal(restored.status, 'completed');
  assert.equal(restored.request.force, true);
  assert.ok(restored.pipeline.model.provider);
  assert.equal(listed[0].auditId, ref.auditId);
  assert.equal(listed[0].probabilityOfTrialSuccess.pointEstimate, 42);
  assert.equal(listed[0].trace.traceId, 'trace-1');
});
