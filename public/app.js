// CLARITY — the workstation.
//
// One surface. The stage is the live evidence graph, the left dock is the
// catalog, the right inspector is the report, and the console underneath is the
// run as it happens. Everything on all four is the same object seen from a
// different distance: select a programme in the dock and its node lights on the
// stage; open a node on the stage and the inspector follows it down.
//
// The report itself is unchanged in substance. Every score still carries its
// proof chain, every finding still carries its citation, and nothing is rendered
// that the run did not produce.

import { SOURCE_TYPE_LABEL, citationIndex, inferType, parseSources, safeHttpsUrl } from './citations.js';
import { createEvidenceGraph } from './lab/graph3d.js';
import { setStageTheme } from './lab/engine3d.js';
import { createCrew } from './lab/agents.js';
import { createConstructViewer } from './lab/genome3d.js';
import { createPipelineGraph } from './lab/graph.js';
import { renderGeneModel } from './lab/genome.js';
import { enableGrounding, proveClaim, proveDomain, proveProbability, registerPipeline } from './lab/proof.js';
import {
  benchmarkDomains,
  benchmarkStrip,
  calibrationBridge,
  completenessFormula,
  computeCompleteness,
  contributionMatrix,
  weightFor,
  weightedScoreFormula,
} from './lab/metrics.js';
import {
  CONFIDENCE_TONE,
  ICON_CARET,
  ICON_EXTERNAL,
  PRIORITY_TONE,
  SEVERITY_TONE,
  STRENGTH_TONE,
  chip,
  clampText,
  esc,
  fmtDate,
  num,
  pct,
  proofButton,
  scorePips,
  scoreTone,
} from './lab/ui.js';

/* --------------------------------------------------------------------- state */

const state = {
  trials: [],
  facets: null,
  catalogMeta: null,
  pipeline: null,
  rubric: null,
  benchmarks: null,
  selected: null,
  evaluation: null,
  geneModel: null,
  running: false,
  stream: null,
  activeIndex: -1,
  tab: 'review',
  selection: null,
  matrixCell: null,
  counters: { paperclip: 0, claude: 0 },
  captureFullTrace: readFlag('fdaapproval.captureFullTrace', false),
  crewEnabled: readFlag('fdaapproval.crew', true),
  theme: readTheme(),
  focus: false,
};

function readTheme() {
  try {
    const stored = localStorage.getItem('fdaapproval.theme');
    return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function readFlag(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw === 'true';
  } catch {
    // Private-mode browsers throw on storage access; a preference is not worth a crash.
    return fallback;
  }
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* preference simply does not persist */
  }
}

const el = {};
const ids = [
  'status-strip', 'trial-search', 'trial-pop', 'filter-phase', 'filter-area', 'catalog-meta',
  'pipeline-matrix', 'matrix-meta', 'selected-trial', 'run-review',
  'graph-canvas', 'graph-fallback', 'breadcrumbs', 'hud-counters',
  'progress-log', 'console-shell', 'console-toggle', 'console-body', 'console-state',
  'inspector', 'inspector-body', 'inspector-selection', 'capture-full-trace', 'toggle-crew',
  'crew-layer', 'dock', 'stage', 'pane-bar',
];
for (const id of ids) el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id);

let graph = null;
let crew = null;
let constructViewer = null;

/* ------------------------------------------------------------------- helpers */

const debounce = (fn, ms = 160) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

async function getJSON(url, { signal } = {}) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.message || res.statusText || 'Request failed'), { body, status: res.status });
  }
  return body;
}

function tokenCount(evaluation) {
  const usage = evaluation?.meta?.usage ?? {};
  const dossier = evaluation?.meta?.usageByStage?.dossier ?? {};
  return ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens']
    .reduce((sum, key) => sum + Number(usage[key] ?? 0) + Number(dossier[key] ?? 0), 0);
}

const rubricWeight = (criterion) => weightFor(criterion, state.rubric);

function sourcePill(source) {
  const identifiers = source.ids?.length ? source.ids.join(' · ') : '';
  const tip = esc([source.type, source.title, source.note, identifiers].filter(Boolean).join(' — '));
  const sameAsTitle = String(source.title).trim().toLowerCase() === String(source.type).toLowerCase();
  const body = `${sameAsTitle ? '' : `<span class="text-ghost">${esc(source.type)}</span>`}<span class="max-w-[30ch] truncate">${esc(source.title)}</span>`;
  return source.url
    ? `<a class="src-link" href="${esc(source.url)}" target="_blank" rel="noreferrer noopener" title="${tip}">${body}${ICON_EXTERNAL}</a>`
    : `<span class="src-plain" title="${tip}">${body}</span>`;
}

function sourceRow(sourceText, index) {
  const sources = parseSources(sourceText, index);
  if (!sources.length) return '';
  const orphans = sources.filter((s) => !s.url).flatMap((s) => s.ids ?? []).filter(Boolean);
  return `<div class="mt-1.5 flex flex-wrap items-center gap-1">
    ${sources.map(sourcePill).join('')}
    ${orphans.length ? `<span class="src-id">${esc(orphans.join(' · '))}</span>` : ''}
  </div>`;
}

const claimPayload = (domainId, claim, source, label) => JSON.stringify({ domainId, claim, source, label });

