// The arithmetic, shown.
//
// Two numbers on the report are computed rather than asserted — the weighted
// rubric score and the evidence-completeness fraction — and one, the probability,
// is asserted by the reviewer with a stated calibration. All three are worth more
// when the reader can see the working, so this module renders each as its formula
// with the actual terms substituted, plus the contribution matrix that shows
// which domains are carrying the score and which are dragging it.
//
// Nothing here invents a number. Weights come from the served rubric, scores from
// the review, benchmarks from the reviews already on disk. Where a term is
// missing it renders as an em dash rather than a zero, because a zero is a claim.

import { esc, chip, scoreTone } from './ui.js';

const round = (value, places = 2) =>
  Number.isFinite(Number(value)) ? Number(Number(value).toFixed(places)) : null;

export const weightFor = (criterion, rubric) =>
  rubric?.dimensions?.find((d) => d.id === criterion.id)?.weight ?? criterion.weight ?? 0;

/** Weighted rubric score, exactly as the server computes it. */
export function computeWeighted(review, rubric) {
  const rows = (review?.criteria ?? []).map((criterion) => {
    const weight = Number(weightFor(criterion, rubric)) || 0;
    const score = Number(criterion.score) || 0;
    return {
      id: criterion.id,
      label: criterion.label ?? criterion.id,
      weight,
      score,
      strength: criterion.evidenceStrength,
      contribution: weight * score,
      tone: scoreTone(criterion),
    };
  });
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const weighted = rows.reduce((sum, row) => sum + row.contribution, 0);
  return {
    rows,
    totalWeight: round(totalWeight, 4),
    weighted: round(weighted, 3),
    normalised: totalWeight ? round(weighted / totalWeight, 3) : null,
    stated: round(review?.weightedRubricScore, 3),
  };
}

const EVIDENCE_FACTOR = { strong: 1, moderate: 0.65, weak: 0.3, absent: 0 };

export function computeCompleteness(review, rubric) {
  let backed = 0;
  let total = 0;
  for (const criterion of review?.criteria ?? []) {
    const weight = Number(weightFor(criterion, rubric)) || 0;
    total += weight;
    backed += weight * (EVIDENCE_FACTOR[criterion.evidenceStrength] ?? 0);
  }
  return { backed: round(backed, 4), total: round(total, 4), fraction: total ? backed / total : 0 };
}

/* ------------------------------------------------------------------ formulas */

const formulaBlock = (expression, substitution, result, note) => `
  <div class="formula">
    <p class="formula-expr">${expression}</p>
    <p class="formula-sub">${substitution}</p>
    <p class="formula-result">${result}</p>
    ${note ? `<p class="formula-note">${esc(note)}</p>` : ''}
  </div>`;

export function weightedScoreFormula(review, rubric, meta = {}) {
  const math = computeWeighted(review, rubric);
  if (!math.rows.length) return '';

  const terms = math.rows
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .map(
      (row) =>
        `<span class="term" data-tone="${esc(row.tone)}" title="${esc(row.label)}">${row.weight.toFixed(2)}·${row.score}</span>`,
    )
    .join('<span class="op">+</span>');

  // The stored figure was computed when the review ran, against whatever rubric
  // was current then. Recomputing it here against the rubric the server serves
  // now can legitimately disagree — and when it does, the reader is told which
  // number came from where rather than shown whichever happens to be first.
  const storedVersion = meta.rubricVersion ?? null;
  const servedVersion = rubric?.version ?? null;
  const drift =
    math.stated != null && math.normalised != null && Math.abs(math.stated - math.normalised) > 0.011
      ? storedVersion && servedVersion && storedVersion !== servedVersion
        ? `Reported ${math.stated} was computed under rubric v${storedVersion}; recomputed as ${math.normalised} under the served rubric v${servedVersion}.`
        : `Reported ${math.stated} disagrees with the recomputed ${math.normalised} on the same weights — treat the stored figure with suspicion.`
      : null;

  return formulaBlock(
    'S<sub>w</sub> = ( Σ w<sub>i</sub> · s<sub>i</sub> ) / Σ w<sub>i</sub>',
    terms,
    `= <strong>${math.normalised ?? '—'}</strong> <span class="text-faint">of 5 · Σ w<sub>i</sub>·s<sub>i</sub> = ${math.weighted ?? '—'} · Σw = ${math.totalWeight}</span>`,
    drift ?? 'Each term is one rubric dimension: its weight times its 1–5 score.',
  );
}

