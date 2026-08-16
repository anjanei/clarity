// The living evidence graph.
//
// This is the lab's main surface, and it is not decoration: every node is a real
// object from the run. The stage nodes are the pipeline stages the server
// actually executes, the domain nodes are the CLARITY domains, the document
// nodes are the public sources the dossier cited, and the claim nodes are the
// findings the reviewer scored. If a stage never fires, its node never lights.
// If a document was never retrieved, no node exists for it.
//
// Three behaviours matter:
//
//   1. It grows. Retrieval events attach document nodes as they arrive, so the
//      graph is visibly larger at the end of a run than at the start.
//   2. It breathes. Nodes are anchored to a layered layout and then perturbed by
//      springs, repulsion and a slow noise field, so the picture is legible but
//      never still.
//   3. It descends. Any node carrying structure underneath it can be opened into
//      its own graph — a document into its findings, a finding into its
//      provenance chain, the review into the weighted rubric — with a breadcrumb
//      trail back up.

import {
  AGENT_COLOR,
  PALETTE,
  clamp,
  createStage,
  depthAlpha,
  disc,
  easeOut,
  glow,
  label as drawLabel,
  lerp,
  seededRandom,
} from './engine3d.js';

// Wide enough that the pipeline reads left-to-right at the default camera angle
// rather than collapsing its stages into one another under perspective.
const COLUMN_WIDTH = 246;
const SPAWN_MS = 620;

/** Domain labels are long; in space they need to be short but still recognisable. */
export const SHORT_LABEL = {
  disease_context_mechanism: 'Disease & mechanism',
  trial_design: 'Trial design',
  acute_safety_tolerability: 'Acute safety',
  long_term_genetic_risk: 'Genetic risk',
  biodistribution_pharmacology: 'Biodistribution',
  immunogenicity_special_populations: 'Immunogenicity',
  product_quality_cmc: 'Quality / CMC',
  trial_integrity_governance: 'Trial integrity',
  benefit_risk_postmarketing: 'Benefit–risk',
  efficacy_clinical_evidence: 'Efficacy',
  safety: 'Safety',
  immunogenicity: 'Immunogenicity',
  manufacturability: 'Manufacturability',
  pkpd_dosing: 'PK/PD & dosing',
  trial_design_regulatory: 'Trial design',
};

const short = (id, fallback) => SHORT_LABEL[id] ?? fallback ?? id;

const TONE_COLOR = {
  ok: PALETTE.ok,
  gap: PALETTE.gap,
  stop: PALETTE.stop,
  unknown: PALETTE.faint,
};

/** What kind of document this is, taken from the dossier's own classification. */
const SOURCE_COLOR = {
  primary_literature: PALETTE.lit,
  trial_registry: PALETTE.clip,
  regulatory_document: PALETTE.reg,
};

/** Registry ids are identity; a paper's identity is its title. */
function documentLabel(doc) {
  const title = String(doc.title ?? '').trim();
  if (title && title.toUpperCase() !== String(doc.identifier ?? '').toUpperCase()) {
    return title.length > 34 ? `${title.slice(0, 33)}…` : title;
  }
  return doc.identifier || 'Source';
}

const scoreTone = (score, strength) => {
  if (strength === 'absent' || score == null) return 'unknown';
  if (score <= 2) return 'stop';
  if (score === 3) return 'gap';
  return 'ok';
};

/* ------------------------------------------------------------ graph builders */

/** Points spread evenly over a sphere — the layout for any expanded node. */
function fibonacciSphere(count, radius) {
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push({
      x: Math.cos(theta) * r * radius,
      y: y * radius * 0.72,
      z: Math.sin(theta) * r * radius,
    });
  }
  return points;
}

function ringAnchor(column, index, count) {
  const radius = count <= 1 ? 0 : clamp(38 + count * 13, 42, 168);
  const angle = count <= 1 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2;
  return {
    x: (column - 2.3) * COLUMN_WIDTH,
    y: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
  };
}

/**
 * Collapse the dossier's citations into one node per public document, remembering
 * every element that cited it. A paper cited by four domains is one paper.
 */
export function collectDocuments(evaluation) {
  const docs = new Map();
  for (const domain of evaluation?.evidence?.dossier?.domains ?? []) {
    for (const element of domain.elements ?? []) {
      for (const citation of element.citations ?? []) {
        const key = String(citation.identifier || citation.url || citation.title || '').toUpperCase();
        if (!key) continue;
        const existing = docs.get(key) ?? {
          key,
          identifier: citation.identifier || '',
          title: citation.title || citation.identifier || 'Source',
          url: citation.url || '',
          sourceType: citation.sourceType || '',
          cites: [],
          domains: new Set(),
        };
        existing.cites.push({ domain, element });
        existing.domains.add(domain.domainId);
        docs.set(key, existing);
      }
    }
  }
  return [...docs.values()].sort((a, b) => b.cites.length - a.cites.length);
}

/**
 * The top-level topology. Stage nodes always exist; document nodes exist only for
 * evidence that was actually retrieved.
 */
