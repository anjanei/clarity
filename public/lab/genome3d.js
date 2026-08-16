// The construct, in space.
//
// The 2D feature map is still the reference view — it is the one you can measure
// against. This is the same model turned through 90° and given depth, because a
// vector is a physical object and reading it as a flat bar hides that the guide,
// the payload and the ITRs sit at different turns of the same molecule.
//
// The honesty rule from the flat viewer carries over unchanged: bases are only
// ever drawn from a sequence the server actually returned. A derived model shows
// architecture — coloured spans along a backbone — and the panel says so. A
// protein construct is drawn as a single chain, not a double helix, because it
// is not one.

import {
  PALETTE,
  clamp,
  createStage,
  depthAlpha,
  disc,
  glow,
  label as drawLabel,
  oklch,
} from './engine3d.js';

const FEATURE_COLOR = {
  promoter: () => PALETTE.clipDeep,
  cds: () => PALETTE.claude,
  guide: () => PALETTE.bench,
  edit: () => PALETTE.stop,
  itr: () => (a = 1) => oklch(0.68, 0.14, 300, a),
  ltr: () => (a = 1) => oklch(0.68, 0.14, 300, a),
  utr: () => (a = 1) => oklch(0.72, 0.1, 210, a),
  cdr: () => PALETTE.gap,
  domain: () => (a = 1) => oklch(0.66, 0.09, 250, a),
  element: () => PALETTE.faint,
  terminator: () => (a = 1) => oklch(0.6, 0.08, 30, a),
  tag: () => (a = 1) => oklch(0.66, 0.06, 160, a),
};

const colorForFeature = (type) => (FEATURE_COLOR[String(type).toLowerCase()] ?? FEATURE_COLOR.domain)();

const BASE_COLOR = {
  A: (a = 1) => oklch(0.8, 0.16, 145, a),
  T: (a = 1) => oklch(0.78, 0.15, 25, a),
  U: (a = 1) => oklch(0.78, 0.15, 25, a),
  G: (a = 1) => oklch(0.82, 0.14, 80, a),
  C: (a = 1) => oklch(0.78, 0.14, 220, a),
  N: PALETTE.ghost,
};

const AXIS_LENGTH = 620;
const RADIUS = 76;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onSelect?: (feature: object|null) => void, onHover?: Function}} hooks
 */