function fillSelect(select, values, anyLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${esc(anyLabel)}</option>${values
    .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
    .join('')}`;
  if (values.includes(current)) select.value = current;
}

/* -------------------------------------------------------------------- status */

function renderStatus(health) {
  state.health = health;
  const chips = [
    health.keys?.paperclip ? chip('Paperclip live', 'clip') : chip('Paperclip missing', 'stop'),
    health.keys?.anthropic ? chip(`Claude ${health.model}`, 'claude') : chip('Claude missing', 'stop'),
  ];
  if (health.benchling?.reachable) chips.push(chip('Benchling live', 'bench'));
  else if (health.benchling?.configured) chips.push(chip('Benchling configured', 'gap'));
  else chips.push(chip('Derived structures', 'unknown'));
  if (health.modal?.tasks?.ground?.configured) chips.push(chip('Modal grounding', 'clip'));
  if (health.modal?.tasks?.fold?.configured) chips.push(chip('Modal folding', 'bench'));
  enableGrounding(Boolean(health.modal?.tasks?.ground?.configured));
  if (health.runs && health.runs.enabled === false) chips.push(chip('Cached reviews only', 'gap'));
  el.statusStrip.innerHTML = chips.join('');
  renderSelectedTrial();
}

/** Runs cost money; a deployment can switch them off and still serve every report. */
const runsAllowed = () => state.health?.runs?.enabled !== false;

/**
 * The pitch, in the reading pane rather than over the graph. It used to be a
 * hero overlay on the stage, which meant the display type sat directly on top of
 * the topology it was describing — the one thing on the page worth looking at.
 */
function welcomeCard() {
  const stats = [
    ['Trials', num(state.catalogMeta?.total ?? 0)],
    ['CLARITY domains', state.pipeline?.domains?.length ?? '—'],
    ['Rubric', `v${state.pipeline?.rubricVersion ?? '—'}`],
    ['Dossier', `v${state.pipeline?.dossierVersion ?? '—'}`],
  ];
  return `
    <section class="panel panel-lit panel-pad rise">
      <p class="eyebrow">Track A · end-to-end agentic science</p>
      <h2 class="headline mt-3">
        Regulatory review,<br /><span class="display-accent">with the receipts.</span>
      </h2>
      <p class="mt-4 text-[13px] leading-relaxed text-muted">
        CLARITY retrieves the public evidence for a clinical programme, organises it into a cited
        nine-domain dossier, and scores it the way an FDA reviewer would. Every score, every finding
        and every probability traces back to the source document — and to the exact retrieval command
        that found it.
      </p>
      <dl class="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        ${stats
          .map(([label, value]) => `<div><dt class="label">${esc(label)}</dt><dd class="counter mt-1 text-lg text-ink">${esc(value)}</dd></div>`)
          .join('')}
      </dl>
      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" class="btn-primary !px-3.5 !py-1.5 !text-[12px]" data-focus-search>
          Pick a programme
          <svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <button type="button" class="btn-ghost !px-3.5 !py-1.5 !text-[12px]" data-open-method>How the pipeline works</button>
      </div>
      <p class="mt-4 text-[11px] leading-relaxed text-ghost">
        The stage to the left is the agent topology at rest. Drag to orbit it; it will light in the
        order the server works once a review runs.
      </p>
    </section>`;
}

function renderCounters() {
  if (!el.hudCounters) return;
  const rows = [
    ['paperclip', state.counters.paperclip, 'text-clip-400'],
    ['claude', state.counters.claude, 'text-claude-400'],
    ['tokens', tokenCount(state.evaluation).toLocaleString(), 'text-bench-400'],
    ['nodes', graph?.nodeCount ?? 0, 'text-ink'],
  ];
  el.hudCounters.innerHTML = rows
    .map(([label, value, tone]) => `<span class="hud-counter"><i class="label">${esc(label)}</i><b class="counter ${tone}">${esc(value)}</b></span>`)
    .join('');
}

/* -------------------------------------------------------------- the pipeline */

const PHASE_ORDER = ['Early Phase 1', 'Phase 1', 'Phase 1/2', 'Phase 2', 'Phase 2/3', 'Phase 3', 'Not Applicable'];
const PHASE_SHORT = {
  'Early Phase 1': 'EP1',
  'Phase 1': 'P1',
  'Phase 1/2': 'P1/2',
  'Phase 2': 'P2',
  'Phase 2/3': 'P2/3',
  'Phase 3': 'P3',
  'Not Applicable': 'N/A',
};

/**
 * The catalog as a matrix rather than a list. A clinical pipeline is a grid of
 * programmes against phase; drawing it that way makes the shape of the portfolio
 * legible before a single programme is opened.
 */
function renderPipelineMatrix() {
  if (!el.pipelineMatrix) return;
  const trials = state.allTrials ?? [];
  if (!trials.length) {
    el.pipelineMatrix.innerHTML = '<p class="text-[11px] text-faint">Catalog unavailable.</p>';
    return;
  }

  const phases = PHASE_ORDER.filter((phase) => trials.some((trial) => trial.phase === phase));
  const areas = [...new Set(trials.map((trial) => trial.therapeuticArea || 'Unassigned'))].sort();
  const cell = (area, phase) => trials.filter((t) => (t.therapeuticArea || 'Unassigned') === area && t.phase === phase).length;
  const max = Math.max(...areas.flatMap((area) => phases.map((phase) => cell(area, phase))), 1);

  el.matrixMeta.textContent = `${areas.length} areas · ${phases.length} phases`;
  el.pipelineMatrix.innerHTML = `
    <div class="matrix-grid" style="--cols:${phases.length}">
      <span></span>
      ${phases.map((phase) => `<span class="matrix-col" title="${esc(phase)}">${esc(PHASE_SHORT[phase] ?? phase)}</span>`).join('')}
      ${areas
        .map(
          (area) => `<span class="matrix-area" title="${esc(area)}">${esc(clampText(area, 16))}</span>
          ${phases
            .map((phase) => {
              const count = cell(area, phase);
              const active = state.matrixCell?.area === area && state.matrixCell?.phase === phase;
              return `<button type="button" class="matrix-cell${active ? ' is-active' : ''}"
                ${count ? '' : 'disabled'}
                data-area="${esc(area)}" data-phase="${esc(phase)}"
                style="--fill:${count ? 0.12 + (count / max) * 0.68 : 0}"
                aria-label="${esc(`${area}, ${phase}: ${count} programmes`)}">${count || ''}</button>`;
            })
            .join('')}`,
        )
        .join('')}
    </div>
    <div id="matrix-list" class="mt-3 space-y-1"></div>`;

  el.pipelineMatrix.querySelectorAll('.matrix-cell').forEach((button) => {
    button.addEventListener('click', () => {
      const { area, phase } = button.dataset;
      const same = state.matrixCell?.area === area && state.matrixCell?.phase === phase;
      state.matrixCell = same ? null : { area, phase };
      renderPipelineMatrix();
      renderMatrixList();
    });
  });
  renderMatrixList();
}

function renderMatrixList() {
  const mount = document.getElementById('matrix-list');
  if (!mount) return;
  if (!state.matrixCell) {
    mount.innerHTML = '<p class="text-[11px] leading-relaxed text-ghost">Select a cell to list its programmes.</p>';
    return;
  }
  const { area, phase } = state.matrixCell;
  const rows = (state.allTrials ?? []).filter(
    (trial) => (trial.therapeuticArea || 'Unassigned') === area && trial.phase === phase,
  );
  mount.innerHTML = rows
    .slice(0, 40)
    .map(
      (trial) => `<button type="button" class="matrix-item" data-id="${esc(trial.trialId)}">
        <span class="truncate text-[12px] text-ink">${esc(trial.therapeuticName)}</span>
        <span class="truncate font-mono text-[10px] text-ghost">${esc(trial.sponsor)}</span>
      </button>`,
    )
    .join('');
  mount.querySelectorAll('.matrix-item').forEach((button) => {
    button.addEventListener('click', () => selectTrial(button.dataset.id));
  });
}

/* ---------------------------------------------------------------- data loads */

async function loadHealth() {
  try {
    renderStatus(await getJSON('/api/health'));
  } catch {
    el.statusStrip.innerHTML = chip('Server unreachable', 'stop');
  }
}

async function loadPipeline() {
  state.pipeline = await getJSON('/api/pipeline').catch(() => null);
  state.rubric = await getJSON('/api/rubric').catch(() => null);
  if (state.pipeline) registerPipeline(state.pipeline);
  graph?.setPipeline(state.pipeline);
  graph?.setRubric(state.rubric);
  renderFallbackGraph();
  renderCounters();
  if (!state.selected || state.tab === 'method') renderInspector();
}

async function loadBenchmarks() {
  state.benchmarks = await getJSON('/api/benchmarks').catch(() => null);
  if (state.tab === 'benchmarks') renderInspector();
}

async function loadCatalog() {
  const params = new URLSearchParams();
  const query = el.trialSearch.value.trim();
  if (query && !state.selected) params.set('q', query);
  if (el.filterPhase.value) params.set('phase', el.filterPhase.value);
  if (el.filterArea.value) params.set('area', el.filterArea.value);

  try {
    const data = await getJSON(`/api/trials?${params}`);
    state.trials = data.trials;
    state.catalogMeta = data;
    if (!state.facets) {
      state.facets = data.facets;
      fillSelect(el.filterPhase, data.facets.phases, 'Any phase');
      fillSelect(el.filterArea, data.facets.areas, 'Any area');
    }
    if (!state.allTrials || !params.toString()) {
      state.allTrials = data.trials;
      renderPipelineMatrix();
    }
    el.catalogMeta.textContent = `${data.count} of ${data.total} trials · ${fmtDate(data.generatedAt)}`;
    if (!state.selected) renderInspector();
    renderCombo();
  } catch (err) {
    state.trials = [];
    el.catalogMeta.textContent = err.message;
    el.trialPop.innerHTML = `<p class="p-3 text-[12px] text-gap">${esc(err.message)}</p>`;
  }
}

/* ------------------------------------------------------------------- combobox */

function renderCombo() {
  const rows = state.trials.slice(0, 12);
  if (!rows.length) {
    el.trialPop.innerHTML = '<p class="p-3 text-[12px] text-faint">No trials match.</p>';
    return;
  }
  el.trialPop.innerHTML = `<div class="combo-list">${rows
    .map(
      (trial, index) => `<div class="combo-item" role="option" aria-selected="false" data-index="${index}" data-id="${esc(trial.trialId)}" tabindex="-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-[13px] font-semibold text-ink">${esc(trial.therapeuticName)}</p>
            <p class="mt-0.5 truncate text-[11px] text-faint">${esc(trial.sponsor)} · ${esc(trial.condition || trial.therapeuticArea || '')}</p>
          </div>
          <span class="shrink-0 font-mono text-[10px] uppercase text-ghost">${esc(trial.phase)}</span>
        </div>
        <p class="mt-1 font-mono text-[10px] text-ghost">${esc(trial.trialId)} · ${esc(trial.modality || 'Unknown')}</p>
      </div>`,
    )
    .join('')}</div>`;
}

function openCombo() {
  el.trialPop.classList.remove('hidden');
  el.trialSearch.setAttribute('aria-expanded', 'true');
}

function closeCombo() {
  el.trialPop.classList.add('hidden');
  el.trialSearch.setAttribute('aria-expanded', 'false');
  state.activeIndex = -1;
}

/* --------------------------------------------------------------- selection */

async function selectTrial(trialId) {
  if (!trialId) return;
  const local = state.trials.find((t) => t.trialId === trialId) ?? state.allTrials?.find((t) => t.trialId === trialId);
  let trial = local;
  if (!trial) {
    trial = await getJSON(`/api/trials/${encodeURIComponent(trialId)}`).then((body) => body.trial).catch(() => null);
  }
  if (!trial) return;

  state.stream?.close();
  state.stream = null;
  state.running = false;
  state.selected = trial;
  state.evaluation = null;
  state.geneModel = null;
  state.selection = null;
  state.runError = null;
  state.counters = { paperclip: 0, claude: 0 };

  el.trialSearch.value = `${trial.therapeuticName} · ${trial.trialId}`;
  closeCombo();
  setConsoleState('ready');
  clearConsole();

  graph?.setTrial(trial);
  graph?.select('trial');
  renderSelectedTrial();
  renderCounters();
  renderInspector();
  showPane('stage');

  getJSON(`/api/evaluations/${encodeURIComponent(trial.trialId)}`)
    .then((evaluation) => {
      if (state.selected?.trialId !== trial.trialId) return;
      state.evaluation = evaluation;
      graph?.setEvaluation(evaluation);
      appendConsole('sys', 'cached review loaded; graph replay complete');
      setConsoleState('cached');
      renderCounters();
      renderInspector();
    })
    .catch(() => {
      if (state.selected?.trialId !== trial.trialId) return;
      renderInspector();
    });

  getJSON(`/api/gene-model/${encodeURIComponent(trial.trialId)}`)
    .then((payload) => {
      if (state.selected?.trialId !== trial.trialId) return;
      state.geneModel = payload;
      if (state.tab === 'structure') renderInspector();
    })
    .catch(() => {});
}

function renderSelectedTrial() {
  const trial = state.selected;
  if (!trial) {
    el.selectedTrial.innerHTML = '<p class="text-[11px] leading-relaxed text-ghost">Nothing selected. The stage shows the topology at rest.</p>';
    el.runReview.disabled = true;
    return;
  }
  el.runReview.disabled = state.running || !runsAllowed();
  el.runReview.title = runsAllowed() ? '' : 'This deployment serves cached reviews only.';
  el.runReview.textContent = !runsAllowed()
    ? 'Runs disabled'
    : state.evaluation
      ? 'Re-run review'
      : state.running
        ? 'Reviewing…'
        : 'Run FDA review';
  el.selectedTrial.innerHTML = `
    <div class="inset px-3 py-2.5">
      <p class="text-[13px] font-semibold leading-snug text-ink prose-wrap">${esc(trial.therapeuticName)}</p>
      <p class="mt-1 text-[11px] leading-relaxed text-faint prose-wrap">${esc(clampText(trial.title || trial.condition || '', 140))}</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        ${chip(trial.trialId, 'info')}
        ${chip(trial.phase || 'phase unknown', 'unknown')}
        ${trial.modality ? chip(trial.modality, 'bench') : ''}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ console */