function buildPipelineSpec({ pipeline, trial, evaluation, liveDocs }) {
  const domains = pipeline?.domains ?? [];
  const review = evaluation?.review;
  const criteria = new Map((review?.criteria ?? []).map((c) => [c.id, c]));
  const nodes = [];
  const edges = [];

  const push = (node) => {
    nodes.push(node);
    return node;
  };

  push({
    id: 'trial',
    kind: 'sys',
    label: trial ? trial.therapeuticName : 'No programme',
    sub: trial ? trial.trialId : 'select one',
    column: 0,
    ring: [0, 1],
    radius: 15,
    expandable: Boolean(trial),
    data: { type: 'trial', trial },
  });

  push({
    id: 'retrieval',
    kind: 'clip',
    label: 'Paperclip',
    sub: 'search · map',
    column: 1,
    ring: [0, 1],
    radius: 14,
    expandable: Boolean(evaluation?.evidence?.sections?.length),
    data: { type: 'retrieval', sections: evaluation?.evidence?.sections ?? [] },
  });
  edges.push({ from: 'trial', to: 'retrieval' });

  // Documents sit between retrieval and the domains that consumed them.
  const documents = evaluation ? collectDocuments(evaluation) : [];
  const liveOnly = documents.length ? [] : liveDocs ?? [];

  // One node per real paper, registry record or review document — titled, sized
  // by how many findings lean on it, coloured by what kind of source it is.
  documents.forEach((doc, index) => {
    const id = `doc:${doc.key}`;
    push({
      id,
      kind: 'doc',
      label: documentLabel(doc),
      sub: [doc.identifier, doc.cites.length > 1 ? `×${doc.cites.length}` : null].filter(Boolean).join(' '),
      column: 1.72,
      ring: [index, Math.max(documents.length, 1)],
      radius: clamp(5.5 + doc.cites.length * 1.9, 5.5, 14),
      sourceType: doc.sourceType,
      expandable: true,
      data: { type: 'document', doc },
    });
    edges.push({ from: 'retrieval', to: id, faint: true });
    for (const domainId of doc.domains) edges.push({ from: id, to: domainId, faint: true });
  });

  // Mid-run, before any of it has been cited: each completed search lands here as
  // it happens, which is what makes the board grow while you watch it.
  liveOnly.forEach((doc, index) => {
    const id = `live:${doc.key}`;
    push({
      id,
      kind: 'doc',
      label: doc.label,
      sub: doc.source,
      column: 1.72,
      ring: [index, Math.max(liveOnly.length, 1)],
      radius: 7,
      state: 'active',
      expandable: false,
      data: { type: 'liveSection', section: doc },
    });
    edges.push({ from: 'retrieval', to: id, faint: true });
    if (doc.domainId) edges.push({ from: id, to: doc.domainId, faint: true });
  });

  domains.forEach((domain, index) => {
    const criterion = criteria.get(domain.id);
    push({
      id: domain.id,
      kind: 'claude',
      label: short(domain.id, domain.label),
      sub: criterion ? `${criterion.score}/5` : 'domain',
      column: 3,
      ring: [index, domains.length],
      radius: 11,
      tone: criterion ? scoreTone(criterion.score, criterion.evidenceStrength) : null,
      state: domain.active === false ? 'skip' : undefined,
      expandable: true,
      data: { type: 'domain', domain, criterion },
    });
    edges.push({ from: domain.id, to: 'dossier' });
  });

  push({
    id: 'dossier',
    kind: 'claude',
    label: 'CLARITY dossier',
    sub: 'cited',
    column: 4,
    ring: [0, 1],
    radius: 14,
    expandable: Boolean(evaluation?.evidence?.dossier?.domains?.length),
    data: { type: 'dossier', dossier: evaluation?.evidence?.dossier },
  });

  push({
    id: 'review',
    kind: 'claude',
    label: 'FDA review',
    sub: 'rubric',
    column: 5,
    ring: [0, 1],
    radius: 16,
    expandable: Boolean(review),
    data: { type: 'review', review },
  });
  edges.push({ from: 'dossier', to: 'review' });

  push({
    id: 'bench',
    kind: 'bench',
    label: 'Structure',
    sub: 'construct',
    column: 4.1,
    ring: [0.5, 1],
    anchorOffset: { x: 0, y: -150, z: 60 },
    radius: 11,
    expandable: true,
    data: { type: 'structure' },
  });
  edges.push({ from: 'trial', to: 'bench', faint: true });

  push({
    id: 'report',
    kind: 'sys',
    label: 'Report',
    sub: review ? `${review.probabilityOfTrialSuccess?.pointEstimate ?? '—'}%` : null,
    column: 6,
    ring: [0, 1],
    radius: 14,
    expandable: Boolean(review),
    data: { type: 'report', review },
  });
  edges.push({ from: 'review', to: 'report' });
  edges.push({ from: 'bench', to: 'report', faint: true });

  return { id: 'pipeline', title: 'Agent topology', nodes, edges, layout: 'columns' };
}

/** One document, opened: the findings it supports and where they landed. */
function documentSpec(doc, evaluation) {
  const nodes = [
    {
      id: 'focus',
      kind: 'doc',
      label: documentLabel(doc),
      sub: doc.identifier || doc.sourceType || 'source',
      radius: 20,
      center: true,
      sourceType: doc.sourceType,
      data: { type: 'document', doc },
    },
  ];
  const edges = [];
  const domainsSeen = new Map();

  doc.cites.slice(0, 26).forEach(({ domain, element }, index) => {
    const id = `el:${index}`;
    nodes.push({
      id,
      kind: 'claude',
      label: element.element,
      sub: element.confidenceScore != null ? `${element.confidenceScore}%` : null,
      radius: clamp(6 + (Number(element.confidenceScore) || 0) / 14, 6, 13),
      expandable: true,
      data: { type: 'element', element, domain, doc },
    });
    edges.push({ from: 'focus', to: id });

    const domainNodeId = `dm:${domain.domainId}`;
    if (!domainsSeen.has(domainNodeId)) {
      domainsSeen.set(domainNodeId, true);
      const criterion = (evaluation?.review?.criteria ?? []).find((c) => c.id === domain.domainId);
      nodes.push({
        id: domainNodeId,
        kind: 'claude',
        label: short(domain.domainId, domain.domainLabel),
        sub: criterion ? `scored ${criterion.score}/5` : 'domain',
        radius: 12,
        tone: criterion ? scoreTone(criterion.score, criterion.evidenceStrength) : null,
        data: { type: 'domain', domain: { id: domain.domainId, label: domain.domainLabel }, criterion },
      });
    }
    edges.push({ from: id, to: domainNodeId, faint: true });
  });

  return {
    id: `document:${doc.key}`,
    title: doc.title,
    subtitle: `${doc.cites.length} dossier element${doc.cites.length === 1 ? '' : 's'} cite this source`,
    nodes,
    edges,
    layout: 'sphere',
  };
}

