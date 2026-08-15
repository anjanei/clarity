/**
 * Registry enrichment.
 *
 * Paperclip indexes the *narrative* of a clinical trial — eligibility criteria,
 * brief summary, arm and outcome descriptions — but not the structured registry
 * header. Its `documents` SQL table covers papers only (pmc/biorxiv/medrxiv), so
 * sponsor, phase and start date are genuinely absent from the corpus and the
 * extraction step correctly declines to invent them.
 *
 * Those three are required fields for a clinicalTrialObject, so we fill them
 * deterministically from the authoritative source: the public ClinicalTrials.gov
 * v2 API (read-only GET, no key, batched by NCT id). This is more trustworthy
 * than reading them out of snippet text, not less.
 *
 * Coverage is limited to NCT-registered trials. ChiCTR / jRCT / UMIN / ISRCTN /
 * PACTR and similar registries have no equivalent free batch API; those records
 * keep whatever the extraction found and are flagged `registryEnriched: false`.
 */

const API = 'https://clinicaltrials.gov/api/v2/studies';

const FIELDS = [
  'NCTId',
  'BriefTitle',
  'LeadSponsorName',
  'Phase',
  'StartDate',
  'OverallStatus',
  'StudyType',
  'Condition',
  'InterventionName',
  'InterventionType',
].join(',');

const NCT_ID = /^NCT\d{8}$/i;

/** Intervention types that name an actual investigational product. */
const PRODUCT_TYPES = new Set(['DRUG', 'BIOLOGICAL', 'GENETIC', 'COMBINATION_PRODUCT']);

/** CT.gov emits a phase array; collapse it to our enum. */
export function mapPhases(phases) {
  if (!phases?.length) return 'Unknown';
  const set = new Set(phases);
  if (set.has('EARLY_PHASE1')) return 'Early Phase 1';
  if (set.has('NA')) return 'Not Applicable';
  const has = (p) => set.has(p);
  if (has('PHASE1') && has('PHASE2')) return 'Phase 1/2';
  if (has('PHASE2') && has('PHASE3')) return 'Phase 2/3';
  if (has('PHASE4')) return 'Phase 4';
  if (has('PHASE3')) return 'Phase 3';
  if (has('PHASE2')) return 'Phase 2';
  if (has('PHASE1')) return 'Phase 1';
  return 'Unknown';
}

async function fetchBatch(ids, { retries = 2 } = {}) {
  const url = new URL(API);
  url.searchParams.set('filter.ids', ids.join(','));
  url.searchParams.set('pageSize', String(Math.max(ids.length, 10)));
  url.searchParams.set('fields', FIELDS);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
      const body = await res.json();
      return body.studies || [];
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
  }
}

function normalizeStudy(study) {
  const p = study.protocolSection || {};
  const interventions = p.armsInterventionsModule?.interventions || [];
  return {
    nctId: p.identificationModule?.nctId,
    briefTitle: p.identificationModule?.briefTitle || '',
    sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name || '',
    phase: mapPhases(p.designModule?.phases),
    studyType: p.designModule?.studyType || '',
    startDate: p.statusModule?.startDateStruct?.date || '',
    overallStatus: p.statusModule?.overallStatus || '',
    conditions: p.conditionsModule?.conditions || [],
    products: interventions
      .filter((i) => PRODUCT_TYPES.has(i.type))
      .map((i) => i.name)
      .filter(Boolean),
  };
}

/**
 * A therapeuticName the extractor wrote as prose ("Autologous hematopoietic
 * stem cell gene therapy for PKD") is worse for display than the registry's own
 * product code ("RP-L301"). Swap only when the registry names exactly one
 * product and the extracted name reads as a description.
 */
function pickTherapeuticName(extracted, products) {
  const looksDescriptive = extracted.length > 55 || /\b(therapy|treatment|vector expressing|for)\b/i.test(extracted);
  if (products.length === 1 && looksDescriptive && products[0].length <= 60) {
    return { therapeuticName: products[0], therapeuticDescription: extracted };
  }
  return { therapeuticName: extracted, therapeuticDescription: '' };
}

/**
 * Enrich in place-ish: returns new trial objects plus stats.
 * `dropObservational` removes studies the registry marks non-interventional.
 */
export async function enrichFromRegistry(
  trials,
  { batchSize = 50, onStep, dropObservational = true } = {},
) {
  const eligible = trials.filter((t) => NCT_ID.test(t.trialId));
  const byId = new Map();
  const failures = [];

  for (let i = 0; i < eligible.length; i += batchSize) {
    const batch = eligible.slice(i, i + batchSize).map((t) => t.trialId.toUpperCase());
    onStep?.({ from: i + 1, to: Math.min(i + batchSize, eligible.length), total: eligible.length });
    try {
      for (const study of await fetchBatch(batch)) {
        const normalized = normalizeStudy(study);
        if (normalized.nctId) byId.set(normalized.nctId.toUpperCase(), normalized);
      }
    } catch (err) {
      failures.push({ batch: `${i + 1}-${i + batch.length}`, error: err.message });
    }
  }

  const out = [];
  let matched = 0;
  let dropped = 0;

  for (const trial of trials) {
    const registry = byId.get(trial.trialId.toUpperCase());
    if (!registry) {
      out.push({ ...trial, registryEnriched: false });
      continue;
    }

    if (dropObservational && registry.studyType && registry.studyType !== 'INTERVENTIONAL') {
      dropped += 1;
      continue;
    }

    matched += 1;
    const names = pickTherapeuticName(trial.therapeuticName, registry.products);

    out.push({
      ...trial,
      ...names,
      // Registry values win: they are the authoritative header fields.
      sponsor: registry.sponsor || trial.sponsor,
      phase: registry.phase !== 'Unknown' ? registry.phase : trial.phase,
      startDate: registry.startDate || trial.startDate,
      condition: registry.conditions.length ? registry.conditions.join('; ') : trial.condition,
      title: registry.briefTitle || trial.title,
      overallStatus: registry.overallStatus,
      studyType: registry.studyType,
      registryProducts: registry.products,
      registryEnriched: true,
    });
  }

  return {
    trials: out,
    stats: {
      eligible: eligible.length,
      matched,
      unmatched: eligible.length - matched - dropped,
      notNct: trials.length - eligible.length,
      droppedObservational: dropped,
      failures,
    },
  };
}
