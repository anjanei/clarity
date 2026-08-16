// The proof drawer.
//
// Every score, finding, concern and probability in the report can be opened to
// the chain that produced it:
//
//   claim → cited source(s) → the dossier element that extracted it, with the
//   extractor's own rationale and confidence → the exact Paperclip command that
//   retrieved the document → the run that scored it.
//
// Where a link in that chain genuinely does not exist — an older cached review
// with no dossier, a finding citing nothing resolvable — the step is rendered as
// missing rather than filled with something plausible. A broken chain shown
// honestly is the difference between provenance and decoration.

import { SOURCE_TYPE_LABEL, citationIndex, inferType, parseSources, safeHttpsUrl } from '../citations.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const ICON_EXTERNAL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" class="size-3 shrink-0" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3.5h3v3M12.5 3.5 7.5 8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ------------------------------------------------------- chain resolution */

/**
 * Search-label → domain id, used to attribute retrieval commands in reviews
 * cached before `domainId` was persisted on evidence sections.
 */
let labelToDomain = new Map();
export function registerPipeline(pipeline) {
  labelToDomain = new Map();
  for (const domain of pipeline?.domains ?? []) {
    for (const search of domain.searches ?? []) {
      if (search.label) labelToDomain.set(search.label, domain.id);
    }
  }
}

const sectionDomain = (section) => section.domainId ?? labelToDomain.get(section.label) ?? null;

/** Dossier elements whose citations include any of these identifiers. */
function elementsForIdentifiers(evaluation, identifiers) {
  const wanted = new Set(identifiers.map((id) => String(id).toUpperCase()));
  if (!wanted.size) return [];
  const out = [];
  for (const domain of evaluation?.evidence?.dossier?.domains ?? []) {
    for (const element of domain.elements ?? []) {
      const hit = (element.citations ?? []).some((citation) =>
        wanted.has(String(citation.identifier ?? '').toUpperCase()),
      );
      if (hit) out.push({ domain, element });
    }
  }
  return out.slice(0, 4);
}

/** Retrieval commands attributable to a CLARITY domain. */
function retrievalFor(evaluation, domainIds) {
  const wanted = new Set(domainIds.filter(Boolean));
  const sections = evaluation?.evidence?.sections ?? [];
  if (!wanted.size) return [];
  return sections.filter((section) => wanted.has(sectionDomain(section)));
}

/* ------------------------------------------------------------- rendering */

function sourcePill(source) {
  const ids = source.ids?.length ? source.ids.join(' · ') : '';
  const tip = esc([source.type, source.title, source.note, ids].filter(Boolean).join(' — '));
  const body = `<span class="text-ghost">${esc(source.type)}</span><span class="truncate">${esc(source.title)}</span>`;
  return source.url
    ? `<a class="src-link max-w-full" href="${esc(source.url)}" target="_blank" rel="noreferrer" title="${tip}">${body}${ICON_EXTERNAL}</a>`
    : `<span class="src-plain max-w-full" title="${tip}">${body}</span>`;
}

const step = (title, body, { missing = false } = {}) => `
  <div class="chain-step" data-missing="${missing}">
    <p class="label">${esc(title)}</p>
    <div class="mt-1.5 text-[13px] leading-relaxed ${missing ? 'text-faint' : 'text-muted'}">${body}</div>
  </div>`;

function retrievalStep(sections) {
  if (!sections.length) {
    return step(
      'Retrieval command',
      'This cached review predates per-section domain attribution, so the individual command cannot be pinned to this claim. The full command list is in the run provenance panel.',
      { missing: true },
    );
  }
  return step(
    `Retrieval command <span class="text-ghost">(${sections.length})</span>`,
    `<ul class="space-y-1.5">
      ${sections
        .slice(0, 6)
        .map(
          (section) => `<li class="inset px-2.5 py-2">
            <p class="font-mono text-[10px] uppercase tracking-[0.1em] text-clip-400">
              search <span class="text-ghost">${esc(section.source)}</span>
            </p>
            <p class="mt-1 font-mono text-[11px] leading-relaxed text-ink prose-wrap">${esc(section.query || '—')}</p>
            <p class="mt-1 font-mono text-[10px] text-ghost">
              ${esc(section.label)} · ${section.error ? `<span class="text-gap">${esc(section.error)}</span>` : `${(section.chars ?? 0).toLocaleString()} chars returned`}
            </p>
          </li>`,
        )
        .join('')}
    </ul>`,
  );
}

