// Construct viewer.
//
// Renders whichever model the server resolved, and states which one it is in the
// panel header. A Benchling-backed model shows real bases and real annotations.
// A derived model shows modality architecture only and says, in the panel, that
// the coordinates are illustrative — it never draws a sequence it does not have.

import { safeHttpsUrl } from '../citations.js';

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const FEATURE_STYLE = {
  promoter:   { fill: 'var(--color-clip-500)',   label: 'promoter' },
  cds:        { fill: 'var(--color-claude-500)', label: 'coding' },
  guide:      { fill: 'var(--color-bench-500)',  label: 'guide' },
  edit:       { fill: 'var(--color-stop)',       label: 'edit site' },
  itr:        { fill: 'oklch(0.62 0.14 300)',    label: 'ITR' },
  ltr:        { fill: 'oklch(0.62 0.14 300)',    label: 'LTR' },
  utr:        { fill: 'oklch(0.68 0.1 210)',     label: 'UTR' },
  cdr:        { fill: 'var(--color-gap)',        label: 'CDR' },
  domain:     { fill: 'oklch(0.6 0.09 250)',     label: 'domain' },
  element:    { fill: 'oklch(0.5 0.02 250)',     label: 'element' },
  terminator: { fill: 'oklch(0.48 0.04 30)',     label: 'terminator' },
  tag:        { fill: 'oklch(0.55 0.05 160)',    label: 'tag' },
};

const styleFor = (type) => FEATURE_STYLE[String(type).toLowerCase()] ?? FEATURE_STYLE.domain;