export function createConstructViewer(canvas, hooks = {}) {
  let model = null;
  let samples = [];
  let hovered = null;
  let selected = null;

  /**
   * Precompute the backbone once per model. Doing this per frame would be fine
   * for one construct and wasteful for the several this panel switches between.
   */
  function build() {
    samples = [];
    if (!model) return;

    const length = Math.max(1, Number(model.length) || 1);
    const protein = String(model.unit).toLowerCase() === 'aa';
    const turns = protein ? 9 : 6.5;
    const steps = 320;
    const features = (model.features ?? []).filter(
      (feature) => Number.isFinite(feature.start) && Number.isFinite(feature.end) && feature.end > feature.start,
    );

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const position = t * length;
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * AXIS_LENGTH;
      const feature = features.find((f) => position >= f.start && position <= f.end) ?? null;
      samples.push({
        t,
        position,
        feature,
        a: { x: Math.cos(angle) * RADIUS, y, z: Math.sin(angle) * RADIUS },
        b: protein
          ? null
          : { x: Math.cos(angle + Math.PI) * RADIUS, y, z: Math.sin(angle + Math.PI) * RADIUS },
        base: model.sequence ? model.sequence[Math.floor(t * (model.sequence.length - 1))] : null,
      });
    }
  }

  function draw(ctx, frame) {
    if (!model || !samples.length) {
      drawLabel(ctx, 'No construct resolved', frame.width / 2, frame.height / 2, {
        size: 12,
        color: PALETTE.faint(),
        mono: true,
      });
      return;
    }

    const projected = samples.map((sample) => ({
      sample,
      a: frame.project(sample.a.x, sample.a.y, sample.a.z),
      b: sample.b ? frame.project(sample.b.x, sample.b.y, sample.b.z) : null,
    }));

    // Rungs sit behind the strands and are drawn first, thinning as they turn
    // away from the eye so the helix reads as a solid object.
    for (let i = 0; i < projected.length; i += 4) {
      const point = projected[i];
      if (!point.b || !point.a.visible || !point.b.visible) continue;
      const alpha = depthAlpha((point.a.depth + point.b.depth) / 2, 520, 2200) * 0.5;
      const base = point.sample.base ? String(point.sample.base).toUpperCase() : null;
      const color = base && BASE_COLOR[base] ? BASE_COLOR[base] : PALETTE.ghost;
      ctx.beginPath();
      ctx.moveTo(point.a.x, point.a.y);
      ctx.lineTo(point.b.x, point.b.y);
      ctx.strokeStyle = color(alpha * 0.7);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const strokeStrand = (key) => {
      for (let i = 1; i < projected.length; i += 1) {
        const previous = projected[i - 1];
        const current = projected[i];
        const p = previous[key];
        const c = current[key];
        if (!p || !c || !p.visible || !c.visible) continue;

        const feature = current.sample.feature;
        const active = feature && (feature === hovered || feature === selected);
        const color = feature ? colorForFeature(feature.type) : PALETTE.faint;
        const alpha = depthAlpha(c.depth, 520, 2200) * (feature ? 1 : 0.45) * (hovered && !active && feature ? 0.5 : 1);

        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(c.x, c.y);
        ctx.strokeStyle = color(alpha);
        ctx.lineWidth = (feature ? 3.2 : 1.6) * clamp(c.scale, 0.4, 1.6) * (active ? 1.6 : 1);
        ctx.lineCap = 'round';
        ctx.stroke();

        if (active) glow(ctx, c.x, c.y, 14 * clamp(c.scale, 0.4, 1.4), color, 0.5);
      }
    };

    strokeStrand('a');
    if (samples[0].b) strokeStrand('b');

    // One label per feature, at its midpoint, only while it faces the camera.
    const seen = new Set();
    for (const point of projected) {
      const feature = point.sample.feature;
      if (!feature || seen.has(feature)) continue;
      const mid = (feature.start + feature.end) / 2;
      if (Math.abs(point.sample.position - mid) > (feature.end - feature.start) / 12) continue;
      seen.add(feature);
      if (!point.a.visible) continue;
      const color = colorForFeature(feature.type);
      const alpha = depthAlpha(point.a.depth, 520, 2200);
      disc(ctx, point.a.x, point.a.y, 3.4 * clamp(point.a.scale, 0.5, 1.4), color(alpha));
      drawLabel(ctx, feature.name, point.a.x + 10, point.a.y - 8, {
        size: clamp(11 * point.a.scale, 9, 12),
        align: 'left',
        color: PALETTE.ink(),
        alpha: alpha * (feature === hovered || feature === selected ? 1 : 0.72),
        weight: feature === selected ? 600 : 500,
      });
      drawLabel(
        ctx,
        `${Math.round(feature.start).toLocaleString()}–${Math.round(feature.end).toLocaleString()} ${model.unit}`,
        point.a.x + 10,
        point.a.y + 4,
        { size: 9, align: 'left', color: color(0.85), alpha: alpha * 0.8, mono: true },
      );
    }

    // The axis: a scale bar you can actually read a coordinate off.
    const ends = [
      { value: 0, point: frame.project(0, -AXIS_LENGTH / 2 - 22, 0) },
      { value: model.length, point: frame.project(0, AXIS_LENGTH / 2 + 22, 0) },
    ];
    for (const end of ends) {
      if (!end.point.visible) continue;
      drawLabel(ctx, Number(end.value || 0).toLocaleString(), end.point.x, end.point.y, {
        size: 9,
        color: PALETTE.ghost(),
        mono: true,
      });
    }
  }

  function pick(px, py) {
    if (px < 0 || !samples.length) return null;
    let best = null;
    let bestDistance = 26;
    for (const sample of samples) {
      if (!sample.feature || !sample.screen?.visible) continue;
      const distance = Math.hypot(sample.screen.x - px, sample.screen.y - py);
      if (distance < bestDistance) {
        best = sample.feature;
        bestDistance = distance;
      }
    }
    return best;
  }

  const stage = createStage(canvas, {
    distance: 900,
    minDistance: 320,
    maxDistance: 2000,
    autoRotate: 0.16,
    pitch: 0,
    draw: (ctx, frame) => {
      // Cache projections for hit testing between frames.
      for (const sample of samples) sample.screen = frame.project(sample.a.x, sample.a.y, sample.a.z);
      draw(ctx, frame);
    },
    onPointerMove: (x, y) => {
      const feature = pick(x, y);
      if (feature !== hovered) {
        hovered = feature;
        canvas.style.cursor = feature ? 'pointer' : 'grab';
        hooks.onHover?.(feature);
      }
    },
    onClick: (x, y) => {
      selected = pick(x, y);
      hooks.onSelect?.(selected);
    },
  });

  if (!stage) return null;

  return {
    stage,
    setModel(next) {
      model = next ?? null;
      hovered = null;
      selected = null;
      build();
      stage.setDistance(String(model?.unit).toLowerCase() === 'aa' ? 820 : 940);
    },
    get selected() {
      return selected;
    },
    destroy() {
      stage.destroy();
    },
  };
}
