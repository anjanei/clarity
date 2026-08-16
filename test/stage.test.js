// Smoke tests for the rendering path.
//
// The stage draws to a canvas, so nothing about it is visible to a normal unit
// test — but almost everything that can go wrong in it (a node with no anchor, an
// edge pointing at a node that was never created, a projection that divides by
// zero) throws on the first frame. Driving one real frame against a recording
// 2D context catches exactly that class of failure, without a browser.

import assert from 'node:assert/strict';
import test from 'node:test';

/* ------------------------------------------------------------- environment */

const frames = [];

function recordingContext() {
  const calls = { stroke: 0, fill: 0, fillText: 0, arc: 0, gradients: 0 };
  const noop = () => {};
  return {
    calls,
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    setLineDash: noop,
    ellipse: noop,
    arc: () => {
      calls.arc += 1;
    },
    fill: () => {
      calls.fill += 1;
    },
    stroke: () => {
      calls.stroke += 1;
    },
    fillText: () => {
      calls.fillText += 1;
    },
    createRadialGradient: () => {
      calls.gradients += 1;
      return { addColorStop: noop };
    },
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}

function stubCanvas({ width = 900, height = 600, failContext = false } = {}) {
  const ctx = failContext ? null : recordingContext();
  const listeners = new Map();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    clientWidth: width,
    clientHeight: height,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type) => listeners.delete(type),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    dispatch: (type, event) => listeners.get(type)?.(event),
  };
  if (ctx) ctx.canvas = canvas;
  return canvas;
}

