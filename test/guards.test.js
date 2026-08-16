import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdaapproval-guards-'));
process.env.DATA_DIR = dataDirectory;
process.env.PAPERCLIP_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
// The run guards are read once at import time, so they have to be set first.
process.env.PUBLIC_RUNS = 'off';

const { createApp } = await import('../src/server.js');
const { buildBenchmarks } = await import('../src/evaluate/benchmarks.js');
const { createConcurrencyGate, createRateLimiter } = await import('../src/utils/rate-limit.js');

const app = createApp();
const server = http.createServer(app);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const catalog = {
  generatedAt: '2026-08-15T00:00:00.000Z',
  trials: [
    {
      trialId: 'NCT00000001',
      therapeuticName: 'AlphaMab',
      sponsor: 'Acme Bio',
      phase: 'Phase 3',
      registry: 'ClinicalTrials.gov',
      condition: 'Lung cancer',
      modality: 'Monoclonal antibody',
      therapeuticArea: 'Oncology',
    },
  ],
};

await fs.writeFile(path.join(dataDirectory, 'trials.json'), JSON.stringify(catalog), 'utf8');
await fs.mkdir(path.join(dataDirectory, 'evaluations'), { recursive: true });

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('the paid run routes refuse to start when runs are switched off', async () => {
  for (const [method, pathname] of [
    ['GET', '/api/evaluations/NCT00000001/stream'],
    ['POST', '/api/evaluations/NCT00000001'],
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`, { method });
    assert.equal(response.status, 403, `${method} ${pathname}`);
    assert.equal((await response.json()).error, 'runs_disabled');
  }
});

test('reading a cached review is never gated by the run switch', async () => {
  const response = await fetch(`${baseUrl}/api/evaluations/NCT00000001`);
  // No review exists for this trial, but the refusal is "not evaluated" — not
  // "runs disabled". Reading must stay open however locked down runs are.
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'not_evaluated');
});

test('every response carries a content policy that forbids third-party code', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('health states the run policy so the lab can explain a disabled button', async () => {
  const body = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(body.runs.enabled, false);
  assert.equal(typeof body.runs.perWindow, 'number');
});

test('health is memoised, so it cannot be looped into an amplifier', async () => {
  // The route probes Paperclip and Benchling. It is public and unauthenticated,
  // so a loop over it would point this lab's traffic at two upstreams that are
  // not ours to hammer. Fifty concurrent callers must share one probe.
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => fetch(`${baseUrl}/api/health`).then((r) => r.json())),
  );
  assert.equal(responses.length, 50);
  const first = JSON.stringify(responses[0]);
  for (const body of responses) {
    assert.equal(JSON.stringify(body), first, 'every caller in the window gets the same payload');
  }
});

test('the rate limiter admits its quota then refuses with a retry hint', () => {
  const limit = createRateLimiter({ windowMs: 60_000, max: 2 });
  const call = () => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (key, value) => {
        headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json: (body) => ({ body }),
    };
    let passed = false;
    limit({ headers: {}, ip: '203.0.113.9', socket: {} }, res, () => {
      passed = true;
    });
    return { passed, statusCode: res.statusCode, headers };
  };

  assert.equal(call().passed, true);
  assert.equal(call().passed, true);
  const blocked = call();
  assert.equal(blocked.passed, false);
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
});

test('a hung-up stream releases its concurrency slot', () => {
  const gate = createConcurrencyGate({ max: 1 });
  const listeners = new Map();
  const makeRes = () => ({
    setHeader() {},
    status() {
      return this;
    },
    json: (body) => body,
    on(event, handler) {
      listeners.set(event, handler);
    },
  });

  let firstPassed = false;
  gate({ headers: {}, socket: {} }, makeRes(), () => {
    firstPassed = true;
  });
  assert.equal(firstPassed, true);

  let secondPassed = false;
  gate({ headers: {}, socket: {} }, makeRes(), () => {
    secondPassed = true;
  });
  assert.equal(secondPassed, false, 'the second run is refused while the first holds the slot');

  // The client disconnects mid-stream; the slot must come back.
  listeners.get('close')?.();

  let thirdPassed = false;
  gate({ headers: {}, socket: {} }, makeRes(), () => {
    thirdPassed = true;
  });
  assert.equal(thirdPassed, true);
});

test('benchmarks report an empty, honest payload before any review exists', async () => {
  const payload = await buildBenchmarks({ force: true });
  assert.equal(payload.count, 0);
  assert.equal(payload.sufficient, false);
  assert.equal(payload.probability.n, 0);
  assert.equal(payload.domains.length > 0, true, 'every rubric dimension is still listed');
  assert.equal(payload.domains[0].mean, null, 'an unscored dimension has no mean, not a zero');
});

test('benchmarks aggregate the reviews on disk and ignore unreadable ones', async () => {
  const review = (id, score, point) => ({
    trial: { trialId: id, therapeuticName: `Drug ${id}`, phase: 'Phase 1' },
    review: {
      probabilityOfTrialSuccess: { pointEstimate: point, low: point - 10, high: point + 10 },
      confidence: { level: 'moderate' },
      criteria: [{ id: 'safety', score, evidenceStrength: 'moderate' }],
      weightedRubricScore: score,
    },
    meta: { rubricVersion: '2.0.0' },
  });

  const evaluations = path.join(dataDirectory, 'evaluations');
  await fs.writeFile(path.join(evaluations, 'a.json'), JSON.stringify(review('NCT1', 2, 30)), 'utf8');
  await fs.writeFile(path.join(evaluations, 'b.json'), JSON.stringify(review('NCT2', 4, 70)), 'utf8');
  await fs.writeFile(path.join(evaluations, 'broken.json'), '{ not json', 'utf8');

  const payload = await buildBenchmarks({ force: true });
  assert.equal(payload.count, 2, 'the unparseable file is skipped, not fatal');
  assert.equal(payload.probability.median, 50);
  const safety = payload.domains.find((domain) => domain.id === 'safety');
  assert.equal(safety.n, 2);
  assert.equal(safety.mean, 3);
  assert.deepEqual([safety.min, safety.max], [2, 4]);
});
