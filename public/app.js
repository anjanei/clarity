// FDA Approval Review — vanilla frontend.
// Catalog comes from data/trials.json via /api/trials; reviews stream over SSE.

const state = {
  trials: [],
  facets: null,
  catalogMeta: null,
  rubric: null,
  selected: null,
  evaluation: null,
  running: false,
  stream: null,
};

const el = {
  health: document.getElementById('health'),
  search: document.getElementById('search'),
  phase: document.getElementById('filter-phase'),
  area: document.getElementById('filter-area'),
  catalogMeta: document.getElementById('catalog-meta'),
  list: document.getElementById('trial-list'),
  panel: document.getElementById('panel'),
};

/* -------------------------------------------------------------- helpers */

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));

const debounce = (fn, ms = 180) => {
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

const STRENGTH_STYLE = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  moderate: 'border-accent-200 bg-accent-50 text-accent-700',
  weak: 'border-amber-200 bg-amber-50 text-amber-700',
  absent: 'border-slate-200 bg-slate-100 text-slate-500',
};

const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  major: 'border-amber-200 bg-amber-50 text-amber-700',
  minor: 'border-slate-200 bg-slate-100 text-slate-600',
};

const PRIORITY_STYLE = {
  immediate: 'border-red-200 bg-red-50 text-red-700',
  'near-term': 'border-amber-200 bg-amber-50 text-amber-700',
  later: 'border-slate-200 bg-slate-100 text-slate-600',
};

const ELIGIBILITY_STYLE = {
  likely: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  possible: 'border-accent-200 bg-accent-50 text-accent-700',
  unlikely: 'border-slate-200 bg-slate-100 text-slate-500',
};

const chip = (text, classes = 'border-slate-200 bg-slate-100 text-slate-600') =>
  `<span class="chip ${classes}">${esc(text)}</span>`;

const scorePips = (score) =>
  `<span class="score-track" aria-hidden="true">${[1, 2, 3, 4, 5]
    .map((n) => `<span class="score-pip" data-on="${n <= score}"></span>`)
    .join('')}</span>`;

const list = (items, render) =>
  items?.length ? `<ul class="space-y-1.5">${items.map(render).join('')}</ul>` : '';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/* ---------------------------------------------------------------- health */

async function loadHealth() {
  try {
    const health = await getJSON('/api/health');
    const chips = [];
    chips.push(
      health.keys.paperclip
        ? chip('Paperclip key set', 'border-emerald-200 bg-emerald-50 text-emerald-700')
        : chip('PAPERCLIP_API_KEY missing', 'border-red-200 bg-red-50 text-red-700'),
    );
    chips.push(
      health.keys.anthropic
        ? chip(`Claude · ${health.model}`, 'border-emerald-200 bg-emerald-50 text-emerald-700')
        : chip('ANTHROPIC_API_KEY missing', 'border-red-200 bg-red-50 text-red-700'),
    );
    if (health.paperclip?.reachable) {
      chips.push(chip('Paperclip connected', 'border-slate-200 bg-slate-100 text-slate-600'));
    } else if (health.paperclip?.error) {
      chips.push(chip('Paperclip unreachable', 'border-amber-200 bg-amber-50 text-amber-700'));
    }
    el.health.innerHTML = chips.join('');
  } catch {
    el.health.innerHTML = chip('Server unreachable', 'border-red-200 bg-red-50 text-red-700');
  }
}

/* --------------------------------------------------------------- catalog */

