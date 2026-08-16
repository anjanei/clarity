// Ambient bio-structures for the hero.
//
// Pure SVG + CSS animation — no requestAnimationFrame loop, so the page costs
// nothing while it sits idle and honours prefers-reduced-motion for free.
//
// The helix is drawn two full periods tall inside a clipped viewport and
// translated by exactly one period, so the loop has no visible seam.

const TAU = Math.PI * 2;

/** One strand of a double helix as a polyline path. */
function strandPath({ cx, amplitude, height, periods, phase, steps = 160 }) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const y = t * height;
    const x = cx + amplitude * Math.sin(t * TAU * periods + phase);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}

/** Base-pair rungs, thinner where the strands cross (fakes depth cheaply). */
function rungs({ cx, amplitude, height, periods, count }) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = (i + 0.5) / count;
    const y = t * height;
    const angle = t * TAU * periods;
    const x1 = cx + amplitude * Math.sin(angle);
    const x2 = cx + amplitude * Math.sin(angle + Math.PI);
    const depth = Math.abs(Math.cos(angle));
    if (depth < 0.12) continue;
    const color = i % 3 === 0 ? 'var(--color-claude-400)' : 'var(--color-clip-400)';
    out.push(
      `<line class="helix-rung" x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y.toFixed(1)}"
        stroke="${color}" opacity="${(depth * 0.5).toFixed(2)}" />`,
    );
  }
  return out.join('');
}

function helix({ cx, amplitude, height, periods }) {
  const a = strandPath({ cx, amplitude, height, periods, phase: 0 });
  const b = strandPath({ cx, amplitude, height, periods, phase: Math.PI });
  return `
    ${rungs({ cx, amplitude, height, periods, count: periods * 14 })}
    <path class="helix-strand" d="${a}" stroke="var(--color-clip-400)" opacity="0.55" />
    <path class="helix-strand" d="${b}" stroke="var(--color-bench-400)" opacity="0.45" />`;
}

/**
 * A drifting node field — reads as a molecular graph and echoes the agent
 * topology without competing with it. Deterministic seed so it does not
 * reshuffle on every render.
 */
function nodeField({ width, height, count = 22, seed = 7 }) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };

  const nodes = Array.from({ length: count }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: 1 + rand() * 2.1,
    delay: rand() * 9,
  }));

  const links = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const distance = Math.hypot(dx, dy);
      if (distance < width * 0.17) {
        links.push(
          `<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}"
                 x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}"
                 stroke="var(--color-clip-400)" stroke-width="0.5"
                 opacity="${(0.2 - distance / (width * 1.2)).toFixed(3)}" />`,
        );
      }
    }
  }

  const dots = nodes
    .map(
      (n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}"
        fill="var(--color-bench-400)" opacity="0.4">
        <animate attributeName="opacity" values="0.15;0.55;0.15" dur="${(5 + n.delay).toFixed(1)}s"
                 repeatCount="indefinite" begin="${n.delay.toFixed(1)}s" />
      </circle>`,
    )
    .join('');

  return links.join('') + dots;
}

/** Hexagonal small-molecule glyphs, drifting slowly. */
function molecules({ width, height }) {
  const ring = (cx, cy, r) => {
    const points = Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * TAU - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    });
    return `<polygon points="${points.join(' ')}" fill="none" stroke="var(--color-claude-400)"
              stroke-width="0.9" opacity="0.3" />`;
  };
  return `
    <g class="float-slow">
      ${ring(width * 0.12, height * 0.72, 16)}
      ${ring(width * 0.155, height * 0.78, 16)}
    </g>
    <g class="float-slow" style="animation-delay:-6s">
      ${ring(width * 0.72, height * 0.22, 13)}
    </g>`;
}

export function renderHeroBio(mount) {
  if (!mount) return;
  const width = 1200;
  const height = 620;
  const periods = 5;

  mount.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice"
         class="h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bio-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0" />
          <stop offset="34%" stop-color="white" stop-opacity="1" />
          <stop offset="76%" stop-color="white" stop-opacity="1" />
          <stop offset="100%" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <mask id="bio-mask">
          <rect width="${width}" height="${height}" fill="url(#bio-fade)" />
        </mask>
        <clipPath id="helix-clip">
          <rect x="${width * 0.74}" y="0" width="${width * 0.26}" height="${height}" />
        </clipPath>
      </defs>

      <g mask="url(#bio-mask)" opacity="0.75">
        ${nodeField({ width, height })}
        ${molecules({ width, height })}
        <g clip-path="url(#helix-clip)">
          <g class="helix-spin">
            ${helix({ cx: width * 0.87, amplitude: 62, height: height * 2, periods: periods * 2 })}
          </g>
        </g>
      </g>
    </svg>`;
}

/**
 * A short DNA ribbon used as a section ornament. Same geometry as the hero
 * helix, sized for an inline strip.
 */
export function ribbonSvg({ width = 240, height = 44 } = {}) {
  const points = 90;
  const path = (phase, amplitude) => {
    const out = [];
    for (let i = 0; i <= points; i += 1) {
      const t = i / points;
      const x = t * width;
      const y = height / 2 + amplitude * Math.sin(t * TAU * 2.2 + phase);
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `M${out.join(' L')}`;
  };
  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full" aria-hidden="true">
      <path class="helix-strand" d="${path(0, height * 0.32)}" stroke="var(--color-clip-400)" opacity="0.5" />
      <path class="helix-strand" d="${path(Math.PI, height * 0.32)}" stroke="var(--color-bench-400)" opacity="0.4" />
    </svg>`;
}
