// The crew.
//
// Three small couriers live on a transparent overlay above the whole workstation.
// They are not ornament for its own sake: each one is bound to a real actor in
// the pipeline, and it only moves when that actor does.
//
//   Clip   (cyan)    Paperclip retrieval — carries a document from the retrieval
//                    node to the domain that asked for it, once per real search.
//   Cortex (coral)   Claude — carries a scored domain into the dossier.
//   Helix  (emerald) Benchling — fetches the construct.
//
// They also do the small physical courtesy the interface owes the reader: when a
// disclosure is opened, the nearest idle crew member walks over and pulls it
// down, so the panel opening has a cause you can see.
//
// The whole layer is optional. It is disabled outright under
// prefers-reduced-motion, and the rail carries a toggle, because a moving figure
// near text is exactly the wrong thing for some readers.

import { PALETTE, clamp, easeOut, lerp, prefersReducedMotion } from './engine3d.js';

const CREW = [
  { id: 'clip', name: 'Clip', color: PALETTE.clip, role: 'retrieval' },
  { id: 'cortex', name: 'Cortex', color: PALETTE.claude, role: 'reasoning' },
  { id: 'helix', name: 'Helix', color: PALETTE.bench, role: 'structure' },
];

const resolvePoint = (target) => {
  if (!target) return null;
  if (typeof target === 'function') {
    try {
      return resolvePoint(target());
    } catch {
      return null;
    }
  }
  if (typeof target.getBoundingClientRect === 'function') {
    const rect = target.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  if (Number.isFinite(target.x) && Number.isFinite(target.y)) return { x: target.x, y: target.y };
  return null;
};

/**
 * @param {{mount: HTMLElement, enabled?: boolean}} options
 */
export function createCrew({ mount, enabled = true } = {}) {
  if (!mount) return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'crew-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  mount.append(canvas);

  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) {
    canvas.remove();
    return null;
  }

  const reduced = prefersReducedMotion();
  let live = enabled && !reduced;

  const size = { width: 1, height: 1, dpr: 1 };
  const sparks = [];
  const queue = [];

  const home = () => ({
    x: size.width * 0.5,
    y: size.height - 74,
  });

  const agents = CREW.map((member, index) => {
    const base = home();
    return {
      ...member,
      x: base.x + (index - 1) * 42,
      y: base.y,
      tx: base.x + (index - 1) * 42,
      ty: base.y,
      slot: index - 1,
      task: null,
      phase: index * 2.1,
      carry: null,
      facing: 1,
      hop: 0,
    };
  });

  function resize() {
    const width = Math.max(1, mount.clientWidth || window.innerWidth);
    const height = Math.max(1, mount.clientHeight || window.innerHeight);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (width === size.width && height === size.height && dpr === size.dpr) return;
    size.width = width;
    size.height = height;
    size.dpr = dpr;
    // Only the backing store is sized here. The CSS size comes from the layer
    // itself; writing it back would let one frame of overflow pin the canvas at
    // the wrong width and keep the overflow alive.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(mount);
  if (!observer) window.addEventListener('resize', resize);
  resize();

  /* -- drawing ------------------------------------------------------------ */

  function drawAgent(agent, time) {
    const bob = Math.sin(time * 3.4 + agent.phase) * 2 + agent.hop * -10;
    const x = agent.x;
    const y = agent.y + bob;
    const color = agent.color;

    // A soft ground shadow keeps them attached to the surface rather than floating.
    ctx.beginPath();
    ctx.ellipse(x, agent.y + 11, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(0 0 0 / 0.32)';
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, 22);
    glowGradient.addColorStop(0, color(0.34));
    glowGradient.addColorStop(1, color(0));
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body: a capsule with a visor. Deliberately abstract — an instrument's crew,
    // not a cartoon mascot.
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 6);
    ctx.lineTo(x - 6, y - 2);
    ctx.quadraticCurveTo(x - 6, y - 9, x, y - 9);
    ctx.quadraticCurveTo(x + 6, y - 9, x + 6, y - 2);
    ctx.lineTo(x + 6, y + 6);
    ctx.quadraticCurveTo(x, y + 9, x - 6, y + 6);
    ctx.closePath();
    ctx.fillStyle = PALETTE.void(0.92);
    ctx.fill();
    ctx.strokeStyle = color(0.9);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x + agent.facing * 1.2, y - 3, 3.4, 2.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = color(0.95);
    ctx.fill();

    // Legs, which only exist while walking.
    const speed = Math.hypot(agent.tx - agent.x, agent.ty - agent.y);
    if (speed > 3) {
      const swing = Math.sin(time * 14 + agent.phase) * 3;
      ctx.strokeStyle = color(0.7);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x - 2.4, y + 7);
      ctx.lineTo(x - 2.4 + swing, y + 11);
      ctx.moveTo(x + 2.4, y + 7);
      ctx.lineTo(x + 2.4 - swing, y + 11);
      ctx.stroke();
    }

    if (agent.carry) {
      const cx = x + agent.facing * 9;
      const cy = y - 8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(time * 5 + agent.phase) * 0.2);
      ctx.strokeStyle = PALETTE.ink(0.85);
      ctx.lineWidth = 1.1;
      // A paperclip, drawn as a paperclip.
      ctx.beginPath();
      ctx.moveTo(-1.6, 3);
      ctx.lineTo(-1.6, -2);
      ctx.arc(0, -2, 1.6, Math.PI, 0);
      ctx.lineTo(1.6, 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= dt;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      spark.x += spark.vx * dt * 60;
      spark.y += spark.vy * dt * 60;
      spark.vy += 0.06;
      const alpha = clamp(spark.life / spark.max, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 1.6 * alpha + 0.4, 0, Math.PI * 2);
      ctx.fillStyle = spark.color(alpha * 0.9);
      ctx.fill();
      ctx.restore();
    }
  }

  function burst(x, y, color, count = 9) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * (0.6 + Math.random() * 0.9),
        vy: Math.sin(angle) * (0.6 + Math.random() * 0.9) - 0.5,
        life: 0.7,
        max: 0.7,
        color,
      });
    }
  }

  /* -- tasks -------------------------------------------------------------- */

  function idleAgent(role) {
    return (
      agents.find((agent) => !agent.task && agent.role === role) ??
      agents.find((agent) => !agent.task) ??
      null
    );
  }

  function assign() {
    while (queue.length) {
      const job = queue[0];
      const agent = idleAgent(job.role);
      if (!agent) return;
      queue.shift();
      agent.task = { ...job, stage: 'to', t: 0 };
      agent.carry = job.carry ?? null;
    }
  }

  function stepAgent(agent, dt, time) {
    const task = agent.task;
    if (task) {
      const point = resolvePoint(task.stage === 'to' ? task.from : task.to);
      if (point) {
        agent.tx = point.x;
        agent.ty = point.y;
      }
      const distance = Math.hypot(agent.tx - agent.x, agent.ty - agent.y);
      if (distance < 9) {
        if (task.stage === 'to') {
          task.stage = 'carry';
          agent.carry = task.carry || null;
        } else if (task.stage === 'carry') {
          agent.carry = null;
          agent.hop = 1;
          burst(agent.x, agent.y - 6, agent.color, task.celebrate ? 16 : 8);
          task.onArrive?.();
          agent.task = null;
        }
      }
    } else {
      const base = home();
      agent.tx = base.x + agent.slot * 46 + Math.sin(time * 0.5 + agent.phase) * 12;
      agent.ty = base.y + Math.cos(time * 0.4 + agent.phase) * 5;
    }

    const dx = agent.tx - agent.x;
    const dy = agent.ty - agent.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.5) {
      const speed = clamp(distance * 0.14, 0.6, 12) * clamp(dt * 60, 0.3, 2);
      agent.x += (dx / distance) * speed;
      agent.y += (dy / distance) * speed;
      if (Math.abs(dx) > 1) agent.facing = dx > 0 ? 1 : -1;
    }
    agent.hop = Math.max(0, agent.hop - dt * 3.4);
  }

  /* -- loop --------------------------------------------------------------- */

  let raf = 0;
  let last = 0;
  let disposed = false;

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - (last || now)) / 1000, 0, 0.05);
    last = now;
    if (!live || document.hidden) return;

    resize();
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const time = now / 1000;
    assign();
    for (const agent of agents) {
      stepAgent(agent, dt, time);
      drawAgent(agent, time);
    }
    drawSparks(dt);
  }
  raf = requestAnimationFrame(frame);

  /* -- public surface ----------------------------------------------------- */

  return {
    get enabled() {
      return live;
    },
    setEnabled(value) {
      live = Boolean(value) && !reduced;
      if (!live) {
        ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        queue.length = 0;
        for (const agent of agents) {
          agent.task = null;
          agent.carry = null;
        }
      }
    },
    /** Ferry one packet between two points, elements or point-returning functions. */
    ferry({ from, to, role = 'retrieval', carry = 'doc', onArrive, celebrate = false } = {}) {
      if (!live) {
        onArrive?.();
        return;
      }
      // A long backlog means a fast run; drop the excess rather than fall behind.
      if (queue.length > 12) queue.shift();
      queue.push({ from, to, role, carry, onArrive, celebrate });
    },
    /** Send someone to physically pull a disclosure open. */
    tug(element, { role = 'reasoning' } = {}) {
      if (!live || !element) return;
      const point = resolvePoint(element);
      if (!point) return;
      const agent = idleAgent(role);
      if (!agent) return;
      agent.task = {
        from: { x: point.x, y: point.y - 4 },
        to: { x: point.x, y: point.y + 16 },
        stage: 'to',
        carry: null,
        onArrive: () => {
          element.classList?.add('is-tugged');
          setTimeout(() => element.classList?.remove('is-tugged'), 460);
        },
      };
    },
    /**
     * The crew spills out of whatever the reader just pressed, then walks back to
     * its posts. Purely a courtesy — it fires on the button that started the work,
     * so the work visibly has somewhere to have come from.
     */
    popFrom(target, { scatter = 34 } = {}) {
      if (!live) return;
      const point = resolvePoint(target);
      if (!point) return;
      agents.forEach((agent, index) => {
        const angle = -Math.PI / 2 + (index - (agents.length - 1) / 2) * 0.7;
        agent.x = point.x;
        agent.y = point.y;
        agent.tx = point.x + Math.cos(angle) * scatter;
        agent.ty = point.y + Math.sin(angle) * scatter;
        agent.hop = 1;
        agent.facing = Math.cos(angle) >= 0 ? 1 : -1;
        burst(point.x, point.y, agent.color, 7);
      });
    },
    cheer(target) {
      if (!live) return;
      const point = resolvePoint(target);
      if (!point) return;
      for (const agent of agents) {
        agent.task = { from: point, to: point, stage: 'to', carry: null, celebrate: true };
      }
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      canvas.remove();
    },
  };
}