function fillSelect(select, values) {
  const current = select.value;
  select.innerHTML = `<option value="">Any</option>${values
    .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
    .join('')}`;
  if (values.includes(current)) select.value = current;
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if (el.search.value.trim()) params.set('q', el.search.value.trim());
  if (el.phase.value) params.set('phase', el.phase.value);
  if (el.area.value) params.set('area', el.area.value);

  el.list.setAttribute('aria-busy', 'true');
  try {
    const data = await getJSON(`/api/trials?${params}`);
    state.trials = data.trials;
    state.catalogMeta = data;

    if (!state.facets) {
      state.facets = data.facets;
      fillSelect(el.phase, data.facets.phases);
      fillSelect(el.area, data.facets.areas);
    }

    el.catalogMeta.textContent = `${data.count} of ${data.total} trials · catalog built ${fmtDate(
      data.generatedAt,
    )}`;
    renderList();
  } catch (err) {
    state.trials = [];
    el.catalogMeta.textContent = '';
    el.list.innerHTML = `
      <div class="p-6 text-sm text-slate-600">
        <p class="font-medium text-slate-900">Catalog unavailable</p>
        <p class="mt-1.5">${esc(err.message)}</p>
        ${
          err.body?.error === 'catalog_missing'
            ? '<p class="mt-3 rounded-md bg-slate-100 px-3 py-2 font-mono text-xs">npm run catalog</p>'
            : ''
        }
      </div>`;
  } finally {
    el.list.removeAttribute('aria-busy');
  }
}

function renderList() {
  if (!state.trials.length) {
    el.list.innerHTML = '<p class="p-6 text-sm text-slate-500">No trials match these filters.</p>';
    return;
  }

  el.list.innerHTML = state.trials
    .map((trial) => {
      const selected = state.selected?.trialId === trial.trialId;
      return `
        <div class="trial-item" role="option" aria-selected="${selected}" data-id="${esc(trial.trialId)}" tabindex="0">
          <p class="truncate text-sm font-semibold text-slate-900">${esc(trial.therapeuticName)}</p>
          <p class="mt-0.5 truncate text-xs text-slate-500">${esc(trial.sponsor)}</p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${chip(trial.phase)}
            ${trial.modality && trial.modality !== 'Unknown' ? chip(trial.modality) : ''}
            <span class="font-mono text-[11px] text-slate-400">${esc(trial.trialId)}</span>
          </div>
          ${trial.condition ? `<p class="mt-1.5 line-clamp-2 text-xs text-slate-500">${esc(trial.condition)}</p>` : ''}
        </div>`;
    })
    .join('');
}

/* ------------------------------------------------------------- selection */

async function selectTrial(trialId) {
  const trial = state.trials.find((t) => t.trialId === trialId);
  if (!trial) return;

  state.stream?.close();
  state.stream = null;
  state.running = false;
  state.selected = trial;
  state.evaluation = null;
  renderList();

  // Show the cached review immediately if one exists.
  try {
    state.evaluation = await getJSON(`/api/evaluations/${encodeURIComponent(trialId)}`);
  } catch {
    state.evaluation = null;
  }
  renderPanel();
}

/* ---------------------------------------------------------------- review */

function runReview({ force = false } = {}) {
  if (!state.selected || state.running) return;

  state.running = true;
  state.evaluation = null;
  renderPanel();
  const log = document.getElementById('progress-log');

  const url = `/api/evaluations/${encodeURIComponent(state.selected.trialId)}/stream${force ? '?force=1' : ''}`;
  const stream = new EventSource(url);
  state.stream = stream;

  stream.addEventListener('progress', (event) => {
    const step = JSON.parse(event.data);
    if (!log) return;
    const line = document.createElement('li');
    line.className = 'flex gap-2 text-xs text-slate-600';
    line.innerHTML = `<span class="font-mono text-slate-400">${esc(step.stage)}</span><span>${esc(step.message)}</span>`;
    log.append(line);
    log.parentElement.scrollTop = log.parentElement.scrollHeight;
  });

  stream.addEventListener('result', (event) => {
    state.evaluation = JSON.parse(event.data);
    state.running = false;
    stream.close();
    state.stream = null;
    renderPanel();
  });

  stream.addEventListener('error', (event) => {
    // A `message`-bearing event is our own error payload; otherwise it is a transport drop.
    let message = 'Connection to the review stream was lost.';
    if (event.data) {
      try {
        message = JSON.parse(event.data).message || message;
      } catch {
        /* keep default */
      }
    }
    state.running = false;
    stream.close();
    state.stream = null;
    renderPanel({ error: message });
  });
}

/* ----------------------------------------------------------- report view */