/** One CLARITY domain, opened: its retrieval commands, findings and score. */
function domainSpec(node, evaluation, pipeline) {
  const domainId = node.data.domain?.id ?? node.id;
  const criterion = node.data.criterion;
  const dossierDomain = (evaluation?.evidence?.dossier?.domains ?? []).find((d) => d.domainId === domainId);
  const sections = (evaluation?.evidence?.sections ?? []).filter((s) => s.domainId === domainId);
  const planned = (pipeline?.domains ?? []).find((d) => d.id === domainId)?.searches ?? [];

  const nodes = [
    {
      id: 'focus',
      kind: 'claude',
      label: short(domainId, node.data.domain?.label),
      sub: criterion ? `${criterion.score}/5 · ${criterion.evidenceStrength}` : 'not scored',
      radius: 22,
      center: true,
      tone: criterion ? scoreTone(criterion.score, criterion.evidenceStrength) : null,
      data: { type: 'domain', domain: node.data.domain, criterion },
    },
  ];
  const edges = [];

  (sections.length ? sections : planned).slice(0, 10).forEach((section, index) => {
    const id = `cmd:${index}`;
    nodes.push({
      id,
      kind: 'clip',
      label: section.source ?? section.scope ?? 'search',
      sub: section.chars ? `${Math.round(section.chars / 1000)}k chars` : 'planned',
      radius: 8,
      data: { type: 'command', section },
    });
    edges.push({ from: id, to: 'focus', faint: true });
  });

  (dossierDomain?.elements ?? []).slice(0, 14).forEach((element, index) => {
    const id = `el:${index}`;
    nodes.push({
      id,
      kind: 'claude',
      label: element.element,
      sub: element.confidenceScore != null ? `${element.confidenceScore}%` : null,
      radius: clamp(6 + (Number(element.confidenceScore) || 0) / 14, 6, 13),
      expandable: true,
      data: { type: 'element', element, domain: dossierDomain },
    });
    edges.push({ from: 'focus', to: id });
  });

  (criterion?.concerns ?? []).slice(0, 5).forEach((concern, index) => {
    const id = `cn:${index}`;
    nodes.push({
      id,
      kind: 'risk',
      label: concern.concern,
      sub: concern.severity,
      radius: 9,
      expandable: true,
      data: { type: 'claim', claim: concern.concern, source: concern.source, label: `${concern.severity} concern`, domainId },
    });
    edges.push({ from: 'focus', to: id });
  });

  return {
    id: `domain:${domainId}`,
    title: node.data.domain?.label ?? domainId,
    subtitle: criterion
      ? `scored ${criterion.score}/5 · evidence ${criterion.evidenceStrength}`
      : 'no rubric score recorded for this domain',
    nodes,
    edges,
    layout: 'sphere',
  };
}

/** The review, opened: the weighted rubric as a body with mass. */
function reviewSpec(review, rubric) {
  const weightOf = (criterion) =>
    rubric?.dimensions?.find((d) => d.id === criterion.id)?.weight ?? criterion.weight ?? 0;

  const probability = review?.probabilityOfTrialSuccess ?? {};
  const nodes = [
    {
      id: 'focus',
      kind: 'sys',
      label: `${probability.pointEstimate ?? '—'}%`,
      sub: `range ${probability.low ?? '—'}–${probability.high ?? '—'}`,
      radius: 26,
      center: true,
      data: { type: 'probability', review },
    },
  ];
  const edges = [];

  (review?.criteria ?? []).forEach((criterion, index) => {
    const id = `cr:${index}`;
    const weight = weightOf(criterion);
    nodes.push({
      id,
      kind: 'claude',
      label: short(criterion.id, criterion.label),
      sub: `${criterion.score}/5 · w ${Math.round(weight * 100)}%`,
      radius: clamp(7 + weight * 46, 7, 20),
      tone: scoreTone(criterion.score, criterion.evidenceStrength),
      expandable: true,
      data: { type: 'criterion', criterion, weight },
    });
    edges.push({ from: id, to: 'focus', weight: Math.max(0.2, weight * 5) });
  });

  (review?.redFlags ?? []).slice(0, 6).forEach((flag, index) => {
    const id = `rf:${index}`;
    nodes.push({
      id,
      kind: 'risk',
      label: flag.flag ?? String(flag),
      sub: 'red flag',
      radius: 9,
      data: { type: 'redFlag', flag },
    });
    edges.push({ from: id, to: 'focus', faint: true });
  });

  return {
    id: 'review:rubric',
    title: 'Weighted rubric',
    subtitle: 'node mass is rubric weight · colour is the score',
    nodes,
    edges,
    layout: 'sphere',
  };
}