function citationStep(sources, index) {
  if (!sources.length) {
    return step(
      'Cited source',
      'The reviewer attributed this to the assembled evidence bundle rather than to a single public document.',
      { missing: true },
    );
  }
  return step(
    `Cited source <span class="text-ghost">(${sources.length})</span>`,
    `<div class="flex flex-col items-start gap-1.5">${sources.map(sourcePill).join('')}</div>
     ${
       index.size
         ? `<p class="mt-2 font-mono text-[10px] text-ghost">${index.size} identifiers resolved across this dossier.</p>`
         : ''
     }`,
  );
}

function extractionStep(matches) {
  if (!matches.length) {
    return step(
      'Evidence extraction',
      'No CLARITY dossier element cites this identifier. Either the review ran before the dossier pass existed, or the reviewer cited a document outside the per-domain extraction.',
      { missing: true },
    );
  }
  return step(
    `Evidence extraction <span class="text-ghost">(${matches.length})</span>`,
    matches
      .map(
        ({ domain, element }) => `<div class="inset mb-2 px-3 py-2.5">
          <p class="font-mono text-[10px] uppercase tracking-[0.1em] text-claude-400">${esc(domain.domainLabel)}</p>
          <p class="mt-1 text-[12px] font-medium text-ink">${esc(element.element)}</p>
          <p class="mt-1.5 text-[12px] leading-relaxed text-muted prose-wrap">${esc(element.finding)}</p>
          ${
            element.rationale
              ? `<p class="mt-2 border-t border-white/[0.06] pt-2 text-[11px] leading-relaxed text-faint prose-wrap">
                   <span class="text-ghost">Extractor rationale — </span>${esc(element.rationale)}
                 </p>`
              : ''
          }
          ${
            element.confidenceScore != null
              ? `<div class="mt-2 flex items-center gap-2">
                   <span class="meter-track max-w-[7rem]"><span class="meter-fill" style="width:${Number(element.confidenceScore)}%"></span></span>
                   <span class="counter text-[10px] text-faint">${esc(element.confidenceScore)}% confidence</span>
                 </div>`
              : ''
          }
        </div>`,
      )
      .join(''),
  );
}

function runStep(evaluation) {
  const meta = evaluation?.meta ?? {};
  const traceUrl = meta.trace?.traceId
    ? `/api/evaluations/${encodeURIComponent(evaluation.trial?.trialId ?? '')}/traces/${encodeURIComponent(meta.trace.traceId)}`
    : '';
  return step(
    'Run',
    `<dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
       <div><dt class="text-ghost">model</dt><dd class="text-ink">${esc(meta.model ?? '—')}</dd></div>
       <div><dt class="text-ghost">effort</dt><dd class="text-ink">${esc(meta.effort ?? '—')}</dd></div>
       <div><dt class="text-ghost">rubric</dt><dd class="text-ink">v${esc(meta.rubricVersion ?? '—')}</dd></div>
       <div><dt class="text-ghost">dossier</dt><dd class="text-ink">v${esc(meta.evidenceDossierVersion ?? '—')}</dd></div>
     </dl>
     ${
       traceUrl
         ? `<p class="mt-2"><a class="src-link" href="${esc(traceUrl)}" target="_blank" rel="noreferrer">open full ${esc(meta.trace.mode)} trace${ICON_EXTERNAL}</a></p>`
         : ''
     }`,
  );
}

/* ------------------------------------------- probability calibration bridge */

/**
 * The reviewer states its calibration as prose: an anchor, then signed
 * adjustments ("+10 for …", "−8 for …"). Parsing them back out turns the
 * paragraph into a bridge chart. Nothing is inferred — if the sentence does not
 * carry a signed number, it does not become a bar.
 */
export function parseCalibration(basis) {
  const text = String(basis ?? '');
  const matches = [...text.matchAll(/([+−-])\s?(\d{1,2})\s+for\s+([^;.]+)/g)];
  return matches.map((match) => ({
    delta: (match[1] === '+' ? 1 : -1) * Number(match[2]),
    reason: match[3].trim().replace(/\s+/g, ' '),
  }));
}