function trialHeader() {
  const trial = state.selected;
  const cached = state.evaluation?.cached;
  return `
    <div class="card card-pad">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="label">Therapeutic under review</p>
          <h2 class="mt-1 text-xl font-semibold tracking-tight text-slate-900">${esc(trial.therapeuticName)}</h2>
          <p class="mt-1 text-sm text-slate-600">${esc(trial.sponsor)}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            ${chip(trial.phase)}
            ${chip(`Start ${trial.startDate}`)}
            ${trial.modality && trial.modality !== 'Unknown' ? chip(trial.modality) : ''}
            ${trial.registry && trial.registry !== 'Unknown' ? chip(trial.registry) : ''}
            <span class="chip chip-neutral font-mono">${esc(trial.trialId)}</span>
          </div>
          ${trial.condition ? `<p class="mt-3 text-sm text-slate-600">${esc(trial.condition)}</p>` : ''}
          ${trial.title ? `<p class="mt-1 text-xs text-slate-500">${esc(trial.title)}</p>` : ''}
        </div>
        <div class="flex shrink-0 flex-col items-end gap-2">
          <button id="run-review" class="btn-primary" ${state.running ? 'disabled' : ''}>
            ${state.running ? 'Reviewing…' : state.evaluation ? 'Re-run review' : 'Run FDA review'}
          </button>
          ${cached ? `<span class="text-xs text-slate-400">cached ${esc(fmtDate(state.evaluation.meta?.evaluatedAt))}</span>` : ''}
        </div>
      </div>
    </div>`;
}

function progressCard() {
  return `
    <div class="card card-pad rise">
      <div class="flex items-center gap-3">
        <span class="size-2 animate-pulse rounded-full bg-accent-600"></span>
        <p class="text-sm font-medium text-slate-900">Retrieving evidence and scoring the rubric</p>
      </div>
      <p class="mt-1 text-xs text-slate-500">
        A full review runs Paperclip retrieval across seven evidence tracks, then a single
        high-effort reasoning pass. This usually takes a few minutes.
      </p>
      <div class="mt-4 max-h-56 overflow-y-auto rounded-lg bg-slate-50 p-3">
        <ul id="progress-log" class="space-y-1"></ul>
      </div>
    </div>`;
}

function probabilityCard(review) {
  const p = review.probabilityOfTrialSuccess;
  const span = Math.max(1, p.high - p.low);
  return `
    <div class="card card-pad rise">
      <div class="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        <div class="sm:pr-6 sm:border-r sm:border-slate-200">
          <p class="label">Probability of completing clinical trials</p>
          <p class="mt-1 flex items-baseline gap-1">
            <span class="text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">${p.pointEstimate}</span>
            <span class="text-xl font-medium text-slate-400">%</span>
          </p>
          <p class="mt-1 text-xs text-slate-500 tabular-nums">range ${p.low}–${p.high}%</p>

          <div class="mt-3 w-full sm:w-52">
            <div class="relative h-2 rounded-full bg-slate-200">
              <div class="absolute inset-y-0 rounded-full bg-accent-200"
                   style="left:${p.low}%;width:${span}%"></div>
              <div class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-700"
                   style="left:${p.pointEstimate}%"></div>
            </div>
            <div class="mt-1 flex justify-between text-[10px] text-slate-400 tabular-nums">
              <span>0</span><span>50</span><span>100</span>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-1.5">
            ${chip(`${review.confidence.level} confidence`, STRENGTH_STYLE[review.confidence.level === 'high' ? 'strong' : review.confidence.level === 'moderate' ? 'moderate' : 'weak'])}
            ${chip(`evidence: ${review.evidenceQuality.overall}`, STRENGTH_STYLE[review.evidenceQuality.overall])}
            ${review.weightedRubricScore != null ? chip(`rubric ${review.weightedRubricScore}/5`) : ''}
          </div>
        </div>

        <div class="space-y-4">
          <div>
            <p class="label">Reviewer summary</p>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-700">${esc(review.reviewerSummary)}</p>
          </div>
          <div>
            <p class="label">Calibration basis</p>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">${esc(p.basis)}</p>
          </div>
          <div>
            <p class="label">Confidence rationale</p>
            <p class="mt-1.5 text-sm leading-relaxed text-slate-600">${esc(review.confidence.rationale)}</p>
          </div>
        </div>
      </div>
    </div>`;
}

