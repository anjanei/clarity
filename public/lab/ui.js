// Shared rendering primitives.
//
// Everything user-facing in this app is built by string interpolation into
// innerHTML, and almost every value interpolated came out of a language model or
// a third-party registry. `esc` is therefore not a convenience — it is the
// boundary. It lives here, once, so no surface can quietly forget it.

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));

/** Attribute-safe JSON, for the payloads carried on data- attributes. */
export const escAttrJson = (value) => esc(JSON.stringify(value ?? null));

export const ICON_EXTERNAL = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" class="size-3 shrink-0" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 3.5h3v3M12.5 3.5 7.5 8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const ICON_CARET = `<svg viewBox="0 0 16 16" class="disclosure-caret size-3.5 text-faint" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

export const STRENGTH_TONE = { strong: 'ok', moderate: 'info', weak: 'gap', absent: 'unknown' };
export const SEVERITY_TONE = { critical: 'stop', major: 'gap', minor: 'unknown' };
export const PRIORITY_TONE = { immediate: 'stop', 'near-term': 'gap', later: 'unknown' };
export const CONFIDENCE_TONE = { high: 'ok', moderate: 'info', low: 'gap' };

export const chip = (text, tone = 'chip') =>
  `<span class="${tone.startsWith('chip-') ? tone : `chip-${tone}`}"><span class="dot"></span>${esc(text)}</span>`;

export const pct = (value, places = 0) => `${(Number(value || 0) * 100).toFixed(places)}%`;

export const num = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—');

export const fmtDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
};

export const clampText = (value, max) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function scoreTone(criterion) {
  if (!criterion) return 'unknown';
  if (criterion.evidenceStrength === 'absent') return 'unknown';
  if (criterion.score <= 2) return 'stop';
  if (criterion.score === 3) return 'gap';
  return 'ok';
}

export function scorePips(score, tone) {
  return `<span class="score-track">${[1, 2, 3, 4, 5]
    .map((n) => `<span class="score-pip" data-tone="${esc(tone)}" data-on="${n <= Number(score)}"></span>`)
    .join('')}</span>`;
}

/** Every proof affordance in the app goes through one shape. */
export const proofButton = (kind, payload = '') =>
  `<button type="button" class="proof-btn no-print" data-proof-kind="${esc(kind)}" data-proof="${esc(payload)}">proof</button>`;
