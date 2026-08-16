// The agent topology, drawn from the pipeline the server actually runs.
//
// Node ids are the real stage identifiers (`retrieval`, `dossier`, `review`) and
// the real CLARITY domain ids, so SSE progress events drive the picture directly
// rather than a scripted animation playing alongside it. If a stage never fires,
// its node never lights — which is the point.
//
// Layout is a fan-out/fan-in: one trial record → one retrieval agent → N domain
// passes → one synthesis → one review → the report.

const COLUMNS = {
  trial: { cx: 62, halfWidth: 52 },
  retrieval: { cx: 214, halfWidth: 66 },
  domain: { cx: 452, halfWidth: 104 },
  dossier: { cx: 704, halfWidth: 68 },
  review: { cx: 866, halfWidth: 66 },
  report: { cx: 996, halfWidth: 44 },
};

const VIEW_WIDTH = 1052;
const ROW_HEIGHT = 42;
const NODE_HEIGHT = 32;

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

/** Domain labels are long; the graph needs them short but still recognisable. */
const SHORT_LABEL = {
  disease_context_mechanism: 'Disease & mechanism',
  trial_design: 'Trial design',
  acute_safety_tolerability: 'Acute safety',
  long_term_genetic_risk: 'Long-term genetic risk',
  biodistribution_pharmacology: 'Biodistribution & PK',
  immunogenicity_special_populations: 'Immunogenicity',
  product_quality_cmc: 'Product quality / CMC',
  trial_integrity_governance: 'Trial integrity',
  benefit_risk_postmarketing: 'Benefit–risk & PMS',
};

function nodeSvg({ id, agent, cx, cy, halfWidth, label, sub, state }) {
  const height = NODE_HEIGHT;
  const y = cy - height / 2;
  const x = cx - halfWidth;
  const width = halfWidth * 2;
  return `
    <g class="node" data-node="${esc(id)}" data-agent="${esc(agent)}" data-state="${esc(state)}">
      <rect class="node-halo" x="${x}" y="${y}" width="${width}" height="${height}" rx="8"
            style="transform-origin:${cx}px ${cy}px" />
      <rect class="node-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="8" />
      <text class="node-label" x="${cx}" y="${sub ? cy - 1 : cy + 3}" text-anchor="middle">${esc(label)}</text>
      ${sub ? `<text class="node-sub" x="${cx}" y="${cy + 9}" text-anchor="middle">${esc(sub)}</text>` : ''}
    </g>`;
}

function edgeSvg({ from, to, id }) {
  const midX = (from.x + to.x) / 2;
  const d = `M${from.x},${from.y} C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`;
  return `
    <path class="edge" data-edge="${esc(id)}" data-state="idle" d="${d}" />
    <path class="edge-flow" data-flow="${esc(id)}" data-state="idle" d="${d}"
          stroke="var(--color-clip-400)" />`;
}

/**
 * @param {HTMLElement} mount
 * @param {{domains: Array<{id:string,label:string,active?:boolean}>, compact?: boolean}} options
 */