function criterionCard(criterion) {
  const strength = STRENGTH_STYLE[criterion.evidenceStrength] ?? STRENGTH_STYLE.absent;
  return `
    <div class="card card-pad">
      <div class="flex items-start justify-between gap-3">
        <h4 class="text-sm font-semibold text-slate-900">${esc(criterion.label ?? criterion.id)}</h4>
        <span class="shrink-0 text-sm font-semibold tabular-nums text-slate-900">${criterion.score}<span class="text-slate-400">/5</span></span>
      </div>
      <div class="mt-2">${scorePips(criterion.score)}</div>
      <div class="mt-3 flex flex-wrap gap-1.5">
        ${chip(`evidence: ${criterion.evidenceStrength}`, strength)}
        ${criterion.weight != null ? chip(`weight ${Math.round(criterion.weight * 100)}%`) : ''}
      </div>
      <p class="mt-3 text-sm leading-relaxed text-slate-700">${esc(criterion.assessment)}</p>

      ${
        criterion.supportingFindings?.length
          ? `<div class="mt-4">
               <p class="label">Supporting findings</p>
               ${list(
                 criterion.supportingFindings,
                 (f) => `<li class="text-sm text-slate-700">
                   <span>${esc(f.finding)}</span>
                   <span class="ml-1 text-xs text-slate-400">— ${esc(f.source)}</span>
                 </li>`,
               )}
             </div>`
          : ''
      }

      ${
        criterion.concerns?.length
          ? `<div class="mt-4">
               <p class="label">Reviewer concerns</p>
               ${list(
                 criterion.concerns,
                 (c) => `<li class="flex flex-wrap items-baseline gap-2 text-sm text-slate-700">
                   ${chip(c.severity, SEVERITY_STYLE[c.severity] ?? SEVERITY_STYLE.minor)}
                   <span class="min-w-0 flex-1">${esc(c.concern)}${
                     c.source ? `<span class="ml-1 text-xs text-slate-400">— ${esc(c.source)}</span>` : ''
                   }</span>
                 </li>`,
               )}
             </div>`
          : ''
      }

      ${
        criterion.informationGaps?.length
          ? `<details class="mt-4 rounded-lg bg-slate-50 px-3 py-2">
               <summary class="cursor-pointer text-xs font-semibold text-slate-600">
                 Information gaps (${criterion.informationGaps.length})
               </summary>
               <ul class="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
                 ${criterion.informationGaps.map((gap) => `<li>${esc(gap)}</li>`).join('')}
               </ul>
             </details>`
          : ''
      }
    </div>`;
}

function driversCard(review) {
  const drivers = review.keyDrivers ?? [];
  const flags = review.redFlags ?? [];
  return `
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card card-pad">
        <p class="label">Key drivers</p>
        ${
          drivers.length
            ? `<ul class="mt-3 space-y-2">${drivers
                .map(
                  (d) => `<li class="flex items-start gap-2 text-sm text-slate-700">
                    <span class="mt-0.5 shrink-0 ${d.direction === 'increases' ? 'text-emerald-600' : 'text-red-600'}" aria-hidden="true">
                      ${d.direction === 'increases' ? '▲' : '▼'}
                    </span>
                    <span class="min-w-0 flex-1">${esc(d.driver)}</span>
                    ${chip(d.weight)}
                  </li>`,
                )
                .join('')}</ul>`
            : '<p class="mt-2 text-sm text-slate-500">None identified.</p>'
        }
      </div>
      <div class="card card-pad ${flags.length ? 'border-red-200' : ''}">
        <p class="label ${flags.length ? 'text-red-600' : ''}">Red flags</p>
        ${
          flags.length
            ? `<ul class="mt-3 space-y-3">${flags
                .map(
                  (f) => `<li class="text-sm">
                    <p class="font-medium text-slate-900">${esc(f.flag)}</p>
                    <p class="mt-0.5 text-slate-600">${esc(f.why)}</p>
                  </li>`,
                )
                .join('')}</ul>`
            : '<p class="mt-2 text-sm text-slate-500">No program-stopping issues identified in the supplied evidence.</p>'
        }
      </div>
    </div>`;
}

