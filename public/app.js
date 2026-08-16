import {
  SOURCE_TYPE_LABEL,
  citationIndex,
  inferType,
  parseSources,
  safeHttpsUrl,
} from './citations.js';
import { renderHeroBio } from './lab/bio.js';
import { createPipelineGraph } from './lab/graph.js';
import { renderGeneModel } from './lab/genome.js';
import { proveClaim, proveDomain, proveProbability, registerPipeline } from './lab/proof.js';

const state = {
  trials: [],
  facets: null,
  catalogMeta: null,
  pipeline: null,
  rubric: null,
  selected: null,
  evaluation: null,
  geneModel: null,
  running: false,
  stream: null,
  activeIndex: -1,
  captureFullTrace: localStorage.getItem('fdaapproval.captureFullTrace') === 'true',
};

const el = {
  status: document.getElementById('status-strip'),
  heroBio: document.getElementById('hero-bio'),
  heroGraph: document.getElementById('hero-graph'),
  heroStats: document.getElementById('hero-stats'),
  methodSteps: document.getElementById('method-steps'),
  search: document.getElementById('trial-search'),
  pop: document.getElementById('trial-pop'),
  phase: document.getElementById('filter-phase'),
  area: document.getElementById('filter-area'),
  catalogMeta: document.getElementById('catalog-meta'),
  selectedTrial: document.getElementById('selected-trial'),
  runButton: document.getElementById('run-review'),
  runSurface: document.getElementById('run-surface'),
  panel: document.getElementById('panel'),
};

let runGraph = null;

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));

const debounce = (fn, ms = 160) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

async function getJSON(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || res.statusText), { body, status: res.status });
  return body;
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const chip = (text, tone = 'chip') =>
  `<span class="${tone.startsWith('chip-') ? tone : `chip-${tone}`}"><span class="dot"></span>${esc(text)}</span>`;

const ICON_EXTERNAL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" class="size-3 shrink-0" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3.5h3v3M12.5 3.5 7.5 8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CARET = `<svg viewBox="0 0 16 16" class="disclosure-caret size-3.5 text-faint" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const STRENGTH_TONE = { strong: 'ok', moderate: 'info', weak: 'gap', absent: 'unknown' };
const SEVERITY_TONE = { critical: 'stop', major: 'gap', minor: 'unknown' };
const PRIORITY_TONE = { immediate: 'stop', 'near-term': 'gap', later: 'unknown' };
const CONFIDENCE_TONE = { high: 'ok', moderate: 'info', low: 'gap' };

function weightFor(criterion) {
  return state.rubric?.dimensions?.find((d) => d.id === criterion.id)?.weight ?? criterion.weight ?? 0;
}

function scoreTone(criterion) {
  if (criterion.evidenceStrength === 'absent') return 'unknown';
  if (criterion.score <= 2) return 'stop';
  if (criterion.score === 3) return 'gap';
  return 'ok';
}

function scorePips(score, tone) {
  return `<span class="score-track">${[1, 2, 3, 4, 5]
    .map((n) => `<span class="score-pip" data-tone="${tone}" data-on="${n <= score}"></span>`)
    .join('')}</span>`;
}

function evidenceCompleteness(review) {
  const factor = { strong: 1, moderate: 0.65, weak: 0.3, absent: 0 };
  let backed = 0;
  let total = 0;
  for (const criterion of review.criteria ?? []) {
    const weight = weightFor(criterion) || 0.0001;
    total += weight;
    backed += weight * (factor[criterion.evidenceStrength] ?? 0);
  }
  return total ? backed / total : 0;
}

function sourcePill(source) {
  const ids = source.ids?.length ? source.ids.join(' · ') : '';
  const tip = esc([source.type, source.title, source.note, ids].filter(Boolean).join(' — '));
  const sameAsTitle = String(source.title).trim().toLowerCase() === String(source.type).toLowerCase();
  const body = `${sameAsTitle ? '' : `<span class="text-ghost">${esc(source.type)}</span>`}<span class="max-w-[30ch] truncate">${esc(source.title)}</span>`;
  return source.url
    ? `<a class="src-link" href="${esc(source.url)}" target="_blank" rel="noreferrer" title="${tip}">${body}${ICON_EXTERNAL}</a>`
    : `<span class="src-plain" title="${tip}">${body}</span>`;
}

