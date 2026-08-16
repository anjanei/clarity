// The two jobs Modal does for this lab.
//
//   fold   — a sequence in, a structure out. Only ever called with a sequence
//            the server actually holds; a derived schematic has no sequence, so
//            there is nothing to fold and nothing is invented.
//
//   ground — a claim and the passages it was drawn from, back a verbatim quote
//            with offsets. This is the missing rung of the proof chain: today it
//            ends at "this document", and grounding takes it to "this sentence".
//
// The grounding task carries the one guarantee that makes it worth having: every
// returned quote is checked against the source text it claims to come from, and
// dropped if it is not there. A grounding model that paraphrases is producing a
// citation that does not exist, which is precisely the failure this whole
// pipeline is built to prevent.

import { ModalError, callModal } from './client.js';
import { modalConfigured } from '../config.js';

const MAX_RESIDUES = 2000;
const MAX_PASSAGE_CHARS = 24_000;

/* ---------------------------------------------------------------- structure */

const CLEAN_SEQUENCE = /[^A-Za-z]/g;

/**
 * Normalise whatever the worker returned into one shape. Deployments differ on
 * whether they answer `{pdb}`, `{cif}`, or `{format, data}`, and all three are
 * common enough to accept.
 */
function normalizeStructure(result) {
  const format = String(result?.format ?? (result?.cif || result?.mmcif ? 'mmcif' : 'pdb')).toLowerCase();
  const data = result?.data ?? result?.pdb ?? result?.cif ?? result?.mmcif ?? result?.structure ?? '';
  if (typeof data !== 'string' || !data.trim()) {
    throw new ModalError('Modal fold returned no structure data.');
  }
  return {
    format: format === 'mmcif' || format === 'cif' ? 'mmcif' : 'pdb',
    data,
    // Per-residue confidence, when the worker reports it (pLDDT and friends).
    confidence: Array.isArray(result?.plddt)
      ? result.plddt.map(Number).filter(Number.isFinite)
      : Array.isArray(result?.confidence)
        ? result.confidence.map(Number).filter(Number.isFinite)
        : null,
    meanConfidence: Number.isFinite(Number(result?.mean_plddt ?? result?.meanConfidence))
      ? Number(result.mean_plddt ?? result.meanConfidence)
      : null,
    model: result?.model ?? result?.model_name ?? null,
  };
}

/**
 * Backbone trace for the viewer: one point per residue.
 *
 * Only alpha carbons for a protein and phosphorus for a nucleic acid are kept,
 * which is all a ribbon needs and a fraction of the payload the browser would
 * otherwise carry.
 */
export function parseBackbone(pdbText) {
  const points = [];
  for (const line of String(pdbText ?? '').split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    const atom = line.slice(12, 16).trim();
    if (atom !== 'CA' && atom !== 'P') continue;
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    points.push({
      x,
      y,
      z,
      residue: line.slice(17, 20).trim(),
      index: Number(line.slice(22, 26)) || points.length + 1,
      // The B-factor column carries pLDDT in every predictor that emits PDB.
      confidence: Number(line.slice(60, 66)) || null,
    });
  }
  return points;
}

/**
 * Fold one sequence.
 *
 * @param {{sequence: string, name?: string, unit?: string}} input
 * @returns {Promise<object|null>} null when Modal is not configured — the caller
 *   keeps whatever it already had.
 */
export async function foldSequence({ sequence, name = '', unit = 'aa' }, options = {}) {
  if (!modalConfigured('fold')) return null;

  const cleaned = String(sequence ?? '').replace(CLEAN_SEQUENCE, '').toUpperCase();
  if (cleaned.length < 16) {
    throw new ModalError('Sequence is too short to fold.');
  }
  if (cleaned.length > MAX_RESIDUES) {
    // Refusing is better than silently folding a truncation and labelling the
    // result with the full construct's name.
    throw new ModalError(`Sequence is ${cleaned.length} residues; this endpoint is capped at ${MAX_RESIDUES}.`);
  }

  const result = await callModal('fold', { sequence: cleaned, name, unit }, options);
  const structure = normalizeStructure(result);
  const backbone = structure.format === 'pdb' ? parseBackbone(structure.data) : [];

  return {
    ...structure,
    backbone,
    residues: cleaned.length,
    // Stated on every consumer of this object. A predicted fold is a hypothesis
    // about the molecule, not a measurement of it.
    provenance: 'predicted',
  };
}

/* ----------------------------------------------------------------- grounding */

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Locate a quote in its source, tolerating whitespace differences between what
 * the worker echoed and what the document actually contains. Returns offsets
 * into the original text, or null when the quote is not really there.
 */
export function locateQuote(haystack, quote) {
  const source = String(haystack ?? '');
  const needle = squash(quote);
  if (needle.length < 12) return null;

  const direct = source.indexOf(quote);
  if (direct >= 0) return { start: direct, end: direct + quote.length, quote };

  // Rebuild an offset map from the whitespace-collapsed form back to the source.
  const map = [];
  let collapsed = '';
  let pendingSpace = false;
  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];
    if (/\s/.test(character)) {
      pendingSpace = collapsed.length > 0;
      continue;
    }
    if (pendingSpace) {
      collapsed += ' ';
      map.push(i);
      pendingSpace = false;
    }
    collapsed += character;
    map.push(i);
  }

  const at = collapsed.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  const end = (map[at + needle.length - 1] ?? start) + 1;
  return { start, end, quote: source.slice(start, end) };
}

/**
 * Ground one claim against the passages it was drawn from.
 *
 * @param {{claim: string, passages: Array<{id: string, title?: string, text: string}>}} input
 * @returns {Promise<{spans: Array<object>, checked: number, rejected: number}|null>}
 */
export async function groundClaim({ claim, passages = [] }, options = {}) {
  if (!modalConfigured('ground')) return null;

  const claimText = squash(claim);
  if (!claimText) throw new ModalError('Grounding needs a claim.');

  const usable = passages
    .filter((passage) => passage?.id && typeof passage.text === 'string' && passage.text.trim())
    .slice(0, 8)
    .map((passage) => ({
      id: String(passage.id),
      title: String(passage.title ?? ''),
      text: passage.text.slice(0, MAX_PASSAGE_CHARS),
    }));

  if (!usable.length) return { spans: [], checked: 0, rejected: 0 };

  const result = await callModal('ground', { claim: claimText, passages: usable }, options);
  const raw = Array.isArray(result?.spans) ? result.spans : Array.isArray(result) ? result : [];
  const byId = new Map(usable.map((passage) => [passage.id, passage]));

  const spans = [];
  let rejected = 0;

  for (const span of raw.slice(0, 24)) {
    const passage = byId.get(String(span?.id ?? span?.passageId ?? ''));
    if (!passage) {
      rejected += 1;
      continue;
    }
    // The whole point: a quote that is not verbatim in the passage is not a
    // citation, however confident the worker was about it.
    const located = locateQuote(passage.text, span?.quote ?? span?.text ?? '');
    if (!located) {
      rejected += 1;
      continue;
    }
    spans.push({
      id: passage.id,
      title: passage.title,
      quote: located.quote,
      start: located.start,
      end: located.end,
      score: Number.isFinite(Number(span?.score)) ? Number(span.score) : null,
    });
  }

  return { spans, checked: raw.length, rejected };
}
