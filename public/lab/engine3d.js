// A small, dependency-free 3D stage rendered onto a 2D canvas.
//
// Everything the lab draws in space — the evidence graph, the construct helix —
// goes through here. It is deliberately not a general engine: it does perspective
// projection, painter's-algorithm depth sorting, additive glow and orbit input,
// and nothing else. That fits in a few hundred lines, ships no third-party code
// to the browser, and degrades honestly: if a 2D context cannot be acquired the
// caller is told so and falls back to the flat SVG topology it already had.
//
// Colour lives here too. The stylesheet states the palette in oklch; duplicating
// those values as hex would let the canvas drift away from the DOM the moment
// either changed, so the same oklch triples are converted to sRGB at runtime.

/* ------------------------------------------------------------------ colour */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** oklch → sRGB. The canvas cannot be trusted to parse oklch() everywhere yet. */
export function oklch(L, C, hDeg, alpha = 1) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const [r, g, bb] = lin.map((v) => {
    const c = clamp01(v);
    const encoded = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(clamp01(encoded) * 255);
  });

  return alpha >= 1 ? `rgb(${r} ${g} ${bb})` : `rgb(${r} ${g} ${bb} / ${alpha})`;
}

/** The lab palette, mirroring the tokens declared in app.css. */
export const PALETTE = {
  clip: (a = 1) => oklch(0.86, 0.13, 195, a),
  clipDeep: (a = 1) => oklch(0.7, 0.13, 195, a),
  claude: (a = 1) => oklch(0.82, 0.13, 45, a),
  claudeDeep: (a = 1) => oklch(0.68, 0.15, 42, a),
  bench: (a = 1) => oklch(0.88, 0.16, 140, a),
  benchDeep: (a = 1) => oklch(0.7, 0.16, 142, a),
  stop: (a = 1) => oklch(0.68, 0.19, 22, a),
  gap: (a = 1) => oklch(0.82, 0.15, 78, a),
  ok: (a = 1) => oklch(0.78, 0.15, 155, a),
  ink: (a = 1) => oklch(0.97, 0.004, 250, a),
  muted: (a = 1) => oklch(0.68, 0.014, 250, a),
  faint: (a = 1) => oklch(0.54, 0.014, 250, a),
  ghost: (a = 1) => oklch(0.42, 0.012, 250, a),
  void: (a = 1) => oklch(0.13, 0.012, 250, a),
};

export const AGENT_COLOR = {
  clip: PALETTE.clip,
  claude: PALETTE.claude,
  bench: PALETTE.bench,
  sys: PALETTE.faint,
  doc: PALETTE.clipDeep,
  risk: PALETTE.stop,
};

/* -------------------------------------------------------------- small maths */

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
export const easeOut = (t) => 1 - (1 - t) ** 3;

/** Deterministic PRNG: layouts must not reshuffle between renders of one run. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* -------------------------------------------------------------------- stage */

/**
 * @typedef {Object} StageOptions
 * @property {(ctx: CanvasRenderingContext2D, frame: object) => void} draw
 * @property {(x: number, y: number) => void} [onPointerMove]  screen-space, CSS pixels
 * @property {(x: number, y: number, event: PointerEvent) => void} [onClick]
 * @property {(x: number, y: number, event: PointerEvent) => void} [onDoubleClick]
 * @property {number} [distance] initial camera distance
 * @property {number} [autoRotate] radians per second while nobody is dragging
 * @property {boolean} [orbit] allow drag-to-orbit
 */

/**
 * Mount a stage on a canvas. Returns null when no 2D context can be acquired —
 * the caller is expected to render its fallback rather than a blank rectangle.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {StageOptions} options
 */