function sourceRow(sourceText, index) {
  const sources = parseSources(sourceText, index);
  if (!sources.length) return '';
  const orphanIds = sources.filter((s) => !s.url).flatMap((s) => s.ids ?? []).filter(Boolean);
  return `<div class="mt-1.5 flex flex-wrap items-center gap-1">
    ${sources.map(sourcePill).join('')}
    ${orphanIds.length ? `<span class="src-id">${esc(orphanIds.join(' · '))}</span>` : ''}
  </div>`;
}

function proofButton(kind, payload = '') {
  return `<button class="proof-btn no-print" data-proof-kind="${esc(kind)}" data-proof="${esc(payload)}">proof</button>`;
}

function fillSelect(select, values, anyLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${esc(anyLabel)}</option>${values
    .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
    .join('')}`;
  if (values.includes(current)) select.value = current;
}

function renderStatus(health) {
  const chips = [
    health.keys?.paperclip ? chip('Paperclip live', 'clip') : chip('Paperclip missing', 'stop'),
    health.keys?.anthropic ? chip(`Claude ${health.model}`, 'claude') : chip('Claude missing', 'stop'),
  ];
  if (health.benchling?.reachable) chips.push(chip('Benchling live', 'bench'));
  else if (health.benchling?.configured) chips.push(chip('Benchling configured', 'gap'));
  else chips.push(chip('Derived structures', 'unknown'));
  el.status.innerHTML = chips.join('');
}

function renderHeroStats() {
  if (!state.catalogMeta || !state.pipeline) return;
  const stats = [
    ['Trials', state.catalogMeta.total?.toLocaleString() ?? '0'],
    ['CLARITY domains', state.pipeline.domains?.length ?? 0],
    ['Rubric', `v${state.pipeline.rubricVersion ?? '—'}`],
    ['Dossier', `v${state.pipeline.dossierVersion ?? '—'}`],
  ];
  el.heroStats.innerHTML = stats
    .map(([label, value]) => `<div><dt class="label">${esc(label)}</dt><dd class="counter mt-1 text-2xl text-ink">${esc(value)}</dd></div>`)
    .join('');
}

function renderPipeline() {
  if (!state.pipeline) return;
  registerPipeline(state.pipeline);
  if (el.heroGraph) createPipelineGraph(el.heroGraph, { domains: state.pipeline.domains, compact: true });
  el.methodSteps.innerHTML = [
    ['Paperclip retrieval', 'Source-scoped searches across trial registries, FDA review files and primary literature.'],
    ['CLARITY dossier', 'Nine domain passes produce citation-bearing findings, gaps, rationales and confidence.'],
    ['Claude FDA review', 'A rubric-scored reviewer pass consumes only the retrieved evidence and cited dossier.'],
    ['Benchling structure', 'Live sequence when tenant credentials resolve; otherwise an explicitly derived schematic.'],
  ]
    .map(
      ([title, body], i) => `<article class="panel panel-pad" style="animation-delay:${i * 70}ms">
        <p class="label">0${i + 1}</p>
        <h3 class="mt-3 text-[15px] font-semibold text-ink">${esc(title)}</h3>
        <p class="mt-2 text-[12px] leading-relaxed text-faint">${esc(body)}</p>
      </article>`,
    )
    .join('');
}

async function loadHealth() {
  try {
    renderStatus(await getJSON('/api/health'));
  } catch {
    el.status.innerHTML = chip('Server unreachable', 'stop');
  }
}

async function loadPipeline() {
  state.pipeline = await getJSON('/api/pipeline').catch(() => null);
  state.rubric = await getJSON('/api/rubric').catch(() => null);
  renderPipeline();
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if (el.search.value.trim() && !state.selected) params.set('q', el.search.value.trim());
  if (el.phase.value) params.set('phase', el.phase.value);
  if (el.area.value) params.set('area', el.area.value);

  try {
    const data = await getJSON(`/api/trials?${params}`);
    state.trials = data.trials;
    state.catalogMeta = data;
    if (!state.facets) {
      state.facets = data.facets;
      fillSelect(el.phase, data.facets.phases, 'Any phase');
      fillSelect(el.area, data.facets.areas, 'Any area');
    }
    el.catalogMeta.textContent = `${data.count} of ${data.total} trials · ${fmtDate(data.generatedAt)}`;
    renderHeroStats();
    renderCombo();
  } catch (err) {
    state.trials = [];
    el.catalogMeta.textContent = err.message;
    el.pop.innerHTML = `<p class="p-3 text-[12px] text-gap">${esc(err.message)}</p>`;
  }
}

function renderCombo() {
  const rows = state.trials.slice(0, 12);
  if (!rows.length) {
    el.pop.innerHTML = '<p class="p-3 text-[12px] text-faint">No trials match.</p>';
    return;
  }
  el.pop.innerHTML = `<div class="combo-list">${rows
    .map(
      (trial, index) => `<div class="combo-item" role="option" data-index="${index}" data-id="${esc(trial.trialId)}" tabindex="-1">
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
  el.pop.classList.remove('hidden');
  el.search.setAttribute('aria-expanded', 'true');
}

function closeCombo() {
  el.pop.classList.add('hidden');
  el.search.setAttribute('aria-expanded', 'false');
  state.activeIndex = -1;
}

async function selectTrial(trialId) {
  const local = state.trials.find((t) => t.trialId === trialId);
  const trial = local ?? (await getJSON(`/api/trials/${encodeURIComponent(trialId)}`)).trial;
  if (!trial) return;

  state.stream?.close();
  state.running = false;
  state.selected = trial;
  state.evaluation = null;
  state.geneModel = null;
  el.search.value = `${trial.therapeuticName} · ${trial.trialId}`;
  closeCombo();
  renderSelectedTrial();
  renderRunSurface();
  renderPanel();

  getJSON(`/api/evaluations/${encodeURIComponent(trial.trialId)}`)
    .then((evaluation) => {
      if (state.selected?.trialId !== trial.trialId) return;
      state.evaluation = evaluation;
      renderRunSurface({ complete: true });
      renderPanel();
    })
    .catch(() => {});

  getJSON(`/api/gene-model/${encodeURIComponent(trial.trialId)}`)
    .then((payload) => {
      if (state.selected?.trialId !== trial.trialId) return;
      state.geneModel = payload;
      renderRunSurface({ complete: Boolean(state.evaluation?.review) });
    })
    .catch(() => {});
}

function renderSelectedTrial() {
  const trial = state.selected;
  if (!trial) {
    el.selectedTrial.classList.add('hidden');
    el.runButton.disabled = true;
    return;
  }
  el.selectedTrial.classList.remove('hidden');
  el.runButton.disabled = state.running;
  el.runButton.textContent = state.evaluation ? 'Re-run review' : state.running ? 'Reviewing...' : 'Run FDA review';
  el.selectedTrial.innerHTML = `
    <div class="inset px-3 py-2.5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-[14px] font-semibold text-ink prose-wrap">${esc(trial.therapeuticName)}</p>
          <p class="mt-0.5 text-[12px] text-faint prose-wrap">${esc(trial.title || trial.condition || '')}</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1.5">
          ${chip(trial.trialId, 'info')}
          ${chip(trial.phase || 'phase unknown', 'unknown')}
          ${trial.modality ? chip(trial.modality, 'bench') : ''}
        </div>
      </div>
    </div>`;
}

function renderRunSurface({ complete = false } = {}) {
  if (!state.selected) {
    el.runSurface.innerHTML = '';
    return;
  }

  el.runSurface.innerHTML = `
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <div class="panel panel-lit panel-pad">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="label">Live agent graph</p>
            <p class="mt-1 text-[12px] text-faint">Paperclip retrieval, CLARITY dossier passes, Claude review, Benchling structure.</p>
          </div>
          <label class="no-print flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            <input id="capture-full-trace" type="checkbox" ${state.captureFullTrace ? 'checked' : ''} ${state.running ? 'disabled' : ''} />
            Full trace
          </label>
        </div>
        <div id="run-graph" class="mt-4"></div>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="inset px-3 py-2"><p class="label">paperclip</p><p id="counter-paperclip" class="counter mt-1 text-xl text-clip-400">0</p></div>
          <div class="inset px-3 py-2"><p class="label">claude events</p><p id="counter-claude" class="counter mt-1 text-xl text-claude-400">0</p></div>
          <div class="inset px-3 py-2"><p class="label">tokens/context</p><p id="counter-tokens" class="counter mt-1 text-xl text-bench-400">${tokenCount(state.evaluation).toLocaleString()}</p></div>
        </div>
        <div class="console mt-4"><ul id="progress-log" class="space-y-1">${complete ? consoleLine('sys', 'cached review loaded; graph replay complete') : ''}</ul></div>
      </div>
      <div id="gene-model"></div>
    </div>`;

  runGraph = createPipelineGraph(document.getElementById('run-graph'), {
    domains: state.pipeline?.domains ?? [],
  });
  if (complete || state.evaluation?.review) runGraph.completeAll();
  renderGeneModel(document.getElementById('gene-model'), state.geneModel, { onTargetProof: () => {} });

  document.getElementById('capture-full-trace')?.addEventListener('change', (event) => {
    state.captureFullTrace = event.target.checked;
    localStorage.setItem('fdaapproval.captureFullTrace', String(state.captureFullTrace));
  });
}

function tokenCount(evaluation) {
  const usage = evaluation?.meta?.usage ?? {};
  const dossier = evaluation?.meta?.usageByStage?.dossier ?? {};
  return ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens']
    .reduce((sum, key) => sum + Number(usage[key] ?? 0) + Number(dossier[key] ?? 0), 0);
}

function consoleLine(tag, body) {
  const tone = tag === 'paperclip' ? 'tag-clip' : tag === 'claude' ? 'tag-claude' : tag === 'benchling' ? 'tag-bench' : 'tag-sys';
  return `<li class="console-line"><span class="console-tag ${tone}">${esc(tag)}</span><span class="console-body">${esc(body)}</span></li>`;
}

function addProgress(step) {
  const log = document.getElementById('progress-log');
  if (!log) return;
  const tag = /bench/i.test(step.stage) ? 'benchling' : /review|dossier|synth/i.test(step.stage) ? 'claude' : /evidence|search|paperclip/i.test(step.stage) ? 'paperclip' : 'sys';
  log.insertAdjacentHTML('beforeend', consoleLine(tag, step.message || step.stage));
  log.parentElement.scrollTop = log.parentElement.scrollHeight;

  const paperclip = document.getElementById('counter-paperclip');
  const claude = document.getElementById('counter-claude');
  if (tag === 'paperclip' && paperclip) paperclip.textContent = String(Number(paperclip.textContent || 0) + 1);
  if (tag === 'claude' && claude) claude.textContent = String(Number(claude.textContent || 0) + 1);
  updateGraph(step);
}

function updateGraph(step) {
  if (!runGraph) return;
  const message = `${step.stage || ''} ${step.message || ''}`.toLowerCase();
  if (message.includes('reviewing')) {
    runGraph.activate('trial');
    setTimeout(() => runGraph.complete('trial'), 350);
  }
  if (message.includes('evidence') || message.includes('retriev') || message.includes('search')) runGraph.activate('retrieval');
  if (message.includes('synthesizing cited evidence') || message.includes('dossier')) {
    runGraph.complete('retrieval');
    runGraph.activate('dossier');
  }
  if (message.includes('scor') || message.includes('review')) {
    runGraph.complete('dossier');
    runGraph.activate('review');
  }
  for (const domain of state.pipeline?.domains ?? []) {
    if (message.includes(domain.label.toLowerCase()) || message.includes(domain.id.replaceAll('_', ' '))) {
      runGraph.complete('retrieval');
      runGraph.activate(domain.id);
      setTimeout(() => runGraph.complete(domain.id), 900);
    }
  }
}

function runReview({ force = false } = {}) {
  if (!state.selected || state.running) return;
  state.running = true;
  state.evaluation = null;
  el.runButton.disabled = true;
  el.runButton.textContent = 'Reviewing...';
  renderRunSurface();
  renderPanel();

  const params = new URLSearchParams();
  if (force) params.set('force', '1');
  if (state.captureFullTrace) params.set('trace', 'full');
  const url = `/api/evaluations/${encodeURIComponent(state.selected.trialId)}/stream${params.size ? `?${params}` : ''}`;
  const stream = new EventSource(url);
  state.stream = stream;

  stream.addEventListener('progress', (event) => addProgress(JSON.parse(event.data)));
  stream.addEventListener('result', (event) => {
    state.evaluation = JSON.parse(event.data);
    state.running = false;
    stream.close();
    state.stream = null;
    runGraph?.completeAll();
    const tokenCounter = document.getElementById('counter-tokens');
    if (tokenCounter) tokenCounter.textContent = tokenCount(state.evaluation).toLocaleString();
    el.runButton.disabled = false;
    el.runButton.textContent = 'Re-run review';
    renderPanel();
  });
  stream.addEventListener('error', (event) => {
    let message = 'Connection to the review stream was lost.';
    if (event.data) {
      try {
        message = JSON.parse(event.data).message || message;
      } catch {}
    }
    state.running = false;
    stream.close();
    state.stream = null;
    el.runButton.disabled = false;
    el.runButton.textContent = 'Run FDA review';
    renderPanel(message);
  });
}

function cockpit(review) {
  const probability = review.probabilityOfTrialSuccess ?? {};
  const confidence = review.confidence ?? {};
  const completeness = evidenceCompleteness(review);
  const verdict = probability.pointEstimate >= 65 ? ['Favorable', 'ok'] : probability.pointEstimate >= 40 ? ['Uncertain', 'gap'] : ['Unfavorable', 'stop'];
  return `
    <section class="panel panel-lit panel-pad rise">
      <div class="grid gap-5 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <button class="text-left" data-proof-kind="probability">
          <p class="label">Probability of trial success</p>
          <p class="mt-2 flex items-baseline gap-2">
            <span class="counter text-6xl font-semibold text-ink">${esc(probability.pointEstimate ?? '—')}</span>
            <span class="text-xl text-faint">%</span>
            ${chip(verdict[0], verdict[1])}
          </p>
          <p class="mt-2 font-mono text-[11px] text-ghost">range ${esc(probability.low ?? '—')}–${esc(probability.high ?? '—')} · click for calibration proof</p>
        </button>
        <div class="grid gap-3 md:grid-cols-3">
          ${metric('confidence', confidence.level ?? '—', confidence.rationale ?? '', CONFIDENCE_TONE[confidence.level] ?? 'unknown')}
          ${metric('evidence', pct(completeness), 'rubric weight backed by direct evidence', completeness > 0.7 ? 'ok' : completeness > 0.4 ? 'gap' : 'stop')}
          ${metric('tokens', tokenCount(state.evaluation).toLocaleString(), 'input, cache and output context used', 'bench')}
        </div>
      </div>
      <details class="mt-4">
        <summary class="disclosure"><span class="label">Reviewer summary</span>${ICON_CARET}</summary>
        <p class="mt-3 text-[13px] leading-relaxed text-muted prose-wrap">${esc(review.reviewerSummary)}</p>
      </details>
    </section>`;
}

function metric(label, value, sub, tone) {
  return `<div class="inset px-3 py-2.5">
    <p class="label">${esc(label)}</p>
    <p class="mt-1 flex items-center gap-2"><span class="counter text-xl text-ink">${esc(value)}</span>${chip('', tone)}</p>
    <p class="clamp-2 mt-1 text-[11px] leading-snug text-faint">${esc(sub)}</p>
  </div>`;
}

function domainGrid(review) {
  return `
    <section class="panel panel-pad rise">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="label">CLARITY scorecard</p>
          <h3 class="mt-1 text-[15px] font-semibold text-ink">Ten domains, each with proof.</h3>
        </div>
        ${chip(`rubric v${state.rubric?.version ?? '—'}`, 'info')}
      </div>
      <div class="mt-4 grid gap-2 lg:grid-cols-2">
        ${(review.criteria ?? []).map((criterion, i) => domainCard(criterion, i)).join('')}
      </div>
    </section>`;
}

function domainCard(criterion, i) {
  const tone = scoreTone(criterion);
  const counts = {
    findings: criterion.supportingFindings?.length ?? 0,
    concerns: criterion.concerns?.length ?? 0,
    gaps: criterion.informationGaps?.length ?? 0,
  };
  return `<details class="inset px-3 py-2.5" ${i === 0 ? 'open' : ''}>
    <summary class="flex cursor-pointer list-none items-center gap-3">
      <span class="min-w-0 flex-1">
        <span class="block truncate text-[13px] font-semibold text-ink">${esc(criterion.label ?? criterion.id)}</span>
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
        ${chip(`weight ${pct(weightFor(criterion))}`, 'unknown')}
        ${chip(`${counts.findings} findings`, 'ok')}
        ${chip(`${counts.concerns} concerns`, counts.concerns ? 'gap' : 'unknown')}
        ${chip(`${counts.gaps} gaps`, counts.gaps ? 'gap' : 'unknown')}
      </div>
      ${miniEvidence(criterion)}
    </div>
  </details>`;
}

function miniEvidence(criterion) {
  const index = citationIndex(state.evaluation);
  const findings = criterion.supportingFindings ?? [];
  const concerns = criterion.concerns ?? [];
  return `
    <details class="mt-3">
      <summary class="disclosure !px-0"><span class="label">evidence lines</span>${ICON_CARET}</summary>
      <div class="mt-2 grid gap-2">
        ${findings
          .slice(0, 4)
          .map(
            (finding) => `<div class="evidence-row rule-ok">
              <p class="text-[12px] leading-snug text-muted prose-wrap">${esc(finding.finding)} ${proofButton('claim', claimPayload(criterion.id, finding.finding, finding.source, 'supporting finding'))}</p>
              ${sourceRow(finding.source, index)}
            </div>`,
          )
          .join('')}
        ${concerns
          .slice(0, 3)
          .map(
            (concern) => `<div class="evidence-row rule-${SEVERITY_TONE[concern.severity] ?? 'unknown'}">
              <p class="text-[12px] leading-snug text-muted prose-wrap">${esc(concern.concern)} ${proofButton('claim', claimPayload(criterion.id, concern.concern, concern.source, `${concern.severity} concern`))}</p>
              ${sourceRow(concern.source, index)}
            </div>`,
          )
          .join('')}
      </div>
    </details>`;
}

function claimPayload(domainId, claim, source, label) {
  return JSON.stringify({ domainId, claim, source, label });
}

function actionPanel(review) {
  const drivers = review.keyDrivers ?? [];
  const actions = review.deRiskingActions ?? [];
  const flags = review.redFlags ?? [];
  return `
    <section class="grid gap-4 lg:grid-cols-3">
      ${compactList('Key drivers', drivers, (driver) => `${driver.direction ?? ''} · ${driver.weight ?? ''} · ${driver.driver ?? driver}`)}
      ${compactList('De-risking actions', actions, (action) => `${action.priority ?? ''} · ${action.action ?? action}`, (action) => PRIORITY_TONE[action.priority] ?? 'unknown')}
      ${compactList('Red flags', flags, (flag) => flag.flag ?? flag, () => flags.length ? 'stop' : 'unknown')}
    </section>`;
}

function compactList(title, rows, body, tone = () => 'info') {
  return `<details class="panel panel-pad rise" ${rows.length ? '' : 'open'}>
    <summary class="disclosure !px-0 !py-0">
      <span><span class="label">${esc(title)}</span><span class="mt-1 block text-[13px] font-semibold text-ink">${rows.length} items</span></span>
      ${ICON_CARET}
    </summary>
    <ul class="mt-3 space-y-2">
      ${(rows.length ? rows : ['No items recorded.'])
        .slice(0, 6)
        .map((row) => `<li class="evidence-row rule-${tone(row)} text-[12px] leading-snug text-muted prose-wrap">${esc(body(row))}</li>`)
        .join('')}
    </ul>
  </details>`;
}

function dossierPanel(evaluation) {
  const dossier = evaluation.evidence?.dossier;
  if (!dossier?.domains?.length) return '';
  return `<details class="panel panel-pad print-urls">
    <summary class="disclosure !px-0 !py-0">
      <span><span class="label">Cited evidence dossier</span><span class="mt-1 block text-[13px] font-semibold text-ink">${esc(dossier.phaseLabel || dossier.phase || 'CLARITY')} · ${dossier.domains.length} domains</span></span>
      ${ICON_CARET}
    </summary>
    <div class="mt-4 grid gap-3">
      ${dossier.domains
        .map(
          (domain) => `<details class="inset px-3 py-2.5">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-3">
              <span class="text-[13px] font-semibold text-ink">${esc(domain.domainLabel)}</span>
              ${chip(domain.status ?? 'generated', domain.status === 'not_applicable' ? 'unknown' : 'info')}
            </summary>
            <p class="mt-2 text-[12px] leading-relaxed text-faint prose-wrap">${esc(domain.summary || 'Not generated for this phase.')}</p>
            <div class="mt-3 space-y-2">
              ${(domain.elements ?? [])
                .map(
                  (item) => `<div class="evidence-row rule-info">
                    <p class="text-[12px] font-semibold text-ink">${esc(item.element)}</p>
                    <p class="mt-1 text-[12px] leading-snug text-muted prose-wrap">${esc(item.finding)}</p>
                    <p class="mt-1 font-mono text-[10px] text-ghost">${esc(item.confidenceScore ?? '—')}% confidence · ${esc(item.rationale || '')}</p>
                    ${
                      item.citations?.length
                        ? `<div class="mt-1.5 flex flex-wrap gap-1">${item.citations
                            .map((c) =>
                              sourcePill({
                                title: c.title || c.identifier || 'Source',
                                type: SOURCE_TYPE_LABEL[c.sourceType] ?? inferType(c.title || ''),
                                url: safeHttpsUrl(c.url),
                                ids: c.identifier ? [c.identifier] : [],
                              }),
                            )
                            .join('')}</div>`
                        : '<p class="mt-1.5 text-[11px] text-ghost">No direct public source found.</p>'
                    }
                  </div>`,
                )
                .join('')}
            </div>
          </details>`,
        )
        .join('')}
    </div>
  </details>`;
}

function provenancePanel(evaluation) {
  const usage = evaluation.meta?.usage ?? {};
  const sections = evaluation.evidence?.sections ?? [];
  const trace = evaluation.meta?.trace;
  const traceUrl = trace?.traceId
    ? `/api/evaluations/${encodeURIComponent(evaluation.trial?.trialId ?? '')}/traces/${encodeURIComponent(trace.traceId)}`
    : '';
  return `<details class="panel panel-pad">
    <summary class="disclosure !px-0 !py-0">
      <span><span class="label">Paperclip + Claude run</span><span class="mt-1 block text-[13px] font-semibold text-ink">${sections.length} retrieval sections · ${tokenCount(evaluation).toLocaleString()} tokens/context</span></span>
      ${ICON_CARET}
    </summary>
    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <div class="inset px-3 py-2.5">
        <p class="label">model</p>
        <p class="mt-1 font-mono text-[12px] text-ink">${esc(evaluation.meta?.model ?? '—')} · ${esc(evaluation.meta?.effort ?? '—')}</p>
        <dl class="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-faint">
          <div><dt class="text-ghost">input</dt><dd>${(usage.input_tokens ?? 0).toLocaleString()}</dd></div>
          <div><dt class="text-ghost">cache read</dt><dd>${(usage.cache_read_input_tokens ?? 0).toLocaleString()}</dd></div>
          <div><dt class="text-ghost">cache write</dt><dd>${(usage.cache_creation_input_tokens ?? 0).toLocaleString()}</dd></div>
          <div><dt class="text-ghost">output</dt><dd>${(usage.output_tokens ?? 0).toLocaleString()}</dd></div>
        </dl>
        ${traceUrl ? `<p class="mt-3"><a class="src-link" href="${esc(traceUrl)}" target="_blank" rel="noreferrer">open ${esc(trace.mode)} trace${ICON_EXTERNAL}</a></p>` : ''}
      </div>
      <div class="console">
        <ul class="space-y-1">${sections
          .slice(0, 12)
          .map((section) => consoleLine('paperclip', `${section.label}: ${section.query || section.source} (${(section.chars ?? 0).toLocaleString()} chars)`))
          .join('')}</ul>
      </div>
    </div>
  </details>`;
}

function errorPanel(message) {
  return `<section class="panel panel-pad border-red-300">
    <p class="text-sm font-semibold text-stop">Review failed</p>
    <p class="mt-2 text-[13px] text-muted prose-wrap">${esc(message)}</p>
  </section>`;
}

function renderPanel(error) {
  if (!state.selected) {
    el.panel.innerHTML = `<div class="panel panel-pad"><p class="text-[13px] text-faint">Select a trial to open the review lab.</p></div>`;
    return;
  }
  const parts = [];
  if (error) parts.push(errorPanel(error));
  if (state.running) {
    parts.push(`<div class="panel panel-pad"><p class="text-[13px] text-faint">Review running. The graph above is the live state; results will unfold here when the stream returns.</p></div>`);
  }
  if (state.evaluation?.review) {
    const review = state.evaluation.review;
    parts.push(cockpit(review), actionPanel(review), domainGrid(review), dossierPanel(state.evaluation), provenancePanel(state.evaluation));
  } else if (!state.running && !error) {
    parts.push(`<div class="panel panel-pad">
      <p class="text-[13px] leading-relaxed text-faint">
        No cached review for this trial yet. Run FDA review to retrieve Paperclip evidence, synthesize the CLARITY dossier, score the rubric, and render proof-backed claims.
      </p>
    </div>`);
  }
  el.panel.innerHTML = `<div class="space-y-4">${parts.join('')}</div>`;
  wireProofButtons();
}

function wireProofButtons() {
  el.panel.querySelectorAll('[data-proof-kind]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!state.evaluation?.review) return;
      const kind = button.dataset.proofKind;
      if (kind === 'probability') proveProbability({ evaluation: state.evaluation });
      if (kind === 'domain') {
        const criterion = state.evaluation.review.criteria.find((c) => c.id === button.dataset.proof);
        if (criterion) proveDomain({ evaluation: state.evaluation, criterion, weight: weightFor(criterion), dossierDomainId: criterion.id });
      }
      if (kind === 'claim') {
        const payload = JSON.parse(button.dataset.proof || '{}');
        proveClaim({
          evaluation: state.evaluation,
          claim: payload.claim,
          sourceText: payload.source,
          context: { domainId: payload.domainId, label: payload.label },
        });
      }
    });
  });
}

function wire() {
  el.search.addEventListener('focus', openCombo);
  el.search.addEventListener('input', debounce(() => {
    state.selected = null;
    openCombo();
    loadCatalog();
  }));
  el.search.addEventListener('keydown', (event) => {
    const items = [...el.pop.querySelectorAll('.combo-item')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openCombo();
      state.activeIndex = Math.max(0, Math.min(items.length - 1, state.activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((item, i) => item.dataset.active = String(i === state.activeIndex));
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
  el.pop.addEventListener('click', (event) => {
    const item = event.target.closest('.combo-item');
    if (item) selectTrial(item.dataset.id);
  });
  el.phase.addEventListener('change', loadCatalog);
  el.area.addEventListener('change', loadCatalog);
  el.runButton.addEventListener('click', () => runReview({ force: Boolean(state.evaluation) }));
  window.addEventListener('beforeunload', () => state.stream?.close());
  window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach((d) => (d.open = true)));
}

(async function init() {
  renderHeroBio(el.heroBio);
  wire();
  await Promise.all([loadHealth(), loadPipeline(), loadCatalog()]);
})();