function consoleLine(tag, body) {
  const tone = tag === 'paperclip' ? 'tag-clip' : tag === 'claude' ? 'tag-claude' : tag === 'benchling' ? 'tag-bench' : 'tag-sys';
  return `<li class="console-line"><span class="console-tag ${tone}">${esc(tag)}</span><span class="console-body">${esc(body)}</span></li>`;
}

function appendConsole(tag, body) {
  if (!el.progressLog) return;
  el.progressLog.insertAdjacentHTML('beforeend', consoleLine(tag, body));
  // An unbounded log on a long run is a slow memory leak with a scrollbar.
  while (el.progressLog.childElementCount > 400) el.progressLog.firstElementChild.remove();
  el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
}

const clearConsole = () => {
  if (el.progressLog) el.progressLog.innerHTML = '';
};

function setConsoleState(text) {
  if (el.consoleState) el.consoleState.textContent = text;
}

/* ---------------------------------------------------------------- the run */

function stepTag(step) {
  const message = `${step.stage || ''} ${step.message || ''}`;
  if (/bench/i.test(message)) return 'benchling';
  if (/review|dossier|synth|scor/i.test(message)) return 'claude';
  if (/evidence|search|paperclip|retriev/i.test(message)) return 'paperclip';
  return 'sys';
}

function onProgress(step) {
  const tag = stepTag(step);
  appendConsole(tag, step.message || step.stage);
  if (tag === 'paperclip') state.counters.paperclip += 1;
  if (tag === 'claude') state.counters.claude += 1;

  const message = `${step.stage || ''} ${step.message || ''}`.toLowerCase();

  if (step.stage === 'start') {
    graph?.activate('trial');
    setTimeout(() => graph?.complete('trial'), 400);
  }

  if (step.stage === 'evidence') {
    graph?.activate('retrieval');
    if (step.key) {
      graph.addLiveSection({ key: step.key, label: step.label ?? step.source, source: step.source ?? '', domainId: step.domainId });
      // A courier actually carries this document to the domain that asked for it.
      crew?.ferry({
        role: 'retrieval',
        from: () => graph?.screenPointOf('retrieval'),
        to: () => graph?.screenPointOf(step.domainId) ?? graph?.screenPointOf('dossier'),
      });
    }
  }

  if (step.stage === 'dossier') {
    graph?.complete('retrieval');
    graph?.activate('dossier');
    if (step.domainId) {
      graph?.activate(step.domainId);
      // The courier is a courtesy; the node completes on its own schedule so the
      // graph never depends on the overlay being enabled or reachable.
      setTimeout(() => graph?.complete(step.domainId), 1400);
      crew?.ferry({
        role: 'reasoning',
        from: () => graph?.screenPointOf(step.domainId),
        to: () => graph?.screenPointOf('dossier'),
      });
    }
  }

  if (step.stage === 'review' || message.includes('scor')) {
    graph?.complete('dossier');
    graph?.activate('review');
  }

  renderCounters();
}

function runReview({ force = false } = {}) {
  if (!state.selected || state.running) return;
  if (!runsAllowed()) {
    setConsoleState('disabled');
    appendConsole('sys', 'This deployment serves cached reviews only (PUBLIC_RUNS=off).');
    return;
  }

  state.running = true;
  state.evaluation = null;
  state.runError = null;
  state.counters = { paperclip: 0, claude: 0 };
  el.runReview.disabled = true;
  el.runReview.textContent = 'Reviewing…';
  graph?.reset();
  clearConsole();
  setConsoleState('running');
  openConsole();
  renderCounters();
  renderInspector();

  const params = new URLSearchParams();
  if (force) params.set('force', '1');
  if (state.captureFullTrace) params.set('trace', 'full');
  const url = `/api/evaluations/${encodeURIComponent(state.selected.trialId)}/stream${params.size ? `?${params}` : ''}`;

  let stream;
  try {
    stream = new EventSource(url);
  } catch {
    finishRun('Live streaming is unavailable in this browser.');
    return;
  }
  state.stream = stream;

  stream.addEventListener('progress', (event) => {
    try {
      onProgress(JSON.parse(event.data));
    } catch {
      /* a malformed frame must not end the run */
    }
  });

  stream.addEventListener('result', (event) => {
    let evaluation = null;
    try {
      evaluation = JSON.parse(event.data);
    } catch {
      finishRun('The review completed but its payload could not be read.');
      return;
    }
    state.evaluation = evaluation;
    graph?.setEvaluation(evaluation);
    graph?.completeAll();
    crew?.cheer(() => graph?.screenPointOf('report'));
    setConsoleState('complete');
    appendConsole('sys', `review complete · ${tokenCount(evaluation).toLocaleString()} tokens of context`);
    finishRun(null);
  });

  stream.addEventListener('error', (event) => {
    // The server closes the stream after `result`; the browser reports that close
    // as an error event. A run that already finished has nothing to report.
    if (!state.running) return;
    let message = 'Connection to the review stream was lost.';
    if (event?.data) {
      try {
        message = JSON.parse(event.data).message || message;
      } catch {
        /* keep the default */
      }
    }
    finishRun(message);
  });
}