/** One claim, opened: its provenance chain drawn as a chain. */
function claimSpec(node, evaluation, resolveSources) {
  const claimText = node.data.claim ?? node.data.element?.finding ?? '';
  const sources = resolveSources?.(node.data.source ?? '', evaluation) ?? [];
  const element = node.data.element;

  const nodes = [
    { id: 'focus', kind: node.kind === 'risk' ? 'risk' : 'claude', label: claimText, sub: node.data.label ?? 'claim', radius: 20, center: true, data: node.data },
  ];
  const edges = [];

  if (element) {
    nodes.push({
      id: 'extraction',
      kind: 'claude',
      label: 'Extraction',
      sub: element.confidenceScore != null ? `${element.confidenceScore}% confidence` : 'no confidence stated',
      radius: 12,
      data: { type: 'extraction', element },
    });
    edges.push({ from: 'extraction', to: 'focus' });
  }

  const citations = element?.citations ?? sources.map((s) => ({ title: s.title, identifier: s.ids?.[0], url: s.url, sourceType: s.type }));
  citations.slice(0, 10).forEach((citation, index) => {
    const id = `src:${index}`;
    nodes.push({
      id,
      kind: 'doc',
      label: documentLabel(citation),
      sub: citation.identifier || citation.sourceType || 'cited source',
      radius: 9,
      sourceType: citation.sourceType,
      data: { type: 'citation', citation },
    });
    edges.push({ from: id, to: element ? 'extraction' : 'focus', faint: true });
  });

  if (!citations.length) {
    nodes.push({
      id: 'nosource',
      kind: 'sys',
      label: 'No public source',
      sub: 'attributed to the bundle',
      radius: 9,
      missing: true,
      data: { type: 'missing' },
    });
    edges.push({ from: 'nosource', to: 'focus', faint: true });
  }

  nodes.push({
    id: 'run',
    kind: 'sys',
    label: evaluation?.meta?.model ?? 'run',
    sub: evaluation?.meta?.effort ? `effort ${evaluation.meta.effort}` : 'run metadata',
    radius: 10,
    data: { type: 'run', meta: evaluation?.meta },
  });
  edges.push({ from: 'focus', to: 'run', faint: true });

  return { id: `claim:${claimText.slice(0, 40)}`, title: claimText, subtitle: node.data.label ?? 'provenance chain', nodes, edges, layout: 'sphere' };
}

/** The trial record, opened: the registry facts the whole run rests on. */
function trialSpec(trial) {
  const facts = [
    ['sponsor', trial.sponsor],
    ['phase', trial.phase],
    ['registry', trial.registry],
    ['modality', trial.modality],
    ['area', trial.therapeuticArea],
    ['status', trial.overallStatus],
    ['started', trial.startDate],
    ['condition', trial.condition],
  ].filter(([, value]) => value);

  const nodes = [
    { id: 'focus', kind: 'sys', label: trial.therapeuticName, sub: trial.trialId, radius: 22, center: true, data: { type: 'trial', trial } },
  ];
  const edges = [];
  facts.forEach(([key, value], index) => {
    const id = `f:${index}`;
    nodes.push({ id, kind: 'clip', label: String(value).slice(0, 40), sub: key, radius: 8, data: { type: 'fact', key, value } });
    edges.push({ from: 'focus', to: id, faint: true });
  });
  return { id: `trial:${trial.trialId}`, title: trial.therapeuticName, subtitle: trial.trialId, nodes, edges, layout: 'sphere' };
}

/** Every retrieval command in the run, grouped by the scope it searched. */
function retrievalSpec(sections) {
  const nodes = [{ id: 'focus', kind: 'clip', label: 'Paperclip', sub: `${sections.length} commands`, radius: 20, center: true, data: { type: 'retrieval', sections } }];
  const edges = [];
  const scopes = new Map();

  sections.slice(0, 40).forEach((section, index) => {
    const scope = section.source || 'search';
    if (!scopes.has(scope)) {
      const id = `sc:${scopes.size}`;
      scopes.set(scope, id);
      nodes.push({ id, kind: 'clip', label: scope, sub: 'scope', radius: 12, data: { type: 'scope', scope } });
      edges.push({ from: 'focus', to: id });
    }
    const id = `s:${index}`;
    nodes.push({
      id,
      kind: section.error ? 'risk' : 'doc',
      label: section.label ?? scope,
      sub: section.error ? 'failed' : `${Math.round((section.chars ?? 0) / 1000)}k`,
      radius: section.error ? 7 : clamp(5 + Math.sqrt(section.chars ?? 0) / 26, 5, 12),
      data: { type: 'command', section },
    });
    edges.push({ from: scopes.get(scope), to: id, faint: true });
  });

  return { id: 'retrieval:commands', title: 'Retrieval commands', subtitle: `${sections.length} Paperclip searches in this run`, nodes, edges, layout: 'sphere' };
}

/* -------------------------------------------------------------- the instance */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onSelect?: Function, onDescend?: Function, onEmpty?: Function, resolveSources?: Function}} hooks
 */