export function completenessFormula(review, rubric) {
  const math = computeCompleteness(review, rubric);
  return formulaBlock(
    'C = ( Σ w<sub>i</sub> · f(e<sub>i</sub>) ) / Σ w<sub>i</sub>',
    `<span class="term">${math.backed}</span><span class="op">/</span><span class="term">${math.total}</span>`,
    `= <strong>${Math.round(math.fraction * 100)}%</strong> <span class="text-faint">of rubric weight backed by direct evidence</span>`,
    'f maps evidence strength to a factor: strong 1, moderate 0.65, weak 0.3, absent 0.',
  );
}

/**
 * The reviewer states its calibration in prose — an anchor, then signed
 * adjustments. Parsing them back out turns the paragraph into a bridge. Nothing
 * is inferred: a sentence without a signed number does not become a bar.
 */
export function parseCalibration(basis) {
  const text = String(basis ?? '');
  return [...text.matchAll(/([+−-])\s?(\d{1,2})\s+for\s+([^;.]+)/g)].map((match) => ({
    delta: (match[1] === '+' ? 1 : -1) * Number(match[2]),
    reason: match[3].trim().replace(/\s+/g, ' '),
  }));
}

export function calibrationBridge(probability) {
  const adjustments = parseCalibration(probability?.basis);
  if (!adjustments.length) return '';

  const total = adjustments.reduce((sum, item) => sum + item.delta, 0);
  const anchor = Number(probability.pointEstimate) - total;
  const max = Math.max(...adjustments.map((item) => Math.abs(item.delta)), 1);

  return `
    <div class="mt-3 space-y-1.5">
      <div class="flex items-center gap-2">
        <span class="counter w-12 shrink-0 text-right text-[11px] text-ink">${esc(anchor)}%</span>
        ${chip('anchor', 'info')}
      </div>
      ${adjustments
        .map(
          (item) => `<div class="flex items-start gap-2">
            <span class="counter w-12 shrink-0 pt-0.5 text-right text-[11px] ${item.delta > 0 ? 'text-ok' : 'text-stop'}">
              ${item.delta > 0 ? '+' : '−'}${Math.abs(item.delta)}
            </span>
            <span class="mt-1.5 h-1.5 shrink-0 rounded-full ${item.delta > 0 ? 'bg-ok' : 'bg-stop'}"
                  style="width:${Math.max(6, (Math.abs(item.delta) / max) * 46)}px"></span>
            <span class="min-w-0 flex-1 text-[12px] leading-snug text-muted prose-wrap">${esc(item.reason)}</span>
          </div>`,
        )
        .join('')}
      <div class="flex items-center gap-2 border-t border-white/[0.08] pt-2">
        <span class="counter w-12 shrink-0 text-right text-[13px] font-semibold text-ink">${esc(probability.pointEstimate)}%</span>
        <span class="text-[12px] text-faint">net estimate · stated range ${esc(probability.low)}–${esc(probability.high)}%</span>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------- matrix */

/**
 * The contribution matrix. One row per rubric dimension, ordered by how much of
 * the final score it is actually carrying, with the evidence strength that
 * backs it. This is where a high score resting on absent evidence becomes
 * impossible to miss.
 */
export function contributionMatrix(review, rubric) {
  const math = computeWeighted(review, rubric);
  if (!math.rows.length) return '';
  const maxContribution = Math.max(...math.rows.map((row) => row.contribution), 0.0001);
  const rows = [...math.rows].sort((a, b) => b.contribution - a.contribution);

  return `
    <div class="matrix" role="table" aria-label="Rubric contribution matrix">
      <div class="matrix-head" role="row">
        <span role="columnheader">dimension</span>
        <span role="columnheader" class="text-right">weight</span>
        <span role="columnheader" class="text-right">score</span>
        <span role="columnheader" class="text-right">w·s</span>
        <span role="columnheader">contribution</span>
        <span role="columnheader">evidence</span>
      </div>
      ${rows
        .map(
          (row) => `<button type="button" class="matrix-row" role="row" data-domain="${esc(row.id)}">
            <span class="truncate text-left text-[12px] text-ink" role="cell">${esc(row.label)}</span>
            <span class="counter text-right text-[11px] text-faint" role="cell">${(row.weight * 100).toFixed(0)}%</span>
            <span class="counter text-right text-[11px] text-ink" role="cell">${row.score}</span>
            <span class="counter text-right text-[11px] text-muted" role="cell">${row.contribution.toFixed(2)}</span>
            <span class="matrix-bar" role="cell">
              <span class="matrix-fill" data-tone="${esc(row.tone)}" style="width:${(row.contribution / maxContribution) * 100}%"></span>
            </span>
            <span role="cell" class="text-left">${chip(row.strength ?? 'unstated', row.strength === 'absent' ? 'unknown' : row.strength === 'strong' ? 'ok' : row.strength === 'moderate' ? 'info' : 'gap')}</span>
          </button>`,
        )
        .join('')}
    </div>`;
}

/* --------------------------------------------------------------- benchmarks */

/** Where this programme sits among every review this rubric has produced. */
export function benchmarkStrip(benchmarks, review, trial) {
  if (!benchmarks?.programmes?.length) return '';
  const points = benchmarks.programmes.filter((p) => Number.isFinite(p.point));
  if (!points.length) return '';

  const min = Math.min(...points.map((p) => p.point), 0);
  const max = Math.max(...points.map((p) => p.point), 100);
  const span = Math.max(1, max - min);
  const here = Number(review?.probabilityOfTrialSuccess?.pointEstimate);

  return `
    <div class="mt-3">
      <div class="bench-axis">
        ${points
          .map((programme) => {
            const isThis = programme.trialId === trial?.trialId;
            return `<span class="bench-mark${isThis ? ' is-current' : ''}"
              style="left:${((programme.point - min) / span) * 100}%"
              title="${esc(`${programme.therapeuticName} — ${programme.point}%`)}"></span>`;
          })
          .join('')}
        ${
          Number.isFinite(here)
            ? `<span class="bench-here" style="left:${((here - min) / span) * 100}%"></span>`
            : ''
        }
      </div>
      <div class="mt-1 flex justify-between font-mono text-[10px] text-ghost">
        <span>${min}%</span>
        <span>median ${benchmarks.probability.median ?? '—'}% · n=${benchmarks.probability.n}</span>
        <span>${max}%</span>
      </div>
      ${
        benchmarks.sufficient
          ? ''
          : `<p class="mt-2 text-[11px] leading-relaxed text-gap">Only ${benchmarks.count} review${benchmarks.count === 1 ? '' : 's'} have been run on this rubric. Read the position, not the distribution.</p>`
      }
    </div>`;
}

/** Per-domain: this programme's score against the mean of every scored review. */
export function benchmarkDomains(benchmarks, review) {
  if (!benchmarks?.domains?.length || !review?.criteria?.length) return '';
  const mine = new Map(review.criteria.map((criterion) => [criterion.id, criterion]));
  const rows = benchmarks.domains.filter((domain) => domain.n > 0 && mine.has(domain.id));
  if (!rows.length) return '';

  return `
    <div class="mt-3 space-y-1.5">
      ${rows
        .map((domain) => {
          const criterion = mine.get(domain.id);
          const delta = Number(criterion.score) - Number(domain.mean);
          return `<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div class="min-w-0">
              <p class="truncate text-[12px] text-muted">${esc(domain.label)}</p>
              <div class="bench-range mt-1">
                <span class="bench-range-fill" style="left:${((domain.min - 1) / 4) * 100}%;width:${((domain.max - domain.min) / 4) * 100}%"></span>
                <span class="bench-range-mean" style="left:${((domain.mean - 1) / 4) * 100}%"></span>
                <span class="bench-range-mine" data-tone="${esc(scoreTone(criterion))}" style="left:${((criterion.score - 1) / 4) * 100}%"></span>
              </div>
            </div>
            <p class="counter shrink-0 text-right text-[11px] ${delta > 0.25 ? 'text-ok' : delta < -0.25 ? 'text-stop' : 'text-faint'}">
              ${criterion.score} <span class="text-ghost">vs ${domain.mean ?? '—'}</span>
            </p>
          </div>`;
        })
        .join('')}
      <p class="mt-2 font-mono text-[10px] text-ghost">bar = observed range across reviews · tick = mean · dot = this programme</p>
    </div>`;
}