function finishRun(error) {
  state.running = false;
  state.stream?.close();
  state.stream = null;
  el.runReview.disabled = !state.selected || !runsAllowed();
  el.runReview.textContent = state.evaluation ? 'Re-run review' : 'Run FDA review';
  if (error) {
    setConsoleState('failed');
    appendConsole('sys', error);
  }
  state.runError = error;
  renderCounters();
  renderInspector();
}

/* ---------------------------------------------------------------- inspector */

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.inspector-tabs .tab').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  });
  renderInspector();
}

function renderInspector() {
  if (!el.inspectorBody) return;
  constructViewer?.destroy();
  constructViewer = null;

  renderSelectedTrial();
  renderSelectionCard();

  const review = state.evaluation?.review;
  let html = '';

  if (state.tab === 'method') {
    html = methodTab();
  } else if (!state.selected) {
    html = welcomeCard();
  } else if (state.tab === 'benchmarks') {
    html = benchmarksTab(review);
  } else if (state.tab === 'structure') {
    html = structureTab();
  } else if (state.running) {
    html = `<div class="panel panel-pad"><p class="text-[13px] leading-relaxed text-faint">Review running. The graph is the live state; results will unfold here when the stream returns.</p></div>`;
  } else if (!review) {
    html = `${state.runError ? errorPanel(state.runError) : ''}
      <div class="panel panel-pad">
        <p class="text-[13px] leading-relaxed text-faint">
          No cached review for this trial yet. Run FDA review to retrieve Paperclip evidence, synthesize the
          CLARITY dossier, score the rubric, and render proof-backed claims.
        </p>
      </div>`;
  } else if (state.tab === 'evidence') {
    html = evidenceTab(state.evaluation);
  } else {
    html = reviewTab(review);
  }

  el.inspectorBody.innerHTML = `<div class="space-y-3">${html}</div>`;
  wireInspector();
}

const errorPanel = (message) => `<section class="panel panel-pad" style="border-color: oklch(0.68 0.19 22 / 0.4)">
    <p class="text-[13px] font-semibold text-stop">Review failed</p>
    <p class="mt-2 text-[12px] leading-relaxed text-muted prose-wrap">${esc(message)}</p>
  </section>`;

/* -- review tab ---------------------------------------------------------- */

function reviewTab(review) {
  const probability = review.probabilityOfTrialSuccess ?? {};
  const confidence = review.confidence ?? {};
  const completeness = computeCompleteness(review, state.rubric).fraction;
  const verdict =
    probability.pointEstimate >= 65 ? ['Favorable', 'ok'] : probability.pointEstimate >= 40 ? ['Uncertain', 'gap'] : ['Unfavorable', 'stop'];

  return `
    <section class="panel panel-lit panel-pad rise">
      <button type="button" class="w-full text-left" data-proof-kind="probability">
        <p class="label">Probability of trial success</p>
        <p class="mt-2 flex flex-wrap items-baseline gap-2">
          <span class="counter text-5xl font-semibold text-ink">${esc(probability.pointEstimate ?? '—')}</span>
          <span class="text-lg text-faint">%</span>
          ${chip(verdict[0], verdict[1])}
        </p>
        <p class="mt-2 font-mono text-[11px] text-ghost">range ${esc(probability.low ?? '—')}–${esc(probability.high ?? '—')} · click for calibration proof</p>
      </button>
      <div class="mt-4 grid gap-2 sm:grid-cols-3">
        ${metric('confidence', confidence.level ?? '—', confidence.rationale ?? '', CONFIDENCE_TONE[confidence.level] ?? 'unknown')}
        ${metric('evidence', pct(completeness), 'rubric weight backed by direct evidence', completeness > 0.7 ? 'ok' : completeness > 0.4 ? 'gap' : 'stop')}
        ${metric('tokens', tokenCount(state.evaluation).toLocaleString(), 'input, cache and output context used', 'bench')}
      </div>
      <details class="mt-3">
        <summary class="disclosure"><span class="label">Reviewer summary</span>${ICON_CARET}</summary>
        <p class="mt-3 text-[13px] leading-relaxed text-muted prose-wrap">${esc(review.reviewerSummary)}</p>
      </details>
      ${calibrationBridge(probability)}
    </section>

    <section class="panel panel-pad rise">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="label">CLARITY scorecard</p>
          <h3 class="mt-1 text-[14px] font-semibold text-ink">Ten domains, each with proof.</h3>
        </div>
        ${chip(`rubric v${state.rubric?.version ?? '—'}`, 'info')}
      </div>
      ${contributionMatrix(review, state.rubric)}
      <div class="mt-3 grid gap-2">
        ${(review.criteria ?? []).map((criterion, index) => domainCard(criterion, index)).join('')}
      </div>
    </section>

    <section class="grid gap-3">
      ${compactList('Key drivers', review.keyDrivers ?? [], (d) => `${d.direction ?? ''} · ${d.weight ?? ''} · ${d.driver ?? d}`)}
      ${compactList('De-risking actions', review.deRiskingActions ?? [], (a) => `${a.priority ?? ''} · ${a.action ?? a}`, (a) => PRIORITY_TONE[a.priority] ?? 'unknown')}
      ${compactList('Red flags', review.redFlags ?? [], (f) => f.flag ?? f, () => ((review.redFlags ?? []).length ? 'stop' : 'unknown'))}
      ${compactList('Regulatory precedents', review.regulatoryPrecedents ?? [], (p) => `${p.product ?? ''} — ${p.outcome ?? ''}`)}
      ${compactList('Expedited pathways', review.expeditedPathways ?? [], (p) => `${p.pathway ?? ''} — ${p.eligibility ?? ''}`)}
    </section>`;
}

function metric(label, value, sub, tone) {
  return `<div class="inset px-3 py-2.5">
    <p class="label">${esc(label)}</p>
    <p class="mt-1 flex items-center gap-2"><span class="counter text-lg text-ink">${esc(value)}</span>${chip('', tone)}</p>
    <p class="clamp-2 mt-1 text-[11px] leading-snug text-faint">${esc(sub)}</p>
  </div>`;
}

function domainCard(criterion, index) {
  const tone = scoreTone(criterion);
  const counts = {
    findings: criterion.supportingFindings?.length ?? 0,
    concerns: criterion.concerns?.length ?? 0,
    gaps: criterion.informationGaps?.length ?? 0,
  };
  return `<details class="inset px-3 py-2.5" data-domain-card="${esc(criterion.id)}" ${index === 0 ? 'open' : ''}>
    <summary class="flex cursor-pointer list-none items-center gap-3">
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[12px] font-semibold text-ink">${esc(criterion.label ?? criterion.id)}</span>
        <span class="mt-1 block">${scorePips(criterion.score, tone)}</span>
      </span>
      <span class="flex shrink-0 items-center gap-1.5">
        ${chip(`${criterion.score}/5`, tone)}
        ${proofButton('domain', criterion.id)}
      </span>
    </summary>
    <div class="mt-3 border-t border-white/[0.06] pt-3">
      <p class="text-[12px] leading-relaxed text-muted prose-wrap">${esc(criterion.assessment)}</p>
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${chip(`evidence ${criterion.evidenceStrength}`, STRENGTH_TONE[criterion.evidenceStrength] ?? 'unknown')}
        ${chip(`weight ${pct(rubricWeight(criterion))}`, 'unknown')}
        ${chip(`${counts.findings} findings`, 'ok')}
        ${chip(`${counts.concerns} concerns`, counts.concerns ? 'gap' : 'unknown')}
        ${chip(`${counts.gaps} gaps`, counts.gaps ? 'gap' : 'unknown')}
        <button type="button" class="chip-clip" data-open-node="${esc(criterion.id)}"><span class="dot"></span>open on stage</button>
      </div>
      ${miniEvidence(criterion)}
    </div>
  </details>`;
}