export function createStage(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;

  let ctx = null;
  try {
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  } catch {
    ctx = null;
  }
  if (!ctx) return null;

  const reduced = prefersReducedMotion();

  const state = {
    width: 1,
    height: 1,
    dpr: 1,
    yaw: options.yaw ?? -0.5,
    pitch: options.pitch ?? -0.22,
    distance: options.distance ?? 900,
    minDistance: options.minDistance ?? 260,
    maxDistance: options.maxDistance ?? 3200,
    focal: options.focal ?? 780,
    target: { x: 0, y: 0, z: 0 },
    autoRotate: reduced ? 0 : options.autoRotate ?? 0.05,
    orbit: options.orbit !== false,
    running: false,
    visible: true,
    dragging: false,
    pointer: { x: -1, y: -1, inside: false },
    time: 0,
  };

  let raf = 0;
  let last = 0;
  let disposed = false;

  /* -- sizing ------------------------------------------------------------- */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    // Retina is lovely and expensive; 2× is the point of diminishing returns.
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (width === state.width && height === state.height && dpr === state.dpr) return;
    state.width = width;
    state.height = height;
    state.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  // A stage scrolled out of view keeps its state but stops burning frames.
  let intersection = null;
  if (typeof IntersectionObserver === 'function') {
    intersection = new IntersectionObserver(
      (entries) => {
        state.visible = entries.some((entry) => entry.isIntersecting);
      },
      { rootMargin: '120px' },
    );
    intersection.observe(canvas);
  }

  /* -- projection --------------------------------------------------------- */

  const view = { sin: { yaw: 0, pitch: 0 }, cos: { yaw: 1, pitch: 1 } };

  function syncView() {
    view.sin.yaw = Math.sin(state.yaw);
    view.cos.yaw = Math.cos(state.yaw);
    view.sin.pitch = Math.sin(state.pitch);
    view.cos.pitch = Math.cos(state.pitch);
  }

  /**
   * World → screen. `depth` is distance from the eye, used for sorting, fog and
   * scale. `visible` is false behind the near plane, where the projection would
   * otherwise fling geometry across the canvas.
   */
  function project(x, y, z) {
    const dx = x - state.target.x;
    const dy = y - state.target.y;
    const dz = z - state.target.z;

    const x1 = dx * view.cos.yaw + dz * view.sin.yaw;
    const z1 = dz * view.cos.yaw - dx * view.sin.yaw;
    const y2 = dy * view.cos.pitch - z1 * view.sin.pitch;
    const z2 = dy * view.sin.pitch + z1 * view.cos.pitch;

    const depth = state.distance - z2;
    if (depth < 40) return { x: 0, y: 0, scale: 0, depth, visible: false };

    const scale = state.focal / depth;
    return {
      x: state.width / 2 + x1 * scale,
      y: state.height / 2 - y2 * scale,
      scale,
      depth,
      visible: true,
    };
  }

  /* -- input -------------------------------------------------------------- */

  const pointerPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  let dragStart = null;
  let moved = 0;
  const pinch = new Map();
  let pinchDistance = 0;

  function onPointerDown(event) {
    pinch.set(event.pointerId, pointerPos(event));
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (!state.orbit) return;
    const point = pointerPos(event);
    dragStart = { ...point, yaw: state.yaw, pitch: state.pitch };
    moved = 0;
    state.dragging = true;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
  }

  function onPointerMove(event) {
    const point = pointerPos(event);
    state.pointer = { ...point, inside: true };

    if (pinch.has(event.pointerId)) pinch.set(event.pointerId, point);
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const next = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance > 0 && next > 0) {
        state.distance = clamp(
          state.distance * (pinchDistance / next),
          state.minDistance,
          state.maxDistance,
        );
      }
      pinchDistance = next;
      return;
    }

    if (dragStart) {
      const dx = point.x - dragStart.x;
      const dy = point.y - dragStart.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      state.yaw = dragStart.yaw + dx * 0.006;
      state.pitch = clamp(dragStart.pitch + dy * 0.005, -1.25, 1.25);
    } else {
      options.onPointerMove?.(point.x, point.y);
    }
  }

  function endDrag(event) {
    pinch.delete(event.pointerId);
    if (pinch.size < 2) pinchDistance = 0;
    if (!dragStart) return;
    const point = pointerPos(event);
    const wasClick = moved < 5;
    dragStart = null;
    state.dragging = false;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (wasClick) options.onClick?.(point.x, point.y, event);
  }

  function onPointerLeave() {
    state.pointer = { x: -1, y: -1, inside: false };
    options.onPointerMove?.(-1, -1);
  }

  function onWheel(event) {
    if (!state.orbit) return;
    event.preventDefault();
    const step = Math.exp(clamp(event.deltaY, -120, 120) * 0.0016);
    state.distance = clamp(state.distance * step, state.minDistance, state.maxDistance);
  }

  function onDoubleClick(event) {
    const point = pointerPos(event);
    options.onDoubleClick?.(point.x, point.y, event);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);

  /* -- keyboard ------------------------------------------------------------
     The stage is focusable so the graph is reachable without a pointer. */
  function onKeyDown(event) {
    const step = event.shiftKey ? 0.28 : 0.1;
    if (event.key === 'ArrowLeft') state.yaw -= step;
    else if (event.key === 'ArrowRight') state.yaw += step;
    else if (event.key === 'ArrowUp') state.pitch = clamp(state.pitch - step, -1.25, 1.25);
    else if (event.key === 'ArrowDown') state.pitch = clamp(state.pitch + step, -1.25, 1.25);
    else if (event.key === '+' || event.key === '=') state.distance = clamp(state.distance * 0.88, state.minDistance, state.maxDistance);
    else if (event.key === '-') state.distance = clamp(state.distance * 1.14, state.minDistance, state.maxDistance);
    else return;
    event.preventDefault();
  }
  canvas.addEventListener('keydown', onKeyDown);

  /* -- loop --------------------------------------------------------------- */

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (!state.visible || document.hidden) {
      last = now;
      return;
    }

    // A tab restored after minutes must not integrate one enormous timestep.
    const dt = clamp((now - (last || now)) / 1000, 0, 0.05);
    last = now;
    state.time += dt;

    resize();
    if (!state.dragging && state.autoRotate) state.yaw += state.autoRotate * dt;
    syncView();

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    try {
      options.draw?.(ctx, {
        dt,
        time: state.time,
        width: state.width,
        height: state.height,
        project,
        pointer: state.pointer,
        dragging: state.dragging,
        distance: state.distance,
        reduced,
      });
    } catch (error) {
      // One bad frame must not kill the loop and leave a frozen canvas.
      if (!frame.warned) {
        console.error('stage draw failed', error);
        frame.warned = true;
      }
    }
  }

  function start() {
    if (state.running || disposed) return;
    state.running = true;
    resize();
    syncView();
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function destroy() {
    disposed = true;
    state.running = false;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    intersection?.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDoubleClick);
    canvas.removeEventListener('keydown', onKeyDown);
  }

  resize();
  syncView();
  start();

  return {
    ctx,
    state,
    project,
    start,
    destroy,
    resize,
    reduced,
    get size() {
      return { width: state.width, height: state.height };
    },
    setTarget(x, y, z) {
      state.target.x = x;
      state.target.y = y;
      state.target.z = z;
    },
    /** Ease the camera toward a target rather than snapping to it. */
    driftTarget(x, y, z, t = 0.08) {
      state.target.x = lerp(state.target.x, x, t);
      state.target.y = lerp(state.target.y, y, t);
      state.target.z = lerp(state.target.z, z, t);
    },
    setDistance(value) {
      state.distance = clamp(value, state.minDistance, state.maxDistance);
    },
    driftDistance(value, t = 0.08) {
      state.distance = lerp(state.distance, clamp(value, state.minDistance, state.maxDistance), t);
    },
    setAutoRotate(value) {
      state.autoRotate = reduced ? 0 : value;
    },
  };
}

/* --------------------------------------------------------------- primitives */

/** Additive bloom. Cheap enough to use per node; expensive enough not to spam. */
export function glow(ctx, x, y, radius, color, alpha = 1) {
  if (!(radius > 0.4) || alpha <= 0.01) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color(0.55 * alpha));
  gradient.addColorStop(0.45, color(0.16 * alpha));
  gradient.addColorStop(1, color(0));
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

export function disc(ctx, x, y, radius, fill, stroke, lineWidth = 1) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** A rounded rectangle that works without Path2D.roundRect support. */
export function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Fog by depth: far geometry loses contrast instead of vanishing abruptly. */
export function depthAlpha(depth, near = 420, far = 2400) {
  return clamp(1 - (depth - near) / (far - near), 0.12, 1);
}

export function label(ctx, text, x, y, { size = 11, color = PALETTE.ink(), align = 'center', weight = 500, mono = false, alpha = 1 } = {}) {
  if (alpha <= 0.04 || !text) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${mono ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", sans-serif'}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
