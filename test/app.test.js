import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdaapproval-test-'));
process.env.DATA_DIR = dataDirectory;
process.env.PAPERCLIP_API_KEY = '';
process.env.MODEL_PROVIDER = 'anthropic';
process.env.MODEL_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.AUDIT_STORE = '';
process.env.MONGODB_URI = '';

const { createApp } = await import('../src/server.js');
const app = createApp();
const server = http.createServer(app);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { response, body: await response.json().catch(() => null) };
}

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('reports a usable health response without external-service keys', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.deepEqual(body.keys, { paperclip: false, model: false });
  assert.equal(body.auditMemory.store, 'filesystem');
  assert.equal(body.catalog, null);
});

test('reports a missing catalog clearly', async () => {
  const { response, body } = await request('/api/trials');
  assert.equal(response.status, 503);
  assert.equal(body.error, 'catalog_missing');
});

test('serves the frontend and API routes from an isolated catalog', async () => {
  const catalog = {
    generatedAt: '2026-08-15T00:00:00.000Z',
    trials: [
      {
        trialId: 'NCT00000001', therapeuticName: 'AlphaMab', sponsor: 'Acme Bio', phase: 'Phase 3',
        startDate: '2025-02-01', registry: 'ClinicalTrials.gov', condition: 'Lung cancer',
        modality: 'Monoclonal antibody', title: 'AlphaMab study', therapeuticArea: 'Oncology',
      },
      {
        trialId: 'NCT00000002', therapeuticName: 'BetaGene', sponsor: 'Beta Labs', phase: 'Phase 1',
        startDate: '2024-01-01', registry: 'ClinicalTrials.gov', condition: 'Rare disease',
        modality: 'Gene therapy', title: 'BetaGene study', therapeuticArea: 'Rare disease',
      },
    ],
  };
  await fs.writeFile(path.join(dataDirectory, 'trials.json'), JSON.stringify(catalog));

  const trials = await request('/api/trials?q=alpha&phase=Phase%203&area=Oncology');
  assert.equal(trials.response.status, 200);
  assert.equal(trials.body.count, 1);
  assert.equal(trials.body.trials[0].trialId, 'NCT00000001');
  assert.deepEqual(trials.body.facets.phases, ['Phase 1', 'Phase 3']);

  const rubric = await request('/api/rubric');
  assert.equal(rubric.response.status, 200);
  assert.equal(rubric.body.dimensions.length, 10);

  const traces = await request('/api/evaluations/NCT00000001/traces');
  assert.equal(traces.response.status, 200);
  assert.deepEqual(traces.body, { trialId: 'NCT00000001', traces: [] });

  const audits = await request('/api/evaluations/NCT00000001/audits');
  assert.equal(audits.response.status, 200);
  assert.deepEqual(audits.body, { trialId: 'NCT00000001', audits: [] });

  const missingTrace = await request('/api/evaluations/NCT00000001/traces/not-a-trace');
  assert.equal(missingTrace.response.status, 404);
  assert.equal(missingTrace.body.error, 'not_found');

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /FDA Approval Review/);

  const client = await fetch(`${baseUrl}/app.js`);
  assert.equal(client.status, 200);
  assert.match(await client.text(), /runReview/);

  const stylesheet = await fetch(`${baseUrl}/dist/app.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(await stylesheet.text(), /@layer|--color/);
});

test('returns expected errors for unknown API resources', async () => {
  const trial = await request('/api/trials/NCT99999999');
  assert.equal(trial.response.status, 404);
  assert.equal(trial.body.error, 'not_found');

  const route = await request('/api/not-a-route');
  assert.equal(route.response.status, 404);
  assert.equal(route.body.error, 'not_found');
});