function miniEvidence(criterion) {
  const index = citationIndex(state.evaluation);
  const findings = criterion.supportingFindings ?? [];
  const concerns = criterion.concerns ?? [];
  const gaps = criterion.informationGaps ?? [];
  return `
    <details class="mt-3">
      <summary class="disclosure !px-0"><span class="label">evidence lines</span>${ICON_CARET}</summary>
      <div class="mt-2 grid gap-2">
        ${findings
          .map(
            (finding) => `<div class="evidence-row rule-ok">
              <p class="text-[12px] leading-snug text-muted prose-wrap">${esc(finding.finding)} ${proofButton('claim', claimPayload(criterion.id, finding.finding, finding.source, 'supporting finding'))}</p>
              ${sourceRow(finding.source, index)}
            </div>`,
          )
          .join('')}
        ${concerns
          .map(
            (concern) => `<div class="evidence-row rule-${SEVERITY_TONE[concern.severity] ?? 'unknown'}">
              <p class="text-[12px] leading-snug text-muted prose-wrap">${esc(concern.concern)} ${proofButton('claim', claimPayload(criterion.id, concern.concern, concern.source, `${concern.severity} concern`))}</p>
              ${sourceRow(concern.source, index)}
            </div>`,
          )
          .join('')}
        ${gaps
          .map(
            (gap) => `<div class="evidence-row rule-unknown">
              <p class="text-[12px] leading-snug text-faint prose-wrap">${esc(gap.gap ?? gap)}</p>
            </div>`,
          )
          .join('')}
      </div>
    </details>`;
}

function compactList(title, rows, body, tone = () => 'info') {
  return `<details class="panel panel-pad rise">
    <summary class="disclosure !px-0 !py-0">
      <span><span class="label">${esc(title)}</span><span class="mt-1 block text-[13px] font-semibold text-ink">${rows.length} items</span></span>
      ${ICON_CARET}
    </summary>
    <ul class="mt-3 space-y-2">
      ${(rows.length ? rows : ['No items recorded.'])
        .map((row) => `<li class="evidence-row rule-${tone(row)} text-[12px] leading-snug text-muted prose-wrap">${esc(typeof row === 'string' ? row : body(row))}</li>`)
        .join('')}
    </ul>
  </details>`;
}

/* -- evidence tab -------------------------------------------------------- */

function evidenceTab(evaluation) {
  const dossier = evaluation.evidence?.dossier;
  const sections = evaluation.evidence?.sections ?? [];
  const usage = evaluation.meta?.usage ?? {};
  const trace = evaluation.meta?.trace;
  const traceUrl = trace?.traceId
    ? `/api/evaluations/${encodeURIComponent(evaluation.trial?.trialId ?? '')}/traces/${encodeURIComponent(trace.traceId)}`
    : '';

  return `
    <section class="panel panel-pad rise">
      <p class="label">Paperclip + Claude run</p>
      <p class="mt-1 text-[13px] font-semibold text-ink">${sections.length} retrieval sections · ${tokenCount(evaluation).toLocaleString()} tokens/context</p>
      <dl class="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-faint">
        <div><dt class="text-ghost">model</dt><dd class="text-ink">${esc(evaluation.meta?.model ?? '—')}</dd></div>
        <div><dt class="text-ghost">effort</dt><dd class="text-ink">${esc(evaluation.meta?.effort ?? '—')}</dd></div>
        <div><dt class="text-ghost">input</dt><dd>${num(usage.input_tokens ?? 0)}</dd></div>
        <div><dt class="text-ghost">cache read</dt><dd>${num(usage.cache_read_input_tokens ?? 0)}</dd></div>
        <div><dt class="text-ghost">cache write</dt><dd>${num(usage.cache_creation_input_tokens ?? 0)}</dd></div>
        <div><dt class="text-ghost">output</dt><dd>${num(usage.output_tokens ?? 0)}</dd></div>
      </dl>
      ${traceUrl ? `<p class="mt-3"><a class="src-link" href="${esc(traceUrl)}" target="_blank" rel="noreferrer noopener">open ${esc(trace.mode)} trace${ICON_EXTERNAL}</a></p>` : ''}
      <div class="console mt-3">
        <ul class="space-y-1">${sections
          .map((section) => consoleLine('paperclip', `${section.label}: ${section.query || section.source} (${num(section.chars ?? 0)} chars)`))
          .join('')}</ul>
      </div>
    </section>

    ${
      dossier?.domains?.length
        ? `<section class="panel panel-pad print-urls rise">
            <p class="label">Cited evidence dossier</p>
            <p class="mt-1 text-[13px] font-semibold text-ink">${esc(dossier.phaseLabel || dossier.phase || 'CLARITY')} · ${dossier.domains.length} domains</p>
            <div class="mt-3 grid gap-2">
              ${dossier.domains.map(dossierDomain).join('')}
            </div>
          </section>`
        : '<div class="panel panel-pad"><p class="text-[12px] text-faint">This review has no cited dossier — it predates the dossier pass.</p></div>'
    }`;
}

function dossierDomain(domain) {
  return `<details class="inset px-3 py-2.5">
    <summary class="flex cursor-pointer list-none items-center justify-between gap-3">
      <span class="truncate text-[12px] font-semibold text-ink">${esc(domain.domainLabel)}</span>
      ${chip(domain.status ?? 'generated', domain.status === 'not_applicable' ? 'unknown' : 'info')}
    </summary>
    <p class="mt-2 text-[12px] leading-relaxed text-faint prose-wrap">${esc(domain.summary || 'Not generated for this phase.')}</p>
    <div class="mt-3 space-y-2">
      ${(domain.elements ?? [])
        .map(
          (item) => `<div class="evidence-row rule-info">
            <p class="text-[12px] font-semibold text-ink prose-wrap">${esc(item.element)}</p>
            <p class="mt-1 text-[12px] leading-snug text-muted prose-wrap">${esc(item.finding)}</p>
            <p class="mt-1 font-mono text-[10px] text-ghost prose-wrap">${esc(item.confidenceScore ?? '—')}% confidence · ${esc(item.rationale || '')}</p>
            ${
              item.citations?.length
                ? `<div class="mt-1.5 flex flex-wrap gap-1">${item.citations
                    .map((citation) =>
                      sourcePill({
                        title: citation.title || citation.identifier || 'Source',
                        type: SOURCE_TYPE_LABEL[citation.sourceType] ?? inferType(citation.title || ''),
                        url: safeHttpsUrl(citation.url),
                        ids: citation.identifier ? [citation.identifier] : [],
                      }),
                    )
                    .join('')}</div>`
                : '<p class="mt-1.5 text-[11px] text-ghost">No direct public source found.</p>'
            }
          </div>`,
        )
        .join('')}
    </div>
  </details>`;
}

/* -- structure tab ------------------------------------------------------- */

function structureTab() {
  const payload = state.geneModel;
  if (!payload?.model) {
    return `<div class="panel panel-pad"><p class="text-[13px] text-faint">No construct resolved for this programme yet.</p></div>`;
  }
  const { model } = payload;
  const live = model.provenance === 'benchling';
  return `
    <section class="panel panel-pad rise">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow" style="color: var(--color-bench-400)">Structure</p>
          <h3 class="mt-1.5 text-[14px] font-semibold leading-snug text-ink prose-wrap">${esc(model.name)}</h3>
          <p class="mt-1 font-mono text-[11px] text-faint">
            ${model.length ? `${num(model.length)} ${esc(model.unit)}` : 'length unknown'}
            ${model.modality ? ` · ${esc(model.modality)}` : ''}
            ${model.features?.length ? ` · ${model.features.length} features` : ''}
          </p>
        </div>
        <span class="${live ? 'chip-bench' : 'chip-unknown'}">
          <span class="${live ? 'dot-live' : 'dot'}"></span>${live ? 'Benchling · live' : 'Derived schematic'}
        </span>
      </div>
      ${model.note ? `<p class="mt-3 text-[12px] leading-relaxed text-muted prose-wrap">${esc(model.note)}</p>` : ''}
      <div class="construct-stage mt-3">
        <canvas id="construct-canvas" tabindex="0" role="img" aria-label="Three-dimensional view of ${esc(model.name)}"></canvas>
        <p id="construct-readout" class="construct-readout"></p>
      </div>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p class="font-mono text-[10px] text-ghost">drag to turn · scroll to zoom · the flat map below is the measurable view</p>
        ${
          state.health?.modal?.tasks?.fold?.configured
            ? `<button type="button" class="btn-quiet" data-predict-structure>predict fold</button>`
            : ''
        }
      </div>
      <div id="fold-status" class="mt-2"></div>
    </section>
    <div id="gene-model-flat"></div>`;
}

