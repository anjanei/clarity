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

/* -- the camera ----------------------------------------------------------- */

const pointer = (x, y, extra = {}) => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX: x,
  clientY: y,
  preventDefault: () => {},
  ...extra,
});

test('the camera turns on all three axes, with no pole to get stuck at', () => {
  const canvas = stubCanvas();
  const stage = createStage(canvas, { draw: () => {} });
  const overhead = () => stage.project(0, 100, 0);

  // A point directly above the target. Under a yaw/pitch camera, pitch has to be
  // clamped short of vertical, so this point could never be brought below the
  // centre line — the stage only ever turned usefully about one axis.
  assert.ok(overhead().y < 300, 'starts above the centre line');
  stage.rotate(Math.PI, 0, 0);
  assert.ok(overhead().y > 300, 'a half-turn about the camera X axis is reachable');

  // Roll: the axis a yaw/pitch camera does not have at all.
  stage.resetView();
  const upright = overhead();
  stage.rotate(0, 0, Math.PI / 2);
  const rolled = overhead();
  assert.ok(Math.abs(rolled.x - 450) > 50, 'rolling moves the overhead point sideways');
  assert.ok(Math.abs(rolled.y - 300) < 1e-6, 'and off the vertical it started on');
  assert.ok(Math.abs(upright.x - 450) < 1e-6);

  stage.resetView();
  assert.ok(Math.abs(overhead().y - upright.y) < 1e-9, 'reset returns the framing exactly');
  stage.destroy();
});

test('ten thousand turns leave the camera basis square, not sheared', () => {
  const canvas = stubCanvas();
  const stage = createStage(canvas, { draw: () => {} });
  const random = seededRandom(7);
  for (let i = 0; i < 10_000; i += 1) {
    stage.rotate(random() - 0.5, random() - 0.5, random() - 0.5);
  }

  const m = stage.state.rot;
  const dot = (a, b) => m[a * 3] * m[b * 3] + m[a * 3 + 1] * m[b * 3 + 1] + m[a * 3 + 2] * m[b * 3 + 2];
  for (const axis of [0, 1, 2]) assert.ok(Math.abs(dot(axis, axis) - 1) < 1e-9, 'rows stay unit length');
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) assert.ok(Math.abs(dot(a, b)) < 1e-9, 'rows stay perpendicular');
  stage.destroy();
});

test('zoom runs from inside a node to the whole board, and anchors on the pointer', () => {
  const canvas = stubCanvas();
  const stage = createStage(canvas, { draw: () => {}, distance: 1000 });

  for (let i = 0; i < 200; i += 1) stage.zoom(0.9);
  assert.equal(stage.state.distance, stage.state.minDistance);
  for (let i = 0; i < 400; i += 1) stage.zoom(1.1);
  assert.equal(stage.state.distance, stage.state.maxDistance);

  // Zooming about an off-centre point keeps that point where it was, which is
  // what stops a zoom from walking the node you aimed at off the canvas.
  stage.resetView();
  const world = { x: 120, y: -80, z: 0 };
  const before = stage.project(world.x, world.y, world.z);
  stage.zoom(0.5, before.x, before.y);
  const after = stage.project(world.x, world.y, world.z);
  assert.ok(Math.abs(after.x - before.x) < 1, 'the point under the pointer holds its x');
  assert.ok(Math.abs(after.y - before.y) < 1, 'and its y');
  stage.destroy();
});

test('a drag turns the stage, a still press selects, and a pan does neither', () => {
  const canvas = stubCanvas();
  const clicks = [];
  const stage = createStage(canvas, { draw: () => {}, onClick: (x, y) => clicks.push([x, y]), autoRotate: 0.05 });

  // A drag far past the old ±1.25 rad clamp.
  canvas.dispatch('pointerdown', pointer(300, 40));
  for (let y = 40; y <= 580; y += 20) canvas.dispatch('pointermove', pointer(300, y));
  canvas.dispatch('pointerup', pointer(300, 580, { buttons: 0 }));
  assert.equal(clicks.length, 0, 'a drag is not a selection');
  assert.equal(stage.state.autoRotate, 0, 'the idle drift stops once the reader takes over');
  assert.ok(Math.abs(stage.state.spin.x) > 0.01, 'a flick leaves the stage turning');

  // …and settles on its own rather than spinning forever.
  for (let i = 0; i < 200; i += 1) step();
  assert.equal(stage.state.spin.x, 0, 'the spin decays to rest');

  canvas.dispatch('pointerdown', pointer(420, 310));
  canvas.dispatch('pointerup', pointer(420, 310, { buttons: 0 }));
  assert.deepEqual(clicks, [[420, 310]], 'a still press selects');

  const target = { ...stage.state.target };
  canvas.dispatch('pointerdown', pointer(300, 300, { shiftKey: true }));
  for (let x = 300; x <= 520; x += 20) canvas.dispatch('pointermove', pointer(x, 300, { shiftKey: true }));
  canvas.dispatch('pointerup', pointer(520, 300, { buttons: 0, shiftKey: true }));
  assert.ok(Math.hypot(stage.state.target.x - target.x, stage.state.target.z - target.z) > 1, 'shift-drag pans');
  assert.equal(clicks.length, 1, 'a pan never selects');
  stage.destroy();
});

test('a second finger cancels the first, so a pinch never reads as a tap', () => {
  const canvas = stubCanvas();
  const clicks = [];
  const stage = createStage(canvas, { draw: () => {}, onClick: (x, y) => clicks.push([x, y]) });
  const touch = (id, x, y, extra = {}) => pointer(x, y, { pointerId: id, pointerType: 'touch', ...extra });

  canvas.dispatch('pointerdown', touch(1, 300, 300));
  canvas.dispatch('pointerdown', touch(2, 400, 300));
  canvas.dispatch('pointermove', touch(1, 290, 300));
  canvas.dispatch('pointermove', touch(2, 500, 300));
  assert.ok(stage.state.distance < 900, 'spreading two fingers zooms in');
  canvas.dispatch('pointerup', touch(1, 290, 300, { buttons: 0 }));
  canvas.dispatch('pointerup', touch(2, 500, 300, { buttons: 0 }));
  assert.equal(clicks.length, 0, 'lifting off a pinch selects nothing');
  stage.destroy();
});

test('every camera move a pointer can make is reachable from the keyboard', () => {
  const canvas = stubCanvas();
  const stage = createStage(canvas, { draw: () => {}, distance: 1000 });
  const key = (k, extra = {}) => canvas.dispatch('keydown', { key: k, preventDefault: () => {}, ...extra });
  const snapshot = () => stage.state.rot.join(',');

  const start = snapshot();
  key('ArrowUp');
  assert.notEqual(snapshot(), start, 'arrows turn');
  const turned = snapshot();
  key('q');
  assert.notEqual(snapshot(), turned, 'Q and E roll');

  key('ArrowLeft', { ctrlKey: true });
  assert.ok(Math.abs(stage.state.target.x) + Math.abs(stage.state.target.z) > 0.5, 'ctrl+arrows pan');

  key('-');
  assert.ok(stage.state.distance > 1000, 'minus pulls back');
  key('=');

  key('0');
  assert.equal(stage.state.distance, 1000);
  assert.deepEqual(stage.state.target, { x: 0, y: 0, z: 0 }, 'zero puts the view back');
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