export function createPipelineGraph(mount, { domains = [], compact = false } = {}) {
  const shown = compact ? domains.slice(0, 5) : domains;
  const rows = Math.max(shown.length, 3);
  const height = rows * ROW_HEIGHT + 36;
  const centreY = height / 2;
  const top = (height - shown.length * ROW_HEIGHT) / 2 + ROW_HEIGHT / 2;

  const domainNodes = shown.map((domain, index) => ({
    id: domain.id,
    agent: 'claude',
    label: SHORT_LABEL[domain.id] ?? domain.label,
    sub: null,
    cx: COLUMNS.domain.cx,
    cy: top + index * ROW_HEIGHT,
    halfWidth: COLUMNS.domain.halfWidth,
    state: domain.active === false ? 'skip' : 'idle',
  }));

  const singles = [
    { id: 'trial', agent: 'sys', label: 'Trial', sub: 'registry', ...COLUMNS.trial, cy: centreY },
    { id: 'retrieval', agent: 'clip', label: 'Paperclip', sub: 'search · map', ...COLUMNS.retrieval, cy: centreY },
    { id: 'dossier', agent: 'claude', label: 'CLARITY dossier', sub: 'cited', ...COLUMNS.dossier, cy: centreY },
    { id: 'review', agent: 'claude', label: 'FDA review', sub: 'rubric', ...COLUMNS.review, cy: centreY },
    { id: 'report', agent: 'bench', label: 'Report', sub: null, ...COLUMNS.report, cy: centreY },
  ].map((node) => ({ ...node, state: 'idle' }));

  const all = [...singles, ...domainNodes];
  const byId = new Map(all.map((node) => [node.id, node]));

  const anchorRight = (node) => ({ x: node.cx + node.halfWidth, y: node.cy });
  const anchorLeft = (node) => ({ x: node.cx - node.halfWidth, y: node.cy });

  const edges = [
    { from: 'trial', to: 'retrieval' },
    ...domainNodes.map((node) => ({ from: 'retrieval', to: node.id })),
    ...domainNodes.map((node) => ({ from: node.id, to: 'dossier' })),
    { from: 'dossier', to: 'review' },
    { from: 'review', to: 'report' },
  ].map((edge) => ({ ...edge, id: `${edge.from}->${edge.to}` }));

  mount.innerHTML = `
    <div class="graph-wrap">
      <svg class="graph-svg" viewBox="0 0 ${VIEW_WIDTH} ${height}" role="img"
           aria-label="Agent pipeline: trial record, Paperclip retrieval, CLARITY domain passes, dossier synthesis, FDA review, report">
        <g>${edges
          .map((edge) =>
            edgeSvg({
              id: edge.id,
              from: anchorRight(byId.get(edge.from)),
              to: anchorLeft(byId.get(edge.to)),
            }),
          )
          .join('')}</g>
        <g>${all.map((node) => nodeSvg(node)).join('')}</g>
      </svg>
      ${
        compact && domains.length > shown.length
          ? `<p class="px-3 pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ghost">
               +${domains.length - shown.length} more domains
             </p>`
          : ''
      }
    </div>`;

  const svg = mount.querySelector('svg');
  const nodeEl = (id) => svg?.querySelector(`.node[data-node="${CSS.escape(id)}"]`);
  const states = new Map(all.map((node) => [node.id, node.state]));

  /** Edge state is derived, never set directly: it is a function of its ends. */
  function syncEdges() {
    for (const edge of edges) {
      const fromState = states.get(edge.from);
      const toState = states.get(edge.to);
      let state = 'idle';
      if (toState === 'active') state = 'active';
      else if (fromState === 'done' && toState === 'done') state = 'done';
      else if (fromState === 'done' && toState === 'idle') state = 'active';
      if (fromState === 'skip' || toState === 'skip') state = 'idle';

      svg?.querySelector(`.edge[data-edge="${CSS.escape(edge.id)}"]`)?.setAttribute('data-state', state);
      svg
        ?.querySelector(`.edge-flow[data-flow="${CSS.escape(edge.id)}"]`)
        ?.setAttribute('data-state', state === 'active' ? 'active' : 'idle');
    }
  }

  function set(id, state) {
    if (!states.has(id) || states.get(id) === 'skip') return;
    states.set(id, state);
    nodeEl(id)?.setAttribute('data-state', state);
    syncEdges();
  }

  return {
    node: nodeEl,
    has: (id) => states.has(id),
    state: (id) => states.get(id),
    activate: (id) => set(id, 'active'),
    complete: (id) => set(id, 'done'),
    /** Everything not skipped reads as finished — used when a result lands. */
    completeAll() {
      for (const [id, state] of states) if (state !== 'skip') set(id, 'done');
    },
    reset() {
      for (const [id, state] of states) if (state !== 'skip') set(id, 'idle');
    },
    domainIds: domainNodes.map((node) => node.id),
  };
}
