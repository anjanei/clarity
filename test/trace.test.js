import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  captureTraceArtifact,
  createRunTrace,
  finishRunTrace,
  listRunTraces,
  readRunTrace,
  recordModelCall,
  recordPaperclipCall,
  traceEvent,
  writeRunTrace,
} from '../src/evaluate/trace.js';

const trial = { trialId: 'NCT01234567', therapeuticName: 'Trace-101', phase: 'Phase 3' };

test('persists a complete learning trace with public inputs and outputs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdaapproval-trace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const trace = createRunTrace(trial, { mode: 'full' });
  traceEvent(trace, 'evidence_started');
  recordPaperclipCall(trace, {
    operation: 'search', status: 'ok', command: 'search "Trace-101" /trials/us', resultChars: 12,
    rawText: 'NCT01234567', startedAt: trace.startedAt, completedAt: trace.startedAt, durationMs: 7,
  });
  recordModelCall(trace, {
    label: 'dossier.trial_design', status: 'ok', model: 'test-model', effort: 'low', maxTokens: 100,
    system: ['shared policy', 'domain skill'], userContent: 'public evidence', schema: { type: 'object' },
    responseText: '{"ok":true}', usage: { input_tokens: 7, output_tokens: 3 },
    startedAt: trace.startedAt, completedAt: trace.startedAt, durationMs: 9,
  });
  captureTraceArtifact(trace, 'evidenceBundle', { sections: [{ text: 'public result' }] }, { sections: 1 });
  finishRunTrace(trace);

  const ref = await writeRunTrace(trace, { root });
  const restored = await readRunTrace(trial.trialId, ref.traceId, { root });
  const listed = await listRunTraces(trial.trialId, { root });

  assert.equal(restored.status, 'completed');
  assert.equal(restored.paperclipCalls[0].rawText, 'NCT01234567');
  assert.equal(restored.modelCalls[0].userContent, 'public evidence');
  assert.equal(restored.artifacts.evidenceBundle.sections[0].text, 'public result');
  assert.equal(listed[0].traceId, ref.traceId);
});

test('metadata traces retain cost diagnostics but omit complete prompts and source text', () => {
  const trace = createRunTrace(trial, { mode: 'metadata' });
  recordPaperclipCall(trace, { operation: 'search', rawText: 'do not retain', resultChars: 13 });
  recordModelCall(trace, {
    label: 'review', system: 'system prompt', userContent: 'evidence', schema: { type: 'object' },
    responseText: 'result', usage: { input_tokens: 2 },
  });
  captureTraceArtifact(trace, 'bundle', { raw: 'do not retain' }, { sections: 3 });

  assert.equal(trace.paperclipCalls[0].rawText, undefined);
  assert.equal(trace.modelCalls[0].userContent, undefined);
  assert.equal(trace.modelCalls[0].userContentChars, 8);
  assert.deepEqual(trace.artifacts.bundle, { sections: 3 });
});
