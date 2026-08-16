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

/**
 * The canvas has no cascade, so the theme has to be carried explicitly. The two
 * palettes mirror the tokens in app.css: same hues, re-tuned lightness, because
 * a colour that reads as a bright signal on near-black disappears on white.
 */
export const theme = { mode: 'dark' };

export function setStageTheme(mode) {
  theme.mode = mode === 'light' ? 'light' : 'dark';
}

const pick = (dark, light) => (a = 1) =>
  theme.mode === 'light' ? oklch(light[0], light[1], light[2], a) : oklch(dark[0], dark[1], dark[2], a);

/** The lab palette, mirroring the tokens declared in app.css. */
export const PALETTE = {
  clip: pick([0.86, 0.13, 195], [0.56, 0.13, 205]),
  clipDeep: pick([0.7, 0.13, 195], [0.48, 0.12, 202]),
  claude: pick([0.82, 0.13, 45], [0.58, 0.16, 40]),
  claudeDeep: pick([0.68, 0.15, 42], [0.5, 0.16, 38]),
  bench: pick([0.88, 0.16, 140], [0.52, 0.15, 148]),
  benchDeep: pick([0.7, 0.16, 142], [0.45, 0.14, 148]),
  // Source classes, so a paper, a registry record and an FDA review read apart
  // on the board without anyone having to open them.
  lit: pick([0.78, 0.12, 288], [0.5, 0.15, 288]),
  reg: pick([0.84, 0.14, 78], [0.55, 0.14, 68]),
  stop: pick([0.68, 0.19, 22], [0.53, 0.2, 26]),
  gap: pick([0.82, 0.15, 78], [0.58, 0.14, 68]),
  ok: pick([0.78, 0.15, 155], [0.52, 0.14, 155]),
  ink: pick([0.97, 0.004, 250], [0.24, 0.02, 258]),
  muted: pick([0.68, 0.014, 250], [0.42, 0.02, 258]),
  faint: pick([0.54, 0.014, 250], [0.54, 0.018, 258]),
  ghost: pick([0.42, 0.012, 250], [0.66, 0.014, 258]),
  void: pick([0.13, 0.012, 250], [0.99, 0.002, 250]),
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

/* ------------------------------------------------------------- orientation */

/**
 * The camera's orientation is a 3×3 rotation matrix, world → camera, not a pair
 * of Euler angles.
 *
 * Euler angles gimbal-lock: at the poles the two axes collapse onto each other,
 * so every implementation clamps pitch short of vertical and the stage ends up
 * turning usefully about one axis only. A matrix has no poles. It also carries
 * roll for free, which is the third axis a molecule viewer actually wants.
 *
 * Rows are the camera basis expressed in world space: row 0 is right, row 1 is
 * up, row 2 points back toward the eye.
 */

/** Row-major 3×3 product. `mul3(a, b)` applies b first, then a. */
function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

const rotX = (a) => { const s = Math.sin(a); const c = Math.cos(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = (a) => { const s = Math.sin(a); const c = Math.cos(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = (a) => { const s = Math.sin(a); const c = Math.cos(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

/** Callers still state an opening view as yaw/pitch; this is the seed matrix. */
const rotationFromEuler = (yaw, pitch) => mul3(rotX(pitch), rotY(yaw));

/**
 * Thousands of incremental rotations accumulate floating-point error, and a
 * basis that is no longer orthonormal shears the whole scene. Gram–Schmidt puts
 * the three rows back on the unit sphere at right angles, every frame.
 */
function orthonormalize(m) {
  const nx = Math.hypot(m[0], m[1], m[2]) || 1;
  const x = [m[0] / nx, m[1] / nx, m[2] / nx];
  const dot = m[3] * x[0] + m[4] * x[1] + m[5] * x[2];
  const yRaw = [m[3] - dot * x[0], m[4] - dot * x[1], m[5] - dot * x[2]];
  const ny = Math.hypot(yRaw[0], yRaw[1], yRaw[2]) || 1;
  const y = [yRaw[0] / ny, yRaw[1] / ny, yRaw[2] / ny];
  const z = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

/* -------------------------------------------------------------------- stage */

/** Geometry closer to the eye than this is behind the lens, not in front of it. */
const NEAR_PLANE = 12;

/**
 * @typedef {Object} StageOptions
 * @property {(ctx: CanvasRenderingContext2D, frame: object) => void} draw
 * @property {(x: number, y: number) => void} [onPointerMove]  screen-space, CSS pixels
 * @property {(x: number, y: number, event: PointerEvent) => void} [onClick]
 * @property {(x: number, y: number, event: PointerEvent) => void} [onDoubleClick]
 * @property {number} [distance] initial camera distance
 * @property {number} [autoRotate] radians per second until the reader takes over
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
    rot: rotationFromEuler(options.yaw ?? -0.5, options.pitch ?? -0.22),
    distance: options.distance ?? 900,
    // Zoom is deliberately close to unbounded. The stage holds everything from a
    // single base pair to a hundred-node dossier, and a reader who wants to fly
    // into one node should not hit a wall two turns of the wheel in.
    minDistance: options.minDistance ?? 30,
    maxDistance: options.maxDistance ?? 40000,
    focal: options.focal ?? 780,
    target: { x: 0, y: 0, z: 0 },
    // Residual angular velocity, in radians/second, so a flick keeps turning.
    spin: { x: 0, y: 0, z: 0 },
    autoRotate: reduced ? 0 : options.autoRotate ?? 0.05,
    orbit: options.orbit !== false,
    running: false,
    visible: true,
    dragging: false,
    /** True once the reader has moved the camera themselves. */
    userMoved: false,
    pointer: { x: -1, y: -1, inside: false },
    time: 0,
  };

  /** The opening framing, kept so "reset view" has something to return to. */
  const home = {
    rot: state.rot,
    distance: state.distance,
    autoRotate: state.autoRotate,
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

  /**
   * World → screen. `depth` is distance from the eye, used for sorting, fog and
   * scale. `visible` is false behind the near plane, where the projection would
   * otherwise fling geometry across the canvas.
   */
  function project(x, y, z) {
    const dx = x - state.target.x;
    const dy = y - state.target.y;
    const dz = z - state.target.z;
    const m = state.rot;

    const cx = m[0] * dx + m[1] * dy + m[2] * dz;
    const cy = m[3] * dx + m[4] * dy + m[5] * dz;
    const cz = m[6] * dx + m[7] * dy + m[8] * dz;

    const depth = state.distance - cz;
    if (depth < NEAR_PLANE) return { x: 0, y: 0, scale: 0, depth, visible: false };

    const scale = state.focal / depth;
    return {
      x: state.width / 2 + cx * scale,
      y: state.height / 2 - cy * scale,
      scale,
      depth,
      visible: true,
    };
  }

  /* -- camera moves --------------------------------------------------------
     Pre-multiplying rotates about the camera's own axes, which is what makes
     the drag feel like a trackball rather than a turntable: whatever is under
     the pointer follows it, at any orientation, with no pole to get stuck at.
     Post-multiplying rotates about a world axis, which is what the idle drift
     wants so the scene turns level instead of tumbling. */

  function rotateCamera(ax, ay, az) {
    let m = state.rot;
    if (ay) m = mul3(rotY(ay), m);
    if (ax) m = mul3(rotX(ax), m);
    if (az) m = mul3(rotZ(az), m);
    state.rot = orthonormalize(m);
  }

  function rotateWorld(ay) {
    state.rot = orthonormalize(mul3(state.rot, rotY(ay)));
  }

  /** Slide the camera across its own image plane, in screen pixels. */
  function panBy(dxPx, dyPx) {
    if (!dxPx && !dyPx) return;
    const k = state.distance / state.focal;
    const m = state.rot;
    state.target.x += (-dxPx * m[0] + dyPx * m[3]) * k;
    state.target.y += (-dxPx * m[1] + dyPx * m[4]) * k;
    state.target.z += (-dxPx * m[2] + dyPx * m[5]) * k;
  }

  /**
   * Zoom by a factor, keeping whatever sits under (px, py) under it. Anchoring
   * the zoom to the pointer is the difference between navigating a graph and
   * fighting it: without it, zooming in on a leaf walks the leaf off-screen.
   */
  function zoomBy(factor, px, py) {
    const before = state.distance;
    const next = clamp(before * factor, state.minDistance, state.maxDistance);
    if (next === before) return;
    state.distance = next;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;

    const k = before / state.focal;
    const offsetX = (px - state.width / 2) * k;
    const offsetY = -(py - state.height / 2) * k;
    const weight = 1 - next / before;
    const m = state.rot;
    state.target.x += weight * (offsetX * m[0] + offsetY * m[3]);
    state.target.y += weight * (offsetX * m[1] + offsetY * m[4]);
    state.target.z += weight * (offsetX * m[2] + offsetY * m[5]);
  }

  function stopSpin() {
    state.spin.x = 0;
    state.spin.y = 0;
    state.spin.z = 0;
  }

  /**
   * The opening drift is an invitation to touch the stage, not a behaviour to
   * fight. The first time the reader moves the camera it stops for good.
   */
  function markMoved() {
    if (state.userMoved) return;
    state.userMoved = true;
    state.autoRotate = 0;
  }

  function resetView() {
    state.rot = home.rot;
    state.distance = clamp(home.distance, state.minDistance, state.maxDistance);
    state.target.x = 0;
    state.target.y = 0;
    state.target.z = 0;
    stopSpin();
  }

  /* -- input -------------------------------------------------------------- */

  const pointerPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** 'rotate' | 'pan' | 'roll' — decided on pointerdown, held for the gesture. */
  let gesture = null;
  let anchor = null;
  let primaryId = null;
  let moved = 0;
  let lastMoveAt = 0;

  const pinch = new Map();
  let pinchDistance = 0;
  let pinchAngle = 0;
  let pinchCenter = null;

  // Middle and right drag pan, as they do in every other 3D viewer; shift is
  // the same gesture for a trackpad with one button. Alt rolls.
  const wantsPan = (event) => event.button === 1 || event.button === 2 || event.shiftKey;
  const wantsRoll = (event) => event.altKey;

  function onPointerDown(event) {
    pinch.set(event.pointerId, pointerPos(event));
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
      pinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // A second finger cancels the rotation the first one started, so lifting
      // off after a pinch never reads as a tap on whatever is underneath.
      gesture = null;
      anchor = null;
      primaryId = null;
      state.dragging = false;
      return;
    }
    if (!state.orbit) return;
    const point = pointerPos(event);
    primaryId = event.pointerId;
    anchor = point;
    gesture = wantsPan(event) ? 'pan' : wantsRoll(event) ? 'roll' : 'rotate';
    moved = 0;
    lastMoveAt = event.timeStamp || performance.now();
    state.dragging = true;
    stopSpin();
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

    // Two fingers carry all three moves at once: spread zooms, slide pans, and
    // a twist rolls — the third axis, on a device with no modifier keys.
    if (pinch.size === 2) {
      const [a, b] = [...pinch.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDistance > 0 && spread > 0) zoomBy(pinchDistance / spread, center.x, center.y);
      if (pinchCenter) panBy(center.x - pinchCenter.x, center.y - pinchCenter.y);
      let twist = angle - pinchAngle;
      if (twist > Math.PI) twist -= Math.PI * 2;
      if (twist < -Math.PI) twist += Math.PI * 2;
      if (Math.abs(twist) < 0.6) rotateCamera(0, 0, -twist);
      pinchDistance = spread;
      pinchAngle = angle;
      pinchCenter = center;
      markMoved();
      return;
    }

    if (!gesture || !anchor) {
      options.onPointerMove?.(point.x, point.y);
      return;
    }

    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    moved += Math.hypot(dx, dy);
    anchor = point;

    if (gesture === 'pan') {
      panBy(dx, dy);
    } else if (gesture === 'roll') {
      const az = dx * 0.006;
      rotateCamera(0, 0, az);
      state.spin.z = az / gestureSeconds(event);
    } else {
      const ax = dy * 0.005;
      const ay = dx * 0.006;
      rotateCamera(ax, ay, 0);
      const seconds = gestureSeconds(event);
      state.spin.x = clamp(ax / seconds, -8, 8);
      state.spin.y = clamp(ay / seconds, -8, 8);
    }
    markMoved();
  }

  /** Seconds since the previous move, floored so one stray event cannot fling. */
  function gestureSeconds(event) {
    const now = event.timeStamp || performance.now();
    const elapsed = clamp(now - lastMoveAt, 8, 120);
    lastMoveAt = now;
    return elapsed / 1000;
  }

  function endDrag(event) {
    pinch.delete(event.pointerId);
    if (pinch.size < 2) {
      pinchDistance = 0;
      pinchCenter = null;
    }
    if (pinch.size === 0) state.dragging = false;
    if (event.pointerId !== primaryId || !gesture) return;

    const point = pointerPos(event);
    // Only a still primary drag is a click. A pan or a roll never selects.
    const wasClick = gesture === 'rotate' && moved < 5;
    gesture = null;
    anchor = null;
    primaryId = null;
    state.dragging = false;
    if (wasClick) stopSpin();
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
    const point = pointerPos(event);

    if (event.altKey) {
      // A mouse has one wheel; alt spends it on the axis a mouse cannot reach.
      rotateCamera(0, 0, clamp(event.deltaY, -120, 120) * 0.0014);
      markMoved();
      return;
    }

    // deltaY arrives in pixels, lines or pages depending on the device.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.height : 1;
    const delta = clamp(event.deltaY * unit, -240, 240);
    // A trackpad pinch reaches the page as ctrl+wheel; it wants a finer step.
    zoomBy(Math.exp(delta * (event.ctrlKey ? 0.0022 : 0.0016)), point.x, point.y);
    markMoved();
  }

  function onContextMenu(event) {
    // Right-drag is the pan gesture; the menu would interrupt it.
    if (state.orbit) event.preventDefault();
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
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDoubleClick);

  /* -- keyboard ------------------------------------------------------------
     The stage is focusable, so every camera move a pointer can make is also
     reachable from the keyboard: arrows turn, ctrl+arrows pan, Q/E roll,
     +/- zoom, and 0 puts the view back where it started. */
  function onKeyDown(event) {
    if (!state.orbit) return;
    const step = event.shiftKey ? 0.28 : 0.1;
    const nudge = event.shiftKey ? 96 : 32;
    const panning = event.ctrlKey || event.metaKey;
    const key = event.key;

    if (key === 'ArrowLeft') panning ? panBy(-nudge, 0) : rotateCamera(0, -step, 0);
    else if (key === 'ArrowRight') panning ? panBy(nudge, 0) : rotateCamera(0, step, 0);
    else if (key === 'ArrowUp') panning ? panBy(0, -nudge) : rotateCamera(-step, 0, 0);
    else if (key === 'ArrowDown') panning ? panBy(0, nudge) : rotateCamera(step, 0, 0);
    else if (key === 'q' || key === 'Q') rotateCamera(0, 0, -step);
    else if (key === 'e' || key === 'E') rotateCamera(0, 0, step);
    else if (key === '+' || key === '=') zoomBy(0.88, state.width / 2, state.height / 2);
    else if (key === '-' || key === '_') zoomBy(1.14, state.width / 2, state.height / 2);
    else if (key === '0') resetView();
    else return;

    if (key !== '0') markMoved();
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

    // Residual spin from the last flick, decaying to rest. It also decays while
    // the pointer is held still mid-drag, so pausing before release stops the
    // stage dead instead of launching it on whatever the last pixel implied.
    const spin = state.spin;
    if (spin.x || spin.y || spin.z) {
      if (!state.dragging) rotateCamera(spin.x * dt, spin.y * dt, spin.z * dt);
      const decay = Math.exp(-dt * (state.dragging ? 9 : 3.4));
      spin.x *= decay;
      spin.y *= decay;
      spin.z *= decay;
      if (Math.abs(spin.x) + Math.abs(spin.y) + Math.abs(spin.z) < 0.002) stopSpin();
    } else if (!state.dragging && state.autoRotate) {
      rotateWorld(state.autoRotate * dt);
    }

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
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('dblclick', onDoubleClick);
    canvas.removeEventListener('keydown', onKeyDown);
  }

  resize();
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
      state.autoRotate = reduced || state.userMoved ? 0 : value;
    },
    /** Turn the camera about its own axes, in radians. */
    rotate: rotateCamera,
    /** Slide the camera across its image plane, in screen pixels. */
    pan: panBy,
    /** Zoom by a factor about a screen point; omit the point to zoom centrally. */
    zoom(factor, px = state.width / 2, py = state.height / 2) {
      zoomBy(factor, px, py);
    },
    /** Back to the opening framing, with the idle drift left off. */
    resetView,
    get userMoved() {
      return state.userMoved;
    },
  };
}

/* --------------------------------------------------------------- primitives */

/**
 * Bloom around a node.
 *
 * Additive blending is what makes a light glow on a dark stage, and it is
 * exactly wrong on a light one — adding to near-white just washes to white, so
 * the brightest nodes would become the least visible. On the light theme the
 * same shape is painted normally at lower alpha, which reads as a soft halo
 * instead of a blowout.
 */
export function glow(ctx, x, y, radius, color, alpha = 1) {
  if (!(radius > 0.4) || alpha <= 0.01) return;
  const light = theme.mode === 'light';
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color((light ? 0.3 : 0.55) * alpha));
  gradient.addColorStop(0.45, color((light ? 0.09 : 0.16) * alpha));
  gradient.addColorStop(1, color(0));
  if (!light) ctx.globalCompositeOperation = 'lighter';
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