function mountStructure() {
  const canvas = document.getElementById('construct-canvas');
  const flat = document.getElementById('gene-model-flat');
  const readout = document.getElementById('construct-readout');
  if (flat) renderGeneModel(flat, state.geneModel, { onTargetProof: () => {} });
  if (!canvas || !state.geneModel?.model) return;

  constructViewer = createConstructViewer(canvas, {
    onHover: (feature) => {
      if (!readout) return;
      readout.textContent = feature
        ? `${feature.name} · ${Math.round(feature.start).toLocaleString()}–${Math.round(feature.end).toLocaleString()} ${state.geneModel.model.unit}`
        : '';
    },
  });
  if (constructViewer) constructViewer.setModel(state.geneModel.model);
  else if (readout) readout.textContent = 'Three-dimensional view unavailable in this browser — the flat map below is complete.';

  document.querySelector('[data-predict-structure]')?.addEventListener('click', predictStructure);
}

/**
 * Ask Modal to fold the construct. A predicted fold is a hypothesis about the
 * molecule, so it replaces the schematic only under its own label — and the
 * refusals (no sequence, not configured, upstream failure) are reported as
 * refusals rather than quietly leaving the old picture up.
 */
async function predictStructure(event) {
  const button = event.currentTarget;
  const status = document.getElementById('fold-status');
  if (!state.selected || !status) return;

  button.disabled = true;
  button.textContent = 'folding…';
  status.innerHTML = `<p class="text-[11px] text-faint">Folding on Modal. This runs on a GPU and can take a minute.</p>`;

  try {
    const response = await fetch(`/api/structure/${encodeURIComponent(state.selected.trialId)}/predict`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);

    const structure = body.structure ?? {};
    if (!structure.backbone?.length) throw new Error('Modal returned a structure with no backbone to draw.');

    constructViewer?.setBackbone(structure.backbone);
    status.innerHTML = `
      <div class="inset px-3 py-2.5">
        <div class="flex flex-wrap items-center gap-1.5">
          ${chip('Predicted fold', 'gap')}
          ${structure.model ? chip(structure.model, 'clip') : ''}
          ${chip(`${num(structure.residues)} residues`, 'unknown')}
          ${structure.meanConfidence != null ? chip(`mean ${Math.round(structure.meanConfidence)}`, 'info') : ''}
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-faint">
          This is a model's prediction from the Benchling sequence, not a solved structure and not an
          observation of the clinical product. Colour is the predictor's own per-residue confidence.
        </p>
      </div>`;
    button.textContent = 'refold';
  } catch (error) {
    status.innerHTML = `<p class="text-[11px] leading-relaxed text-gap prose-wrap">${esc(error.message)}</p>`;
    button.textContent = 'predict fold';
  } finally {
    button.disabled = false;
  }
}

/* -- benchmarks tab ------------------------------------------------------ */