export function createEvidenceGraph(canvas, hooks = {}) {
  const context = { pipeline: null, trial: null, evaluation: null, rubric: null };
  const liveDocs = [];
  let stack = [];
  let graph = null;
  let selectedId = null;
  let hoverId = null;
  let pulses = [];

  const random = seededRandom(20260816);

  /* -- graph state ------------------------------------------------------- */

  function instantiate(spec, { preserve = null } = {}) {
    const count = spec.nodes.length;
    const spherePoints = spec.layout === 'sphere' ? fibonacciSphere(Math.max(1, count - 1), clamp(120 + count * 9, 150, 420)) : null;
    let sphereIndex = 0;

    const columns = new Map();
    for (const node of spec.nodes) {
      if (node.column == null) continue;
      const key = String(node.column);
      columns.set(key, (columns.get(key) ?? 0) + 1);
    }
    const columnSeen = new Map();

    const nodes = spec.nodes.map((node) => {
      let anchor;
      if (node.center) {
        anchor = { x: 0, y: 0, z: 0 };
      } else if (spherePoints) {
        anchor = spherePoints[sphereIndex++] ?? { x: 0, y: 0, z: 0 };
      } else {
        const key = String(node.column);
        const index = columnSeen.get(key) ?? (node.ring ? node.ring[0] : 0);
        columnSeen.set(key, index + 1);
        const total = node.ring ? node.ring[1] : columns.get(key) ?? 1;
        anchor = ringAnchor(node.column, index, total);
      }
      if (node.anchorOffset) {
        anchor = {
          x: anchor.x + node.anchorOffset.x,
          y: anchor.y + node.anchorOffset.y,
          z: anchor.z + node.anchorOffset.z,
        };
      }

      const prior = preserve?.get(node.id);
      return {
        ...node,
        anchor,
        x: prior?.x ?? anchor.x + (random() - 0.5) * 90,
        y: prior?.y ?? anchor.y + (random() - 0.5) * 90,
        z: prior?.z ?? anchor.z + (random() - 0.5) * 90,
        vx: 0,
        vy: 0,
        vz: 0,
        phase: random() * Math.PI * 2,
        born: prior?.born ?? performance.now(),
        state: node.state ?? prior?.state ?? 'idle',
        screen: { x: 0, y: 0, scale: 0, depth: 0, visible: false },
      };
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = spec.edges
      .map((edge) => ({ ...edge, a: byId.get(edge.from), b: byId.get(edge.to) }))
      .filter((edge) => edge.a && edge.b);

    return { ...spec, nodes, byId, edges };
  }

  function rebuild({ keepPositions = true } = {}) {
    const preserve = keepPositions && graph ? graph.byId : null;
    const spec = buildPipelineSpec({ ...context, liveDocs });
    const states = graph && graph.id === 'pipeline' ? new Map(graph.nodes.map((n) => [n.id, n.state])) : null;
    graph = instantiate(spec, { preserve });
    if (states) {
      for (const node of graph.nodes) {
        const prior = states.get(node.id);
        if (prior && node.state !== 'skip') node.state = prior;
      }
    }
    stack = [];
    hooks.onLevel?.(levels());
  }

  const levels = () => [
    { id: 'pipeline', title: context.trial ? context.trial.therapeuticName : 'Agent topology', subtitle: 'pipeline' },
    ...stack.map((entry) => ({ id: entry.spec.id, title: entry.spec.title, subtitle: entry.spec.subtitle })),
  ];

  /** Build the subgraph a node stands for, or null when it has nothing under it. */
  function subgraphFor(node) {
    const data = node.data ?? {};
    switch (data.type) {
      case 'document':
        return documentSpec(data.doc, context.evaluation);
      case 'domain':
        return domainSpec(node, context.evaluation, context.pipeline);
      case 'review':
      case 'report':
        return reviewSpec(context.evaluation?.review, context.rubric);
      case 'criterion':
        return domainSpec(
          { id: data.criterion.id, data: { domain: { id: data.criterion.id, label: data.criterion.label }, criterion: data.criterion } },
          context.evaluation,
          context.pipeline,
        );
      case 'element':
        return claimSpec({ ...node, data: { ...data, claim: data.element.finding, source: '', label: data.element.element } }, context.evaluation, hooks.resolveSources);
      case 'claim':
        return claimSpec(node, context.evaluation, hooks.resolveSources);
      case 'trial':
        return data.trial ? trialSpec(data.trial) : null;
      case 'retrieval':
        return data.sections?.length ? retrievalSpec(data.sections) : null;
      case 'dossier':
        return data.dossier?.domains?.length
          ? {
              id: 'dossier:domains',
              title: 'Cited evidence dossier',
              subtitle: `${data.dossier.domains.length} domains`,
              layout: 'sphere',
              nodes: [
                { id: 'focus', kind: 'claude', label: 'CLARITY dossier', sub: data.dossier.phaseLabel || data.dossier.phase || '', radius: 20, center: true, data },
                ...data.dossier.domains.map((domain, index) => ({
                  id: `d:${index}`,
                  kind: 'claude',
                  label: short(domain.domainId, domain.domainLabel),
                  sub: `${(domain.elements ?? []).length} elements`,
                  radius: clamp(7 + (domain.elements ?? []).length * 1.4, 7, 16),
                  expandable: true,
                  data: { type: 'domain', domain: { id: domain.domainId, label: domain.domainLabel }, criterion: (context.evaluation?.review?.criteria ?? []).find((c) => c.id === domain.domainId) },
                })),
              ],
              edges: data.dossier.domains.map((_, index) => ({ from: 'focus', to: `d:${index}` })),
            }
          : null;
      default:
        return null;
    }
  }

  function descend(node) {
    const spec = subgraphFor(node);
    if (!spec || !spec.nodes.length) return false;
    stack.push({ spec, parent: node.id });
    graph = instantiate(spec);
    for (const child of graph.nodes) child.state = child.center ? 'active' : 'done';
    selectedId = 'focus';
    // Every subgraph is built around the origin, so a camera the reader has
    // panned somewhere else has to come back or the new level opens off-screen.
    stage?.setTarget(0, 0, 0);
    stage?.setDistance(clamp(320 + graph.nodes.length * 11, 360, 1100));
    hooks.onLevel?.(levels());
    hooks.onSelect?.(graph.byId.get('focus') ?? null, levels());
    return true;
  }

  function ascend(toIndex = null) {
    if (!stack.length) return;
    if (toIndex == null || toIndex <= 0) {
      stack = [];
      rebuild({ keepPositions: false });
    } else {
      stack = stack.slice(0, toIndex);
      const top = stack[stack.length - 1];
      graph = instantiate(top.spec);
      for (const child of graph.nodes) child.state = child.center ? 'active' : 'done';
    }
    selectedId = null;
    stage?.setTarget(0, 0, 0);
    stage?.setDistance(stack.length ? 620 : 1000);
    hooks.onLevel?.(levels());
    hooks.onSelect?.(null, levels());
  }

  /* -- simulation --------------------------------------------------------- */

  function simulate(dt, time) {
    if (!graph) return;
    const nodes = graph.nodes;
    const n = nodes.length;
    // Repulsion is O(n²). The graphs here top out in the low hundreds, and the
    // cap keeps a pathological dossier from turning the tab into a heater.
    const repel = n > 260 ? 0 : 2600;

    for (let i = 0; i < n; i += 1) {
      const a = nodes[i];
      if (repel) {
        for (let j = i + 1; j < n; j += 1) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dz = a.z - b.z;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1) {
            dx = (random() - 0.5) * 2;
            dy = (random() - 0.5) * 2;
            dz = (random() - 0.5) * 2;
            d2 = 1;
          }
          if (d2 > 260000) continue;
          const force = repel / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          const fz = (dz / d) * force;
          a.vx += fx;
          a.vy += fy;
          a.vz += fz;
          b.vx -= fx;
          b.vy -= fy;
          b.vz -= fz;
        }
      }

      // Anchors carry the meaning — the pipeline reads left to right whatever the
      // forces do, so the spring back to the anchor is never allowed to lose.
      a.vx += (a.anchor.x - a.x) * 0.055;
      a.vy += (a.anchor.y - a.y) * 0.055;
      a.vz += (a.anchor.z - a.z) * 0.055;

      // The breath. Deterministic per node, so nothing jitters randomly.
      const wobble = a.state === 'active' ? 1.9 : 0.7;
      a.vx += Math.sin(time * 0.7 + a.phase) * wobble * 0.5;
      a.vy += Math.cos(time * 0.53 + a.phase * 1.7) * wobble * 0.5;
      a.vz += Math.sin(time * 0.41 + a.phase * 2.3) * wobble * 0.5;
    }

    for (const edge of graph.edges) {
      const dx = edge.b.x - edge.a.x;
      const dy = edge.b.y - edge.a.y;
      const dz = edge.b.z - edge.a.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const rest = graph.layout === 'sphere' ? 210 : 150;
      const k = 0.0016 * (edge.weight ?? 1);
      const force = (d - rest) * k;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      const fz = (dz / d) * force;
      edge.a.vx += fx;
      edge.a.vy += fy;
      edge.a.vz += fz;
      edge.b.vx -= fx;
      edge.b.vy -= fy;
      edge.b.vz -= fz;
    }

    const damping = 0.86;
    const step = clamp(dt * 60, 0.2, 1.6);
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.vz *= damping;
      const speed = Math.hypot(node.vx, node.vy, node.vz);
      if (speed > 26) {
        const scale = 26 / speed;
        node.vx *= scale;
        node.vy *= scale;
        node.vz *= scale;
      }
      node.x += node.vx * step;
      node.y += node.vy * step;
      node.z += node.vz * step;
    }
  }

  /* -- rendering ---------------------------------------------------------- */

  const colorFor = (node) =>
    (node.tone ? TONE_COLOR[node.tone] : node.sourceType ? SOURCE_COLOR[node.sourceType] : null) ??
    AGENT_COLOR[node.kind] ??
    PALETTE.faint;

  function sampleEdge(edge, project, steps = 6) {
    // Sampling the curve in world space (not screen space) keeps the bow correct
    // under perspective — a straight screen-space bezier bends the wrong way.
    const points = [];
    const mx = (edge.a.x + edge.b.x) / 2;
    const my = (edge.a.y + edge.b.y) / 2;
    const mz = (edge.a.z + edge.b.z) / 2;
    const bow = 0.14;
    const cx = mx + (my === 0 ? 0 : my * bow);
    const cy = my * (1 + bow);
    const cz = mz * (1 + bow);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * edge.a.x + 2 * u * t * cx + t * t * edge.b.x;
      const y = u * u * edge.a.y + 2 * u * t * cy + t * t * edge.b.y;
      const z = u * u * edge.a.z + 2 * u * t * cz + t * t * edge.b.z;
      points.push(project(x, y, z));
    }
    return points;
  }

  const TAU = Math.PI * 2;

  /**
   * Draw the connection between two pipeline stages as a length of double helix
   * rather than a line.
   *
   * This is not ornament for its own sake. The thing being modelled is a genomic
   * medicine, and the reader is a person who reads sequence maps for a living —
   * a backbone with base pairs is the notation they already have in their hands.
   * The winding is computed per sample from the screen-space tangent, so it stays
   * correct as the camera turns, and each rung dims as it rotates edge-on, which
   * is what gives the strand its depth for free.
   */
  function drawHelix(ctx, points, { color, alpha, turns, phase, amplitude, rungEvery, lineWidth }) {
    const count = points.length;
    if (count < 3) return;

    const strandA = [];
    const strandB = [];

    for (let i = 0; i < count; i += 1) {
      const previous = points[Math.max(0, i - 1)];
      const next = points[Math.min(count - 1, i + 1)];
      let tx = next.x - previous.x;
      let ty = next.y - previous.y;
      const length = Math.hypot(tx, ty) || 1;
      tx /= length;
      ty /= length;

      const t = i / (count - 1);
      const angle = phase + t * TAU * turns;
      const swing = Math.sin(angle) * amplitude;
      // Perpendicular to the path in screen space.
      strandA.push({ x: points[i].x - ty * swing, y: points[i].y + tx * swing, depth: Math.cos(angle) });
      strandB.push({ x: points[i].x + ty * swing, y: points[i].y - tx * swing, depth: -Math.cos(angle) });
    }

    // Rungs first, so the strands read as passing in front of them.
    for (let i = rungEvery; i < count - 1; i += rungEvery) {
      const face = Math.abs(strandA[i].depth);
      if (face < 0.15) continue;
      ctx.beginPath();
      ctx.moveTo(strandA[i].x, strandA[i].y);
      ctx.lineTo(strandB[i].x, strandB[i].y);
      ctx.strokeStyle = color(alpha * face * 0.5);
      ctx.lineWidth = lineWidth * 0.8;
      ctx.stroke();
    }

    for (const strand of [strandA, strandB]) {
      ctx.beginPath();
      ctx.moveTo(strand[0].x, strand[0].y);
      for (let i = 1; i < count; i += 1) ctx.lineTo(strand[i].x, strand[i].y);
      ctx.strokeStyle = color(alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  function edgeState(edge) {
    const from = edge.a.state;
    const to = edge.b.state;
    if (edge.a.state === 'skip' || edge.b.state === 'skip') return 'idle';
    if (to === 'active') return 'active';
    if (from === 'done' && to === 'done') return 'done';
    if (from === 'done' && to === 'idle') return 'active';
    return 'idle';
  }

  function neighbourhood(id) {
    if (!id || !graph) return null;
    const set = new Set([id]);
    for (const edge of graph.edges) {
      if (edge.from === id) set.add(edge.to);
      if (edge.to === id) set.add(edge.from);
    }
    return set;
  }

  function draw(ctx, frame) {
    if (!graph) return;
    simulate(frame.dt, frame.time);

    const now = performance.now();
    const focus = neighbourhood(selectedId ?? hoverId);

    for (const node of graph.nodes) {
      node.screen = frame.project(node.x, node.y, node.z);
      const age = clamp((now - node.born) / SPAWN_MS, 0, 1);
      node.grow = easeOut(age);
    }

    // Edges first, back to front, so nodes always read in front of their wiring.
    const edges = [...graph.edges].sort(
      (p, q) => (q.a.screen.depth + q.b.screen.depth) / 2 - (p.a.screen.depth + p.b.screen.depth) / 2,
    );

    for (const edge of edges) {
      if (!edge.a.screen.visible || !edge.b.screen.visible) continue;
      const state = edgeState(edge);
      const dim = focus && !(focus.has(edge.from) && focus.has(edge.to)) ? 0.22 : 1;
      // A filament between a document and its domain stays a filament; only the
      // pipeline's own backbone is drawn as duplex.
      const duplex = !edge.faint;
      const points = sampleEdge(edge, frame.project, duplex ? 26 : 6);
      if (points.some((point) => !point.visible)) continue;

      const alpha = depthAlpha((edge.a.screen.depth + edge.b.screen.depth) / 2) * dim * Math.min(edge.a.grow, edge.b.grow);
      const color = state === 'active' ? PALETTE.clip : state === 'done' ? PALETTE.benchDeep : PALETTE.ghost;

      if (duplex) {
        const scale = (edge.a.screen.scale + edge.b.screen.scale) / 2;
        const span = Math.hypot(edge.b.screen.x - edge.a.screen.x, edge.b.screen.y - edge.a.screen.y);
        drawHelix(ctx, points, {
          color,
          alpha: alpha * 0.62,
          // Roughly one turn per 46 screen pixels keeps the pitch constant as the
          // camera pulls back, instead of unwinding with distance.
          turns: clamp(span / 46, 1.5, 9),
          phase: frame.reduced ? 0 : frame.time * 1.1 + edge.a.phase,
          amplitude: clamp(4.6 * scale * 1.4, 1.8, 7),
          rungEvery: 2,
          lineWidth: state === 'active' ? 1.5 : 1.05,
        });
      } else {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
        ctx.strokeStyle = color(alpha * 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // A packet running the wire while the downstream node is working. This is
      // the same signal the console prints, drawn where the work is happening.
      if (state === 'active' && !frame.reduced) {
        for (let k = 0; k < 2; k += 1) {
          const t = (frame.time * 0.55 + k * 0.5 + edge.a.phase * 0.1) % 1;
          const index = t * (points.length - 1);
          const i0 = Math.floor(index);
          const i1 = Math.min(points.length - 1, i0 + 1);
          const local = index - i0;
          const px = lerp(points[i0].x, points[i1].x, local);
          const py = lerp(points[i0].y, points[i1].y, local);
          glow(ctx, px, py, 9, PALETTE.clip, alpha);
          disc(ctx, px, py, 1.8, PALETTE.ink(alpha));
        }
      }
    }

    // Ripples left by newly attached evidence.
    pulses = pulses.filter((pulse) => now - pulse.at < 900);
    for (const pulse of pulses) {
      const node = graph.byId.get(pulse.id);
      if (!node?.screen.visible) continue;
      const t = (now - pulse.at) / 900;
      const radius = (12 + t * 46) * node.screen.scale * 1.6;
      ctx.beginPath();
      ctx.arc(node.screen.x, node.screen.y, Math.max(1, radius), 0, Math.PI * 2);
      ctx.strokeStyle = colorFor(node)((1 - t) * 0.5);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    const ordered = [...graph.nodes].sort((a, b) => b.screen.depth - a.screen.depth);
    for (const node of ordered) {
      if (!node.screen.visible) continue;
      const { x, y, scale } = node.screen;
      const dim = focus && !focus.has(node.id) ? 0.26 : 1;
      const alpha = depthAlpha(node.screen.depth) * dim * node.grow;
      if (alpha < 0.03) continue;

      const color = colorFor(node);
      const radius = Math.max(1.6, node.radius * scale * 1.35 * node.grow);
      const isSelected = node.id === selectedId;
      const isHover = node.id === hoverId;
      const pulse = node.state === 'active' && !frame.reduced ? 1 + Math.sin(frame.time * 3.4 + node.phase) * 0.14 : 1;

      if (node.state !== 'idle' || isHover || isSelected) {
        glow(ctx, x, y, radius * (isSelected ? 6.5 : 4.2) * pulse, color, alpha * (node.state === 'active' ? 1 : 0.6));
      }

      if (node.state === 'skip' || node.missing) {
        ctx.save();
        ctx.setLineDash([3, 3]);
        disc(ctx, x, y, radius, null, color(alpha * 0.5), 1);
        ctx.restore();
      } else {
        disc(ctx, x, y, radius * pulse, color(alpha * (node.state === 'idle' ? 0.16 : 0.34)), color(alpha * 0.95), isSelected ? 2 : 1.2);
        disc(ctx, x, y, radius * 0.36, color(alpha));
      }

      // Working nodes wear a sweeping arc: a progress indicator, not a spinner.
      if (node.state === 'active' && !frame.reduced) {
        const start = frame.time * 2.6 + node.phase;
        ctx.beginPath();
        ctx.arc(x, y, radius * 1.9, start, start + 1.5);
        ctx.strokeStyle = color(alpha * 0.8);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = PALETTE.ink(alpha * 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const showLabel = isHover || isSelected || node.center || (scale > 0.55 && node.radius >= 10) || (scale > 0.9 && node.radius >= 6);
      if (showLabel) {
        const text = String(node.label ?? '');
        const trimmed = text.length > 30 ? `${text.slice(0, 29)}…` : text;
        drawLabel(ctx, trimmed, x, y + radius + 11, {
          size: clamp(11 * scale * 1.25, 9, 14),
          color: PALETTE.ink(),
          alpha: alpha * (isHover || isSelected ? 1 : 0.85),
          weight: isSelected ? 600 : 500,
        });
        if (node.sub) {
          drawLabel(ctx, String(node.sub), x, y + radius + 11 + clamp(11 * scale, 9, 13), {
            size: clamp(9 * scale * 1.2, 8, 11),
            color: color(0.85),
            alpha: alpha * 0.85,
            mono: true,
          });
        }
      }

      if (node.expandable && (isHover || isSelected)) {
        drawLabel(ctx, '⤢', x + radius + 9, y - radius - 4, { size: 11, color: PALETTE.ink(0.7), alpha });
      }
    }
  }

  /* -- picking ------------------------------------------------------------ */

  function pick(px, py) {
    if (!graph || px < 0) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const node of graph.nodes) {
      if (!node.screen.visible) continue;
      const radius = Math.max(9, node.radius * node.screen.scale * 1.6);
      const distance = Math.hypot(node.screen.x - px, node.screen.y - py);
      if (distance <= radius + 6 && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  const stage = createStage(canvas, {
    draw,
    // Shallow yaw so the fan-out stays readable as a pipeline, and a slow drift
    // rather than a spin — the graph should look alive, not busy.
    yaw: -0.28,
    pitch: -0.16,
    distance: 1320,
    // Close enough to sit inside a single node, far enough to hold a dossier of
    // several hundred. The reader decides which; the stage does not cap them.
    minDistance: 45,
    maxDistance: 26000,
    autoRotate: 0.018,
    onPointerMove: (x, y) => {
      const node = pick(x, y);
      const id = node?.id ?? null;
      if (id !== hoverId) {
        hoverId = id;
        canvas.style.cursor = node ? (node.expandable ? 'zoom-in' : 'pointer') : 'grab';
        hooks.onHover?.(node);
      }
    },
    onClick: (x, y) => {
      const node = pick(x, y);
      selectedId = node?.id ?? null;
      hooks.onSelect?.(node, levels());
    },
    onDoubleClick: (x, y) => {
      const node = pick(x, y);
      if (node && !descend(node)) hooks.onSelect?.(node, levels());
    },
  });

  if (!stage) return null;

  rebuild({ keepPositions: false });

  /* -- public surface ----------------------------------------------------- */

  function setState(id, state) {
    const node = graph?.byId.get(id);
    if (!node || node.state === 'skip') return;
    node.state = state;
  }

  return {
    stage,
    setPipeline(pipeline) {
      context.pipeline = pipeline;
      rebuild();
    },
    setRubric(rubric) {
      context.rubric = rubric;
    },
    setTrial(trial) {
      context.trial = trial;
      liveDocs.length = 0;
      rebuild({ keepPositions: false });
    },
    setEvaluation(evaluation) {
      context.evaluation = evaluation;
      rebuild();
      if (evaluation?.review) this.completeAll();
    },
    /** A retrieval event: one more paperclip on the board. */
    addLiveSection(section) {
      if (!section?.key) return;
      if (liveDocs.some((doc) => doc.key === section.key)) return;
      liveDocs.push(section);
      rebuild();
      pulses.push({ id: `live:${section.key}`, at: performance.now() });
    },
    activate: (id) => setState(id, 'active'),
    complete(id) {
      setState(id, 'done');
      if (graph?.byId.has(id)) pulses.push({ id, at: performance.now() });
    },
    completeAll() {
      for (const node of graph?.nodes ?? []) if (node.state !== 'skip') node.state = 'done';
    },
    reset() {
      for (const node of graph?.nodes ?? []) if (node.state !== 'skip') node.state = 'idle';
      liveDocs.length = 0;
      pulses = [];
      rebuild({ keepPositions: false });
    },
    select(id) {
      selectedId = graph?.byId.has(id) ? id : null;
      hooks.onSelect?.(graph?.byId.get(selectedId) ?? null, levels());
    },
    /**
     * Where a node currently is, in viewport coordinates. The crew overlay needs
     * this to walk between nodes that are themselves still moving.
     */
    screenPointOf(id) {
      const node = graph?.byId.get(id);
      if (!node?.screen?.visible) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + node.screen.x, y: rect.top + node.screen.y };
    },
    hasNode: (id) => Boolean(graph?.byId.has(id)),
    descendById(id) {
      const node = graph?.byId.get(id);
      return node ? descend(node) : false;
    },
    descendSelected() {
      const node = graph?.byId.get(selectedId);
      return node ? descend(node) : false;
    },
    ascend,
    levels,
    /** Put the camera back where the stage opened, keeping the current level. */
    resetView() {
      stage?.resetView();
    },
    get depth() {
      return stack.length;
    },
    get nodeCount() {
      return graph?.nodes.length ?? 0;
    },
    destroy() {
      stage.destroy();
    },
  };
}