function actionsCard(review) {
  const actions = review.deRiskingActions ?? [];
  if (!actions.length) return '';
  const labelFor = (id) =>
    state.rubric?.dimensions.find((d) => d.id === id)?.label ?? id;
  return `
    <div class="card card-pad">
      <p class="label">Recommended de-risking actions</p>
      <ul class="mt-3 space-y-2.5">
        ${actions
          .map(
            (a) => `<li class="flex flex-wrap items-baseline gap-2 text-sm text-slate-700">
              ${chip(a.priority, PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.later)}
              <span class="min-w-0 flex-1">${esc(a.action)}</span>
              <span class="text-xs text-slate-400">${esc(labelFor(a.addresses))}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </div>`;
}

function contextCard(review) {
  const precedents = review.regulatoryPrecedents ?? [];
  const pathways = review.expeditedPathways ?? [];
  if (!precedents.length && !pathways.length) return '';
  return `
    <div class="grid gap-4 lg:grid-cols-2">
      ${
        precedents.length
          ? `<div class="card card-pad">
               <p class="label">Regulatory precedents</p>
               <ul class="mt-3 space-y-3">
                 ${precedents
                   .map(
                     (p) => `<li class="text-sm">
                       <p class="font-medium text-slate-900">${esc(p.product)}${
                         p.outcome ? ` <span class="font-normal text-slate-500">— ${esc(p.outcome)}</span>` : ''
                       }</p>
                       <p class="mt-0.5 text-slate-600">${esc(p.relevance)}</p>
                     </li>`,
                   )
                   .join('')}
               </ul>
             </div>`
          : ''
      }
      ${
        pathways.length
          ? `<div class="card card-pad">
               <p class="label">Expedited pathways</p>
               <ul class="mt-3 space-y-3">
                 ${pathways
                   .map(
                     (p) => `<li class="text-sm">
                       <p class="flex flex-wrap items-center gap-2">
                         <span class="font-medium text-slate-900">${esc(p.pathway)}</span>
                         ${chip(p.eligibility, ELIGIBILITY_STYLE[p.eligibility] ?? ELIGIBILITY_STYLE.unlikely)}
                       </p>
                       <p class="mt-0.5 text-slate-600">${esc(p.rationale)}</p>
                     </li>`,
                   )
                   .join('')}
               </ul>
             </div>`
          : ''
      }
    </div>`;
}

function provenanceCard(evaluation) {
  const { evidence, meta, review } = evaluation;
  const usage = meta?.usage ?? {};
  return `
    <details class="card card-pad">
      <summary class="cursor-pointer text-sm font-semibold text-slate-900">
        Evidence provenance and run details
      </summary>

      <p class="mt-3 text-sm leading-relaxed text-slate-600">${esc(review.evidenceQuality.notes)}</p>

      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="text-slate-500">
            <tr class="border-b border-slate-200">
              <th class="py-1.5 pr-3 font-semibold">Evidence track</th>
              <th class="py-1.5 pr-3 font-semibold">Source</th>
              <th class="py-1.5 pr-3 font-semibold">Chars</th>
              <th class="py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody class="text-slate-600">
            ${evidence.sections
              .map(
                (s) => `<tr class="border-b border-slate-100 last:border-b-0">
                  <td class="py-1.5 pr-3">${esc(s.label)}</td>
                  <td class="py-1.5 pr-3 font-mono">${esc(s.source)}</td>
                  <td class="py-1.5 pr-3 tabular-nums">${s.chars.toLocaleString()}</td>
                  <td class="py-1.5">${
                    s.error
                      ? `<span class="text-amber-700">${esc(s.error)}</span>`
                      : '<span class="text-emerald-700">ok</span>'
                  }</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        <div><dt class="text-slate-500">Model</dt><dd class="font-mono text-slate-800">${esc(meta?.model ?? '—')}</dd></div>
        <div><dt class="text-slate-500">Effort</dt><dd class="text-slate-800">${esc(meta?.effort ?? '—')}</dd></div>
        <div><dt class="text-slate-500">Rubric</dt><dd class="text-slate-800">v${esc(meta?.rubricVersion ?? '—')}</dd></div>
        <div><dt class="text-slate-500">Evaluated</dt><dd class="text-slate-800">${esc(fmtDate(meta?.evaluatedAt))}</dd></div>
        <div><dt class="text-slate-500">Input tokens</dt><dd class="tabular-nums text-slate-800">${(usage.input_tokens ?? 0).toLocaleString()}</dd></div>
        <div><dt class="text-slate-500">Cache read</dt><dd class="tabular-nums text-slate-800">${(usage.cache_read_input_tokens ?? 0).toLocaleString()}</dd></div>
        <div><dt class="text-slate-500">Cache write</dt><dd class="tabular-nums text-slate-800">${(usage.cache_creation_input_tokens ?? 0).toLocaleString()}</dd></div>
        <div><dt class="text-slate-500">Output tokens</dt><dd class="tabular-nums text-slate-800">${(usage.output_tokens ?? 0).toLocaleString()}</dd></div>
      </dl>
    </details>`;
}

function errorCard(message) {
  return `
    <div class="card card-pad border-red-200 rise">
      <p class="text-sm font-semibold text-red-700">Review failed</p>
      <p class="mt-1.5 text-sm text-slate-700">${esc(message)}</p>
      <p class="mt-3 text-xs text-slate-500">
        If this mentions Paperclip tools, run <code class="rounded bg-slate-100 px-1 py-0.5 font-mono">npm run probe</code>
        to inspect the live tool list.
      </p>
    </div>`;
}

function renderPanel({ error } = {}) {
  if (!state.selected) return;

  const parts = [trialHeader()];
  if (error) parts.push(errorCard(error));
  if (state.running) parts.push(progressCard());

  if (state.evaluation?.review) {
    const review = state.evaluation.review;
    parts.push(
      probabilityCard(review),
      `<div class="rise">
         <p class="label mb-3">Rubric assessment</p>
         <div class="grid gap-4 xl:grid-cols-2">${review.criteria.map(criterionCard).join('')}</div>
       </div>`,
      `<div class="rise space-y-4">
         ${driversCard(review)}
         ${actionsCard(review)}
         ${contextCard(review)}
         ${provenanceCard(state.evaluation)}
       </div>`,
    );
  } else if (!state.running && !error) {
    parts.push(`
      <div class="card card-pad">
        <p class="text-sm text-slate-600">
          No review yet for this trial. Running one retrieves evidence from Paperclip across
          registry records, FDA review documents and the literature, then scores six rubric
          dimensions and produces a calibrated probability of completing clinical trials.
        </p>
      </div>`);
  }

  el.panel.innerHTML = `<div class="space-y-4">${parts.join('')}</div>`;
  document.getElementById('run-review')?.addEventListener('click', () =>
    runReview({ force: Boolean(state.evaluation) }),
  );
}

/* ------------------------------------------------------------------ wire */

el.list.addEventListener('click', (event) => {
  const item = event.target.closest('.trial-item');
  if (item) selectTrial(item.dataset.id);
});

el.list.addEventListener('keydown', (event) => {
  const item = event.target.closest?.('.trial-item');
  if (!item) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectTrial(item.dataset.id);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const sibling = event.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
    sibling?.focus();
  }
});

el.search.addEventListener('input', debounce(loadCatalog));
el.phase.addEventListener('change', loadCatalog);
el.area.addEventListener('change', loadCatalog);

window.addEventListener('beforeunload', () => state.stream?.close());

(async function init() {
  loadHealth();
  getJSON('/api/rubric')
    .then((rubric) => {
      state.rubric = rubric;
    })
    .catch(() => {});
  await loadCatalog();
})();