function benchmarksTab(review) {
  const benchmarks = state.benchmarks;
  if (!benchmarks) {
    return `<div class="panel panel-pad"><p class="text-[13px] text-faint">Benchmarks unavailable.</p></div>`;
  }
  return `
    <section class="panel panel-lit panel-pad rise">
      <p class="label">Against every review on this rubric</p>
      <p class="mt-1 text-[13px] font-semibold text-ink">${benchmarks.count} programme${benchmarks.count === 1 ? '' : 's'} scored · rubric v${esc(benchmarks.rubricVersion)}</p>
      ${review ? benchmarkStrip(benchmarks, review, state.selected) : '<p class="mt-3 text-[12px] text-faint">Run a review to place this programme on the distribution.</p>'}
      ${review ? benchmarkDomains(benchmarks, review) : ''}
    </section>

    ${
      review
        ? `<section class="panel panel-pad rise">
            <p class="label">How the score is computed</p>
            ${weightedScoreFormula(review, state.rubric, state.evaluation?.meta ?? {})}
            ${completenessFormula(review, state.rubric)}
          </section>`
        : ''
    }

    <section class="panel panel-pad rise">
      <p class="label">Scored programmes</p>
      <ul class="mt-2 space-y-1">
        ${benchmarks.programmes
          .map(
            (programme) => `<li class="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 ${programme.trialId === state.selected?.trialId ? 'bg-white/[0.06]' : ''}">
              <button type="button" class="min-w-0 flex-1 truncate text-left text-[12px] text-ink" data-select-trial="${esc(programme.trialId)}">${esc(programme.therapeuticName)}</button>
              <span class="counter shrink-0 text-[11px] text-faint">${esc(programme.point ?? '—')}%</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

/* -- method tab ---------------------------------------------------------- */

function methodTab() {
  const steps = [
    ['Paperclip retrieval', 'Source-scoped searches across trial registries, FDA review files and primary literature.'],
    ['CLARITY dossier', 'Nine domain passes produce citation-bearing findings, gaps, rationales and confidence.'],
    ['Claude FDA review', 'A rubric-scored reviewer pass consumes only the retrieved evidence and cited dossier.'],
    ['Benchling structure', 'Live sequence when tenant credentials resolve; otherwise an explicitly derived schematic.'],
  ];
  return `
    <section class="panel panel-pad rise">
      <p class="eyebrow">The pipeline</p>
      <h3 class="mt-2 text-[16px] font-semibold tracking-tight text-ink">Four passes, one audit trail.</h3>
      <p class="mt-2 text-[12px] leading-relaxed text-faint">
        Nothing in the report is generated from the model's own recall. Each stage consumes only what the
        stage before it retrieved, and hands forward the citations it used.
      </p>
      <div class="mt-4 grid gap-2">
        ${steps
          .map(
            ([title, body], index) => `<div class="inset px-3 py-2.5">
              <p class="label">0${index + 1}</p>
              <p class="mt-1.5 text-[13px] font-semibold text-ink">${esc(title)}</p>
              <p class="mt-1 text-[12px] leading-relaxed text-faint">${esc(body)}</p>
            </div>`,
          )
          .join('')}
      </div>
      <p class="mt-4 text-[12px] leading-relaxed text-faint">
        Retrieval fans out across registries, regulatory review documents and the primary literature, then
        converges through nine CLARITY domains into one scored dossier.
      </p>
    </section>

    <section class="panel panel-pad rise">
      <p class="label">Rubric weights</p>
      <p class="mt-1 text-[13px] font-semibold text-ink">v${esc(state.rubric?.version ?? '—')} · ${state.rubric?.dimensions?.length ?? 0} dimensions</p>
      <div class="mt-3 space-y-1.5">
        ${(state.rubric?.dimensions ?? [])
          .map(
            (dimension) => `<div class="flex items-center gap-3">
              <span class="min-w-0 flex-1 truncate text-[12px] text-muted">${esc(dimension.label)}</span>
              <span class="meter-track max-w-[6rem]"><span class="meter-fill" style="width:${Math.min(100, dimension.weight * 100 * 4)}%"></span></span>
              <span class="counter w-10 shrink-0 text-right text-[11px] text-faint">${pct(dimension.weight)}</span>
            </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="panel panel-pad rise">
      <p class="label">CLARITY domains</p>
      <div class="mt-3 space-y-1.5">
        ${(state.pipeline?.domains ?? [])
          .map(
            (domain) => `<div class="flex items-center justify-between gap-3">
              <span class="min-w-0 flex-1 truncate text-[12px] text-muted">${esc(domain.label)}</span>
              <span class="font-mono text-[10px] text-ghost">from ${esc(domain.activeFrom)} · ${domain.searches?.length ?? 0} searches</span>
            </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

/* -- selection card ------------------------------------------------------ */

function renderSelectionCard() {
  if (!el.inspectorSelection) return;
  const node = state.selection;
  if (!node) {
    el.inspectorSelection.innerHTML = '';
    return;
  }

  const data = node.data ?? {};
  const rows = [];
  if (data.type === 'document') {
    const doc = data.doc;
    rows.push(['identifier', doc.identifier || '—'], ['type', doc.sourceType || '—'], ['cited by', `${doc.cites.length} elements`]);
    if (doc.url) rows.push(['link', `<a class="src-link" href="${esc(safeHttpsUrl(doc.url))}" target="_blank" rel="noreferrer noopener">open${ICON_EXTERNAL}</a>`]);
  } else if (data.type === 'domain') {
    const criterion = data.criterion;
    rows.push(['score', criterion ? `${criterion.score}/5` : 'not scored']);
    if (criterion) rows.push(['evidence', criterion.evidenceStrength], ['weight', pct(rubricWeight(criterion))]);
  } else if (data.type === 'command') {
    rows.push(['scope', data.section?.source ?? '—'], ['returned', `${num(data.section?.chars ?? 0)} chars`]);
    if (data.section?.query) rows.push(['query', `<span class="font-mono text-[11px] text-ink prose-wrap">${esc(data.section.query)}</span>`]);
  } else if (data.type === 'element') {
    rows.push(['confidence', data.element?.confidenceScore != null ? `${data.element.confidenceScore}%` : '—']);
  } else if (data.type === 'criterion') {
    rows.push(['score', `${data.criterion.score}/5`], ['weight', pct(data.weight)]);
  } else if (data.type === 'trial') {
    rows.push(['sponsor', data.trial?.sponsor ?? '—'], ['phase', data.trial?.phase ?? '—'], ['registry', data.trial?.registry ?? '—']);
  }

  const body = data.element?.finding ?? data.claim ?? data.criterion?.assessment ?? '';

  el.inspectorSelection.innerHTML = `
    <div class="selection-card rise">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="label">${esc(data.type ?? 'node')}</p>
          <p class="mt-1 text-[13px] font-semibold leading-snug text-ink prose-wrap">${esc(node.label)}</p>
        </div>
        <button type="button" class="btn-quiet shrink-0" data-clear-selection>clear</button>
      </div>
      ${body ? `<p class="mt-2 text-[12px] leading-relaxed text-muted prose-wrap">${esc(clampText(body, 320))}</p>` : ''}
      ${
        rows.length
          ? `<dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[10px]">
              ${rows.map(([key, value]) => `<dt class="text-ghost">${esc(key)}</dt><dd class="min-w-0 text-muted prose-wrap">${value}</dd>`).join('')}
            </dl>`
          : ''
      }
      ${
        node.expandable
          ? `<button type="button" class="btn-ghost mt-3 !px-3 !py-1 !text-[11px]" data-descend>open this node ⤢</button>`
          : ''
      }
    </div>`;

  // Wired here rather than in wireInspector: the card is re-rendered on every
  // graph selection, which does not re-render the body around it.
  el.inspectorSelection.querySelector('[data-clear-selection]')?.addEventListener('click', () => {
    state.selection = null;
    graph?.select(null);
    renderSelectionCard();
  });
  el.inspectorSelection.querySelector('[data-descend]')?.addEventListener('click', () => {
    showPane('stage');
    graph?.descendSelected();
  });
}

/* -- breadcrumbs --------------------------------------------------------- */

function renderBreadcrumbs(levels) {
  if (!el.breadcrumbs) return;
  el.breadcrumbs.innerHTML = levels
    .map(
      (level, index) => `<button type="button" class="crumb${index === levels.length - 1 ? ' is-current' : ''}" data-level="${index}">
        ${esc(clampText(level.title, 28))}
      </button>`,
    )
    .join('<span class="crumb-sep">›</span>');
  el.breadcrumbs.querySelectorAll('.crumb').forEach((button) => {
    button.addEventListener('click', () => graph?.ascend(Number(button.dataset.level)));
  });
}

/* ---------------------------------------------------------------- wiring */

function wireInspector() {
  if (state.tab === 'structure') mountStructure();

  el.inspectorBody.querySelectorAll('[data-proof-kind]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openProof(button.dataset.proofKind, button.dataset.proof);
    });
  });

  el.inspectorBody.querySelectorAll('[data-open-node]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const id = button.dataset.openNode;
      showPane('stage');
      if (graph?.hasNode(id)) {
        graph.select(id);
        graph.descendById(id);
      }
    });
  });

  el.inspectorBody.querySelectorAll('[data-select-trial]').forEach((button) => {
    button.addEventListener('click', () => selectTrial(button.dataset.selectTrial));
  });

  el.inspectorBody.querySelector('[data-focus-search]')?.addEventListener('click', (event) => {
    crew?.popFrom(event.currentTarget);
    showPane('dock');
    el.trialSearch.focus();
  });

  el.inspectorBody.querySelector('[data-open-method]')?.addEventListener('click', (event) => {
    crew?.popFrom(event.currentTarget);
    setTab('method');
  });

  el.inspectorBody.querySelectorAll('.matrix-row').forEach((row) => {
    row.addEventListener('click', () => {
      const card = el.inspectorBody.querySelector(`[data-domain-card="${CSS.escape(row.dataset.domain)}"]`);
      if (card) {
        card.open = true;
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        crew?.tug(card.querySelector('summary'));
      }
    });
  });

  // The crew physically pull disclosures open. It is a courtesy, not a mechanism:
  // the disclosure has already opened by the time anyone walks over.
  el.inspectorBody.querySelectorAll('details').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) crew?.tug(details.querySelector('summary'));
    });
  });

}

function openProof(kind, payload) {
  if (!state.evaluation?.review) return;
  if (kind === 'probability') {
    proveProbability({ evaluation: state.evaluation });
    return;
  }
  if (kind === 'domain') {
    const criterion = state.evaluation.review.criteria.find((c) => c.id === payload);
    if (criterion) {
      proveDomain({ evaluation: state.evaluation, criterion, weight: rubricWeight(criterion), dossierDomainId: criterion.id });
    }
    return;
  }
  if (kind === 'claim') {
    let parsed = {};
    try {
      parsed = JSON.parse(payload || '{}');
    } catch {
      return;
    }
    proveClaim({
      evaluation: state.evaluation,
      claim: parsed.claim,
      sourceText: parsed.source,
      context: { domainId: parsed.domainId, label: parsed.label },
    });
  }
}

/* ------------------------------------------------------------------- theme */

/**
 * Three states, not two: light, dark, and *follow the system* — which is the
 * default and the one a toggle usually throws away. The stylesheet handles the
 * system case on its own through `prefers-color-scheme`, so no attribute is set
 * until the reader actually chooses; that also means no flash of the wrong
 * theme on load, without an inline script the content policy would reject.
 */
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_GLYPH = { system: '◐', light: '☀', dark: '☾' };

const systemPrefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
};

const effectiveTheme = () =>
  state.theme === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : state.theme;

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.theme);

  // The canvas has no cascade of its own; it has to be told.
  setStageTheme(effectiveTheme());

  const button = document.getElementById('toggle-theme');
  const glyph = document.getElementById('theme-glyph');
  if (glyph) glyph.textContent = THEME_GLYPH[state.theme];
  if (button) {
    button.title = state.theme === 'system' ? 'Theme: follows your system' : `Theme: ${state.theme}`;
    button.setAttribute('aria-label', button.title);
  }
}

function cycleTheme() {
  state.theme = THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length];
  try {
    localStorage.setItem('fdaapproval.theme', state.theme);
  } catch {
    /* the choice simply does not persist */
  }
  applyTheme();
}

/* ------------------------------------------------------------------ layout */

const LAYOUT = {
  dock: { prop: '--dock-w', key: 'fdaapproval.dockW', min: 210, max: 560, fallback: 304, sign: 1 },
  inspector: { prop: '--inspector-w', key: 'fdaapproval.inspectorW', min: 300, max: 760, fallback: 404, sign: -1 },
};

function readWidth(spec) {
  let stored = null;
  try {
    stored = Number(localStorage.getItem(spec.key));
  } catch {
    stored = null;
  }
  return clampWidth(spec, Number.isFinite(stored) && stored > 0 ? stored : spec.fallback);
}

function clampWidth(spec, value) {
  const deck = document.querySelector('.deck');
  // The stage is the point of the app; neither side pane may squeeze it out.
  const room = Math.max(spec.min, (deck?.clientWidth ?? window.innerWidth) - 300);
  return Math.round(Math.min(Math.max(value, spec.min), Math.min(spec.max, room)));
}

function applyWidth(name, value) {
  const spec = LAYOUT[name];
  const deck = document.querySelector('.deck');
  if (!deck) return;
  const width = clampWidth(spec, value);
  deck.style.setProperty(spec.prop, `${width}px`);
  try {
    localStorage.setItem(spec.key, String(width));
  } catch {
    /* the layout simply does not persist */
  }
  return width;
}

/**
 * Pane resizing. Pointer drag for the mouse, arrow keys for the keyboard, and a
 * double-click to put a pane back where it started.
 */
function initLayout() {
  for (const [name, spec] of Object.entries(LAYOUT)) applyWidth(name, readWidth(spec));

  const wire = (element, name) => {
    if (!element) return;
    const spec = LAYOUT[name];
    let start = null;

    element.addEventListener('pointerdown', (event) => {
      const deck = document.querySelector('.deck');
      const current = parseFloat(getComputedStyle(deck).getPropertyValue(spec.prop)) || spec.fallback;
      start = { x: event.clientX, width: current };
      element.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* capture is a nicety */
      }
      event.preventDefault();
    });

    element.addEventListener('pointermove', (event) => {
      if (!start) return;
      applyWidth(name, start.width + (event.clientX - start.x) * spec.sign);
    });

    const end = (event) => {
      if (!start) return;
      start = null;
      element.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);

    element.addEventListener('dblclick', () => applyWidth(name, spec.fallback));

    element.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const deck = document.querySelector('.deck');
      const current = parseFloat(getComputedStyle(deck).getPropertyValue(spec.prop)) || spec.fallback;
      const step = (event.shiftKey ? 48 : 16) * (event.key === 'ArrowRight' ? 1 : -1) * spec.sign;
      applyWidth(name, current + step);
      event.preventDefault();
    });
  };

  wire(document.getElementById('split-dock'), 'dock');
  wire(document.getElementById('split-inspector'), 'inspector');

  // A narrowed window can leave a stored width wider than the room now available.
  window.addEventListener('resize', debounce(() => {
    for (const [name, spec] of Object.entries(LAYOUT)) {
      const deck = document.querySelector('.deck');
      const current = parseFloat(getComputedStyle(deck).getPropertyValue(spec.prop)) || spec.fallback;
      applyWidth(name, current);
    }
  }, 120));
}

function setFocusMode(on) {
  state.focus = on;
  document.body.classList.toggle('is-focus', on);
  const button = document.getElementById('stage-expand');
  button?.setAttribute('aria-pressed', String(on));
  button?.setAttribute('title', on ? 'Restore the panes (F)' : 'Expand the stage (F)');
}

/** The stage toolbar reflects what the graph can actually do right now. */
function syncStageTools() {
  const up = document.getElementById('graph-up');
  const open = document.getElementById('graph-open');
  if (up) up.disabled = !graph || graph.depth === 0;
  if (open) open.disabled = !state.selection?.expandable;
}

function openConsole() {
  el.consoleShell?.classList.remove('is-collapsed');
  el.consoleToggle?.setAttribute('aria-expanded', 'true');
}

function showPane(pane) {
  document.body.dataset.pane = pane;
  document.querySelectorAll('.pane-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.pane === pane);
  });
}

/** The SVG topology, used when a canvas context cannot be had. */
function renderFallbackGraph() {
  if (graph || !el.graphFallback) return;
  el.graphFallback.classList.remove('hidden');
  el.graphCanvas?.classList.add('hidden');
  createPipelineGraph(el.graphFallback, { domains: state.pipeline?.domains ?? [] });
}

function wire() {
  el.trialSearch.addEventListener('focus', openCombo);
  el.trialSearch.addEventListener('input', debounce(() => {
    state.selected = null;
    openCombo();
    loadCatalog();
  }));
  el.trialSearch.addEventListener('keydown', (event) => {
    const items = [...el.trialPop.querySelectorAll('.combo-item')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openCombo();
      state.activeIndex = Math.max(0, Math.min(items.length - 1, state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((item, index) => {
        const active = index === state.activeIndex;
        item.dataset.active = String(active);
        item.setAttribute('aria-selected', String(active));
      });
      items[state.activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter' && state.activeIndex >= 0) {
      event.preventDefault();
      selectTrial(items[state.activeIndex]?.dataset.id);
    }
    if (event.key === 'Escape') closeCombo();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#trial-search') && !event.target.closest('#trial-pop')) closeCombo();
  });

  el.trialPop.addEventListener('click', (event) => {
    const item = event.target.closest('.combo-item');
    if (item) selectTrial(item.dataset.id);
  });

  el.filterPhase.addEventListener('change', loadCatalog);
  el.filterArea.addEventListener('change', loadCatalog);

  const run = (event) => {
    crew?.popFrom(event.currentTarget);
    runReview({ force: Boolean(state.evaluation) });
  };
  el.runReview.addEventListener('click', run);
  el.captureFullTrace.checked = state.captureFullTrace;
  el.captureFullTrace.addEventListener('change', (event) => {
    state.captureFullTrace = event.target.checked;
    writeFlag('fdaapproval.captureFullTrace', state.captureFullTrace);
  });

  el.toggleCrew.setAttribute('aria-pressed', String(state.crewEnabled));
  el.toggleCrew.addEventListener('click', () => {
    state.crewEnabled = !state.crewEnabled;
    writeFlag('fdaapproval.crew', state.crewEnabled);
    el.toggleCrew.setAttribute('aria-pressed', String(state.crewEnabled));
    crew?.setEnabled(state.crewEnabled);
    if (state.crewEnabled) crew?.popFrom(el.toggleCrew);
  });

  el.consoleToggle.addEventListener('click', () => {
    const collapsed = el.consoleShell.classList.toggle('is-collapsed');
    el.consoleToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  document.querySelectorAll('.inspector-tabs .tab').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });

  document.querySelectorAll('.pane-tab').forEach((tab) => {
    tab.addEventListener('click', () => showPane(tab.dataset.pane));
  });

  document.getElementById('toggle-theme')?.addEventListener('click', (event) => {
    cycleTheme();
    crew?.popFrom(event.currentTarget);
  });

  // A reader on "system" who changes their OS theme mid-session should follow.
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (state.theme === 'system') applyTheme();
    });
  } catch {
    /* older engines: the choice is still honoured, it just will not live-update */
  }

  document.getElementById('graph-up')?.addEventListener('click', () => {
    graph?.ascend(Math.max(0, (graph.depth ?? 1) - 1));
  });
  document.getElementById('graph-open')?.addEventListener('click', () => {
    graph?.descendSelected();
  });
  document.getElementById('stage-expand')?.addEventListener('click', (event) => {
    crew?.popFrom(event.currentTarget);
    setFocusMode(!state.focus);
  });

  window.addEventListener('beforeunload', () => state.stream?.close());
  window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach((d) => (d.open = true)));

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
    if (event.key === 'Escape') {
      if (graph?.depth) graph.ascend(graph.depth - 1);
      else if (state.focus) setFocusMode(false);
    }
    if (typing) return;
    if (event.key === '/') {
      event.preventDefault();
      if (state.focus) setFocusMode(false);
      showPane('dock');
      el.trialSearch.focus();
    }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      setFocusMode(!state.focus);
    }
  });
}

/* ---------------------------------------------------------------------- init */

(function init() {
  applyTheme();
  wire();
  initLayout();
  showPane('stage');

  crew = createCrew({ mount: el.crewLayer, enabled: state.crewEnabled });

  graph = createEvidenceGraph(el.graphCanvas, {
    onSelect: (node) => {
      state.selection = node;
      renderSelectionCard();
      syncStageTools();
      if (node?.data?.type === 'structure') setTab('structure');
    },
    onLevel: (levels) => {
      renderBreadcrumbs(levels);
      syncStageTools();
    },
    resolveSources: (sourceText, evaluation) => parseSources(sourceText, citationIndex(evaluation)),
  });

  if (!graph) {
    renderFallbackGraph();
  } else {
    renderBreadcrumbs(graph.levels());
  }

  renderCounters();
  renderInspector();

  Promise.all([loadHealth(), loadPipeline(), loadCatalog(), loadBenchmarks()]).catch((error) => {
    console.error('startup failed', error);
  });
})();