function calibrationBridge(probability) {
  const adjustments = parseCalibration(probability?.basis);
  if (!adjustments.length) return '';

  const total = adjustments.reduce((sum, item) => sum + item.delta, 0);
  const anchor = probability.pointEstimate - total;
  const max = Math.max(...adjustments.map((item) => Math.abs(item.delta)), 1);

  return `
    <div class="mt-2 space-y-1.5">
      <div class="flex items-center gap-2">
        <span class="w-12 shrink-0 text-right counter text-[11px] text-ink">${anchor}%</span>
        <span class="chip-info">anchor</span>
      </div>
      ${adjustments
        .map(
          (item) => `<div class="flex items-start gap-2">
            <span class="w-12 shrink-0 pt-0.5 text-right counter text-[11px] ${item.delta > 0 ? 'text-ok' : 'text-stop'}">
              ${item.delta > 0 ? '+' : '−'}${Math.abs(item.delta)}
            </span>
            <span class="mt-1.5 h-1.5 shrink-0 rounded-full ${item.delta > 0 ? 'bg-ok' : 'bg-stop'}"
                  style="width:${Math.max(6, (Math.abs(item.delta) / max) * 46)}px"></span>
            <span class="min-w-0 flex-1 text-[12px] leading-snug text-muted prose-wrap">${esc(item.reason)}</span>
          </div>`,
        )
        .join('')}
      <div class="flex items-center gap-2 border-t border-white/[0.08] pt-2">
        <span class="w-12 shrink-0 text-right counter text-[13px] font-semibold text-ink">${probability.pointEstimate}%</span>
        <span class="text-[12px] text-faint">net estimate · stated range ${probability.low}–${probability.high}%</span>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- grounding */

/**
 * The chain today ends at "this document". Grounding takes it to "this
 * sentence": Modal is asked which passage of the retained source text supports
 * the claim, and the server refuses any span whose quote is not verbatim in that
 * passage. So a quote shown here was checked against the document, not just
 * asserted about it — and where nothing survives that check, the step says the
 * passage could not be located rather than showing an approximation.
 */
let groundingAvailable = false;

export function enableGrounding(value) {
  groundingAvailable = Boolean(value);
}

function groundStep(claim, trialId, domainId) {
  if (!groundingAvailable || !claim || !trialId) return '';
  return step(
    'Quoted passage',
    `<button type="button" class="btn-quiet" data-ground
       data-claim="${esc(claim)}" data-trial="${esc(trialId)}" data-domain="${esc(domainId ?? '')}">
       locate the exact sentence
     </button>
     <div class="ground-result mt-2"></div>`,
  );
}

async function runGrounding(button) {
  const host = button.parentElement?.querySelector('.ground-result');
  if (!host) return;
  button.disabled = true;
  button.textContent = 'searching the retained text…';

  try {
    const response = await fetch(`/api/ground/${encodeURIComponent(button.dataset.trial)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ claim: button.dataset.claim, domainId: button.dataset.domain || undefined }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);

    if (!body.spans?.length) {
      host.innerHTML = `<p class="text-[12px] leading-relaxed text-faint">
        No passage in the retained source text was verified to contain this claim verbatim.
        ${body.rejected ? `${body.rejected} candidate${body.rejected === 1 ? '' : 's'} were rejected as non-verbatim.` : ''}
      </p>`;
    } else {
      host.innerHTML = `${body.spans
        .map(
          (span) => `<blockquote class="quote-span">
            <p class="text-[12px] leading-relaxed text-ink prose-wrap">“${esc(span.quote)}”</p>
            <p class="mt-1 font-mono text-[10px] text-ghost prose-wrap">
              ${esc(span.title || span.id)} · characters ${span.start}–${span.end}${span.score != null ? ` · score ${span.score}` : ''}
            </p>
          </blockquote>`,
        )
        .join('')}
      ${
        body.rejected
          ? `<p class="mt-1.5 font-mono text-[10px] text-gap">${body.rejected} further candidate${body.rejected === 1 ? '' : 's'} rejected: the quote was not verbatim in the passage.</p>`
          : ''
      }`;
    }
    button.remove();
  } catch (error) {
    host.innerHTML = `<p class="text-[12px] leading-relaxed text-gap prose-wrap">${esc(error.message)}</p>`;
    button.disabled = false;
    button.textContent = 'try again';
  }
}

/* ----------------------------------------------------------------- drawer */

let openDrawer = null;

function close() {
  if (!openDrawer) return;
  openDrawer.remove();
  openDrawer = null;
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
}

function onKey(event) {
  if (event.key === 'Escape') close();
}

function mount(title, subtitle, bodyHtml) {
  close();
  const root = document.getElementById('drawer-root');
  if (!root) return;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="drawer-scrim no-print" data-close="true"></div>
    <aside class="drawer no-print" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="flex items-start justify-between gap-4 border-b border-white/[0.09] px-5 py-4">
        <div class="min-w-0">
          <p class="eyebrow">Provenance</p>
          <h2 class="mt-1.5 text-[15px] font-semibold leading-snug text-ink prose-wrap">${esc(title)}</h2>
          ${subtitle ? `<p class="mt-1 font-mono text-[11px] text-faint">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="btn-quiet shrink-0" data-close="true" aria-label="Close">esc</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5">${bodyHtml}</div>
    </aside>`;

  root.append(wrap);
  openDrawer = wrap;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) return close();
    const ground = event.target.closest('[data-ground]');
    if (ground) runGrounding(ground);
  });
  wrap.querySelector('.drawer')?.focus?.();
}