/** Greedy lane packing so overlapping features stay readable. */
function packLanes(features) {
  const lanes = [];
  for (const feature of [...features].sort((a, b) => a.start - b.start || b.end - a.end)) {
    let placed = false;
    for (const lane of lanes) {
      if (feature.start >= lane[lane.length - 1].end) {
        lane.push(feature);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([feature]);
  }
  return lanes;
}

function featureMap(model) {
  const length = Math.max(1, model.length || 1);
  const lanes = packLanes(model.features ?? []);
  const width = 1000;
  const laneHeight = 26;
  const top = 26;
  const height = top + lanes.length * laneHeight + 26;
  const scale = (position) => (position / length) * width;

  const ticks = Array.from({ length: 6 }, (_, i) => {
    const value = Math.round((i / 5) * length);
    return `
      <line x1="${scale(value)}" y1="${height - 22}" x2="${scale(value)}" y2="${height - 17}"
            stroke="oklch(1 0 0 / 0.25)" stroke-width="1" />
      <text x="${Math.min(width - 22, Math.max(12, scale(value)))}" y="${height - 7}"
            text-anchor="middle" font-size="9" font-family="var(--font-mono)"
            fill="var(--color-ghost)">${value.toLocaleString()}</text>`;
  }).join('');

  const blocks = lanes
    .map((lane, laneIndex) =>
      lane
        .map((feature) => {
          const style = styleFor(feature.type);
          const x = scale(feature.start);
          const w = Math.max(3, scale(feature.end) - scale(feature.start));
          const y = top + laneIndex * laneHeight;
          const showLabel = w > 54;
          return `
            <g class="feature-block" data-feature="${esc(feature.name)}"
               data-range="${feature.start}–${feature.end}">
              <title>${esc(feature.name)} · ${feature.start.toLocaleString()}–${feature.end.toLocaleString()} ${esc(model.unit)}</title>
              <rect x="${x}" y="${y}" width="${w}" height="16" rx="3"
                    fill="${style.fill}" fill-opacity="0.75" stroke="${style.fill}" stroke-width="1" />
              ${
                showLabel
                  ? `<text x="${x + 5}" y="${y + 11.5}" font-size="9" font-family="var(--font-mono)"
                           fill="oklch(0.14 0.02 250)" font-weight="600">${esc(feature.name.slice(0, Math.floor(w / 5.4)))}</text>`
                  : ''
              }
            </g>`;
        })
        .join(''),
    )
    .join('');

  // Features narrower than their label get a legend row instead of being unlabelled.
  const legend = (model.features ?? [])
    .filter((feature) => scale(feature.end) - scale(feature.start) <= 54)
    .map(
      (feature) => `<span class="inline-flex items-center gap-1.5 font-mono text-[10px] text-faint">
        <span class="size-2 shrink-0 rounded-sm" style="background:${styleFor(feature.type).fill}"></span>
        ${esc(feature.name)}
        <span class="text-ghost">${feature.start.toLocaleString()}–${feature.end.toLocaleString()}</span>
      </span>`,
    )
    .join('');

  return `
    <div class="gene-stage gene-draw p-3">
      <svg viewBox="0 0 ${width} ${height}" class="block w-full" role="img"
           aria-label="Feature map of ${esc(model.name)}">
        <line x1="0" y1="${top - 8}" x2="${width}" y2="${top - 8}" stroke="oklch(1 0 0 / 0.14)" stroke-width="1" />
        ${blocks}
        <line x1="0" y1="${height - 22}" x2="${width}" y2="${height - 22}" stroke="oklch(1 0 0 / 0.12)" stroke-width="1" />
        ${ticks}
      </svg>
    </div>
    ${legend ? `<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">${legend}</div>` : ''}`;
}

/** Coloured base ladder — only ever drawn from a real sequence. */
function baseLadder(sequence, unit) {
  if (!sequence) return '';
  const shown = sequence.slice(0, 600);
  const coloured = [...shown]
    .map((base) => {
      const key = /[ATGC]/i.test(base) ? base.toUpperCase() : 'N';
      return `<span class="base-${key}">${esc(base)}</span>`;
    })
    .join('');
  return `
    <details class="mt-3">
      <summary class="disclosure">
        <span class="label">Sequence · first ${shown.length.toLocaleString()} ${esc(unit)}</span>
        <svg viewBox="0 0 16 16" class="disclosure-caret size-3.5 text-faint" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </summary>
      <div class="base-ladder mt-2">${coloured}</div>
    </details>`;
}

function targetList(model, { onProof } = {}) {
  if (!model.targets?.length) return '';
  return `
    <div class="mt-4">
      <p class="label">Targets named in this review's evidence <span class="text-ghost">(${model.targets.length})</span></p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        ${model.targets
          .map(
            (target) => `<button class="chip-bench" data-target="${esc(target.symbol)}"
              ${onProof ? '' : 'disabled'} title="${esc(target.mentions[0]?.where ?? '')}">
              <span class="dot"></span>${esc(target.symbol)}
              <span class="text-ghost">${target.mentions.length}</span>
            </button>`,
          )
          .join('')}
      </div>
      <div id="target-detail" class="mt-2"></div>
    </div>`;
}

export function renderGeneModel(mount, payload, { onTargetProof } = {}) {
  if (!mount) return;
  if (!payload?.model) {
    mount.innerHTML = '';
    return;
  }

  const { model, lookup } = payload;
  const live = model.provenance === 'benchling';

  mount.innerHTML = `
    <div class="panel panel-pad">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="eyebrow" style="color: var(--color-bench-400)">Structure</p>
          <h3 class="mt-1.5 text-[15px] font-semibold leading-snug text-ink prose-wrap">${esc(model.name)}</h3>
          <p class="mt-1 font-mono text-[11px] text-faint">
            ${model.length ? `${model.length.toLocaleString()} ${esc(model.unit)}` : 'length unknown'}
            ${model.modality ? ` · ${esc(model.modality)}` : ''}
            ${model.features?.length ? ` · ${model.features.length} features` : ''}
          </p>
        </div>
        <span class="${live ? 'chip-bench' : 'chip-unknown'}">
          <span class="${live ? 'dot-live' : 'dot'}"></span>${live ? 'Benchling · live' : 'Derived schematic'}
        </span>
      </div>

      ${model.note ? `<p class="mt-3 text-[12px] leading-relaxed text-muted prose-wrap">${esc(model.note)}</p>` : ''}

      <div class="mt-4">${featureMap(model)}</div>

      ${baseLadder(model.sequence, model.unit)}

      ${targetList(model, { onProof: onTargetProof })}

      ${
        model.caveats?.length
          ? `<details class="mt-4">
               <summary class="disclosure">
                 <span class="label">How to read this panel</span>
                 <svg viewBox="0 0 16 16" class="disclosure-caret size-3.5 text-faint" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                   <path d="m6 3.5 4.5 4.5L6 12.5" stroke-linecap="round" stroke-linejoin="round" />
                 </svg>
               </summary>
               <ul class="mt-2 space-y-1.5 pl-1">
                 ${model.caveats
                   .filter(Boolean)
                   .map((caveat) => `<li class="text-[12px] leading-relaxed text-faint prose-wrap">— ${esc(caveat)}</li>`)
                   .join('')}
               </ul>
             </details>`
          : ''
      }

      ${
        // The tenant supplies this URL; it is escaped *and* scheme-checked before
        // it is allowed to become a link.
        safeHttpsUrl(model.benchling?.webURL)
          ? `<p class="mt-3"><a class="src-link" href="${esc(safeHttpsUrl(model.benchling.webURL))}" target="_blank" rel="noreferrer noopener">open in Benchling</a></p>`
          : ''
      }

      ${
        lookup?.error
          ? `<p class="mt-3 font-mono text-[10px] text-gap prose-wrap">Benchling lookup failed: ${esc(lookup.error)}</p>`
          : !lookup?.attempted
            ? `<p class="mt-3 font-mono text-[10px] text-ghost">
                 Benchling not configured — set BENCHLING_TENANT to resolve live constructs.
               </p>`
            : !lookup?.matched
              ? `<p class="mt-3 font-mono text-[10px] text-ghost">
                   No Benchling entity matched this therapeutic name.
                 </p>`
              : ''
      }
    </div>`;

  // Target chips reveal the evidence line the symbol was extracted from.
  const detail = mount.querySelector('#target-detail');
  mount.querySelectorAll('[data-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = model.targets.find((item) => item.symbol === button.dataset.target);
      if (!target || !detail) return;
      detail.innerHTML = `
        <div class="inset rise px-3 py-2.5">
          <p class="font-mono text-[10px] uppercase tracking-[0.1em] text-bench-400">${esc(target.symbol)} — extracted from</p>
          <ul class="mt-2 space-y-2">
            ${target.mentions
              .map(
                (mention) => `<li class="text-[12px] leading-relaxed text-muted prose-wrap">
                  <span class="font-mono text-[10px] text-ghost">${esc(mention.where)}</span><br />“${esc(mention.context)}”
                </li>`,
              )
              .join('')}
          </ul>
        </div>`;
      onTargetProof?.(target);
    });
  });
}