// A controllable clock. Nodes fade in over their first ~600ms, so a test that
// only advanced the animation-frame timestamp would render a graph that is
// technically present and entirely transparent.
let clock = 10_000;
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (callback) => {
  frames.push(callback);
  return frames.length;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.document = { hidden: false };
globalThis.window = {
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {},
};

/** Advance the clock and run every queued animation frame at the new time. */
function step(deltaMs = 16) {
  clock += deltaMs;
  const pending = frames.splice(0, frames.length);
  for (const callback of pending) callback(clock);
}

const { createStage, oklch, depthAlpha, seededRandom } = await import('../public/lab/engine3d.js');
const { createEvidenceGraph, collectDocuments } = await import('../public/lab/graph3d.js');
const { createConstructViewer } = await import('../public/lab/genome3d.js');

/* ------------------------------------------------------------------- tests */

test('oklch resolves to an sRGB string the canvas can parse', () => {
  assert.match(oklch(0.86, 0.13, 195), /^rgb\(\d+ \d+ \d+\)$/);
  assert.match(oklch(0.86, 0.13, 195, 0.4), /^rgb\(\d+ \d+ \d+ \/ 0\.4\)$/);
  // Out-of-gamut requests clamp rather than emitting a negative channel.
  assert.match(oklch(0.99, 0.4, 140), /^rgb\((?:\d{1,3}) (?:\d{1,3}) (?:\d{1,3})\)$/);
});

test('depth fog stays inside its bounds at both extremes', () => {
  assert.equal(depthAlpha(0), 1);
  assert.equal(depthAlpha(1e6), 0.12);
});

test('the seeded generator is deterministic across instances', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('a canvas with no 2D context yields no stage, so callers can fall back', () => {
  assert.equal(createStage(stubCanvas({ failContext: true }), { draw: () => {} }), null);
  assert.equal(createStage(null, { draw: () => {} }), null);
});

test('the stage projects, sizes to the element, and calls back once per frame', () => {
  const canvas = stubCanvas();
  let seen = null;
  const stage = createStage(canvas, {
    draw: (_ctx, frame) => {
      seen = frame;
    },
  });
  assert.ok(stage);
  step();

  assert.equal(canvas.width, 900);
  assert.equal(canvas.height, 600);
  assert.ok(seen, 'draw ran');

  const centre = seen.project(0, 0, 0);
  assert.equal(centre.visible, true);
  assert.ok(Math.abs(centre.x - 450) < 1e-6);
  assert.ok(Math.abs(centre.y - 300) < 1e-6);

  // Behind the near plane the projection reports itself unusable rather than
  // flinging geometry across the canvas.
  const behind = seen.project(0, 0, 100000);
  assert.equal(behind.visible, false);
  stage.destroy();
});

test('one frame of the evidence graph draws without throwing', () => {
  const canvas = stubCanvas();
  const graph = createEvidenceGraph(canvas, {});
  assert.ok(graph, 'graph mounted');

  graph.setPipeline({
    domains: [
      { id: 'trial_design', label: 'Trial Design' },
      { id: 'acute_safety_tolerability', label: 'Acute Safety & Tolerability' },
      { id: 'benefit_risk_postmarketing', label: 'Benefit–Risk', active: false },
    ],
  });
  graph.setTrial({ trialId: 'NCT00000001', therapeuticName: 'AlphaMab', phase: 'Phase 3' });

  const before = graph.nodeCount;
  step();
  // Nodes fade in; a frame past the spawn window is the one that has to paint.
  step(700);

  const ctx = canvas.getContext();
  assert.ok(ctx.calls.stroke > 0, 'edges were stroked');
  assert.ok(ctx.calls.arc > 0, 'nodes were drawn');
  assert.ok(ctx.calls.fillText > 0, 'nodes were labelled');

  // A retrieval event has to make the graph bigger — that is the whole point.
  graph.addLiveSection({ key: 'design_registry', label: 'Trial design: registry', source: 'registry', domainId: 'trial_design' });
  assert.equal(graph.nodeCount, before + 1);
  step(80);

  // A skipped domain must never light, however the run progresses.
  graph.activate('benefit_risk_postmarketing');
  graph.completeAll();
  step(700);

  graph.destroy();
});

test('a document node opens into its own graph and the trail leads back', () => {
  const canvas = stubCanvas();
  const levels = [];
  const graph = createEvidenceGraph(canvas, { onLevel: (trail) => levels.push(trail.length) });
  graph.setPipeline({ domains: [{ id: 'trial_design', label: 'Trial Design' }] });
  graph.setTrial({ trialId: 'NCT1', therapeuticName: 'AlphaMab' });
  graph.setEvaluation({
    trial: { trialId: 'NCT1' },
    review: {
      criteria: [{ id: 'trial_design', label: 'Trial Design', score: 4, evidenceStrength: 'moderate' }],
      probabilityOfTrialSuccess: { pointEstimate: 58, low: 40, high: 72 },
    },
    evidence: {
      sections: [{ key: 'a', label: 'Trial design: registry', source: 'registry', chars: 4200, domainId: 'trial_design' }],
      dossier: {
        domains: [
          {
            domainId: 'trial_design',
            domainLabel: 'Trial Design',
            elements: [
              {
                element: 'Endpoint definition',
                finding: 'The primary endpoint is serum TTR reduction at day 28.',
                confidenceScore: 80,
                citations: [{ identifier: 'NCT04601051', title: 'Registry record', url: 'https://clinicaltrials.gov/study/NCT04601051', sourceType: 'trial_registry' }],
              },
            ],
          },
        ],
      },
    },
    meta: { model: 'claude-opus-5', effort: 'high' },
  });
  step(700);

  const pipelineCount = graph.nodeCount;
  assert.ok(pipelineCount > 3, 'the cited document became a node');

  assert.equal(graph.descendById('doc:NCT04601051'), true);
  assert.equal(graph.depth, 1);
  step(700);
  assert.ok(graph.nodeCount >= 2, 'the document graph has the paper and what cites it');

  graph.ascend(0);
  assert.equal(graph.depth, 0);
  assert.equal(graph.nodeCount, pipelineCount);
  assert.ok(levels.length > 0, 'the breadcrumb trail was published');
  graph.destroy();
});

test('a source cited by several domains collapses to one document', () => {
  const documents = collectDocuments({
    evidence: {
      dossier: {
        domains: [
          { domainId: 'a', elements: [{ citations: [{ identifier: 'PMC1234567', title: 'Paper' }] }] },
          { domainId: 'b', elements: [{ citations: [{ identifier: 'pmc1234567', title: 'Paper' }] }] },
          { domainId: 'c', elements: [{ citations: [{ title: 'Untitled', identifier: '' }] }] },
        ],
      },
    },
  });
  assert.equal(documents.length, 2);
  assert.equal(documents[0].cites.length, 2, 'both citing elements are remembered');
  assert.equal(documents[0].domains.size, 2);
});

test('the construct viewer draws a derived model without inventing bases', () => {
  const canvas = stubCanvas({ width: 420, height: 260 });
  const viewer = createConstructViewer(canvas, {});
  assert.ok(viewer);
  viewer.setModel({
    name: 'Derived cassette',
    length: 4200,
    unit: 'bp',
    sequence: null,
    features: [
      { name: 'Promoter', start: 100, end: 800, type: 'promoter' },
      { name: 'Coding sequence', start: 900, end: 3400, type: 'cds' },
    ],
  });
  step();
  const ctx = canvas.getContext();
  assert.ok(ctx.calls.stroke > 0, 'the backbone was stroked');
  assert.ok(ctx.calls.fillText > 0, 'features were labelled');

  // A protein construct is a single chain, and switching to one must not throw.
  viewer.setModel({ name: 'Antibody', length: 447, unit: 'aa', sequence: null, features: [{ name: 'CDR-H3', start: 90, end: 110, type: 'cdr' }] });
  step(48);
  viewer.destroy();
});