/* -------------------------------------------------------------- entry points */

/** Proof for one reviewer claim (finding, concern, red flag, driver). */
export function proveClaim({ evaluation, claim, sourceText, context }) {
  const index = citationIndex(evaluation);
  const sources = parseSources(sourceText, index);
  const identifiers = sources.flatMap((source) => source.ids ?? []);
  const matches = elementsForIdentifiers(evaluation, identifiers);
  const domainIds = [...new Set(matches.map(({ domain }) => domain.domainId))];
  const sections = retrievalFor(evaluation, domainIds.length ? domainIds : [context?.domainId]);

  mount(
    claim,
    context?.label ?? null,
    `<div>
       ${step('Claim', `<p class="prose-wrap">${esc(claim)}</p>`)}
       ${citationStep(sources, index)}
       ${groundStep(claim, evaluation?.trial?.trialId, context?.domainId)}
       ${extractionStep(matches)}
       ${retrievalStep(sections)}
       ${runStep(evaluation)}
     </div>`,
  );
}

/** Proof for a scored rubric domain: what the score rests on, in full. */
export function proveDomain({ evaluation, criterion, weight, dossierDomainId }) {
  const index = citationIndex(evaluation);
  const findings = criterion.supportingFindings ?? [];
  const allSources = findings.flatMap((finding) => parseSources(finding.source, index));
  const identifiers = allSources.flatMap((source) => source.ids ?? []);
  const matches = elementsForIdentifiers(evaluation, identifiers);
  const domainIds = [...new Set([dossierDomainId, ...matches.map(({ domain }) => domain.domainId)])];
  const sections = retrievalFor(evaluation, domainIds);

  mount(
    criterion.label ?? criterion.id,
    `score ${criterion.score}/5 · weight ${Math.round((weight ?? 0) * 100)}% · evidence ${criterion.evidenceStrength}`,
    `<div>
       ${step(
         'Reviewer assessment',
         `<p class="prose-wrap">${esc(criterion.assessment)}</p>`,
       )}
       ${step(
         `Supporting findings <span class="text-ghost">(${findings.length})</span>`,
         findings.length
           ? `<ul class="space-y-2">${findings
               .map(
                 (finding) => `<li class="evidence-row rule-ok prose-wrap">
                   <p class="text-[12px] leading-snug text-muted">${esc(finding.finding)}</p>
                   <div class="mt-1.5 flex flex-col items-start gap-1">
                     ${parseSources(finding.source, index).map(sourcePill).join('')}
                   </div>
                 </li>`,
               )
               .join('')}</ul>`
           : 'No supporting findings were recorded for this domain.',
         { missing: !findings.length },
       )}
       ${extractionStep(matches)}
       ${retrievalStep(sections)}
       ${runStep(evaluation)}
     </div>`,
  );
}

/** Proof for the headline probability: the reviewer's own calibration, unpacked. */
export function proveProbability({ evaluation }) {
  const review = evaluation?.review ?? {};
  const probability = review.probabilityOfTrialSuccess ?? {};
  const confidence = review.confidence ?? {};
  const quality = review.evidenceQuality ?? {};

  mount(
    `Probability of trial success — ${probability.pointEstimate}%`,
    `stated range ${probability.low}–${probability.high}% · confidence ${confidence.level ?? '—'}`,
    `<div>
       ${step(
         'Calibration',
         `<p class="prose-wrap">Anchored on class base rates, then adjusted. Each bar below is an
          adjustment the reviewer stated explicitly.</p>${calibrationBridge(probability)}`,
       )}
       ${step('Stated basis', `<p class="prose-wrap">${esc(probability.basis)}</p>`)}
       ${step(
         `Confidence — ${esc(confidence.level ?? 'unstated')}`,
         `<p class="prose-wrap">${esc(confidence.rationale ?? 'No rationale recorded.')}</p>`,
         { missing: !confidence.rationale },
       )}
       ${step(
         `Evidence quality — ${esc(quality.overall ?? 'unstated')}`,
         `<p class="prose-wrap">${esc(quality.notes ?? 'No notes recorded.')}</p>`,
         { missing: !quality.notes },
       )}
       ${runStep(evaluation)}
     </div>`,
  );
}

export { close as closeProof };
