import { PATHS, SOURCES, map, reduce, search } from './tools.js';

/** Result IDs look like `s_1907a2d0` / `m_def456` and feed --from. */
const RESULT_ID = /\b([smrf]_[0-9a-z]{5,})\b/i;

function firstResultId(text) {
  const match = RESULT_ID.exec(text || '');
  return match ? match[1] : null;
}

function clip(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/**
 * Broad sweep used once to build the local catalog. `/trials/us` and
 * `/trials/intl` are virtual-path scopes; `-s fda` is a source. Each entry is a
 * separate search so one failing scope does not sink the whole ingest.
 */
export const CATALOG_QUERIES = [
  { area: 'Oncology', query: 'interventional trial investigational anticancer therapeutic phase sponsor' },
  { area: 'Immunology & Inflammation', query: 'monoclonal antibody autoimmune inflammatory disease interventional trial phase' },
  { area: 'Neurology', query: 'investigational therapeutic neurodegenerative disease interventional trial phase' },
  { area: 'Infectious Disease & Vaccines', query: 'vaccine antiviral antibacterial investigational product interventional trial phase' },
  { area: 'Cardiometabolic', query: 'investigational drug cardiovascular metabolic diabetes obesity interventional trial phase' },
  { area: 'Rare & Genetic Disease', query: 'gene therapy enzyme replacement rare disease interventional trial phase' },
  { area: 'Cell & Gene Therapy', query: 'CAR-T cell therapy AAV gene therapy interventional trial phase' },
  {
    area: 'Regulatory (FDA reviews)',
    query: 'new drug application biologics license application clinical review',
    scopes: [{ source: SOURCES.fda }],
  },
];

/** Default trial-registry scopes: US ClinicalTrials.gov plus the intl union. */
const TRIAL_SCOPES = [{ path: PATHS.trialsUs }, { path: PATHS.trialsIntl }];

const scopeLabel = (scope) => scope.path ?? `-s ${scope.source}`;

/** Raw text blobs from the trial registries, for structured extraction. */
export async function fetchCatalogRaw({ queries = CATALOG_QUERIES, limit = 40, onStep } = {}) {
  const records = [];

  for (const entry of queries) {
    for (const scope of entry.scopes ?? TRIAL_SCOPES) {
      const label = scopeLabel(scope);
      onStep?.({ area: entry.area, source: label });
      try {
        const result = await search(entry.query, { ...scope, limit });
        if (!result.text?.trim()) continue;
        records.push({
          area: entry.area,
          source: label,
          query: entry.query,
          command: result.command,
          resultId: firstResultId(result.text),
          text: clip(result.text, 40000),
        });
      } catch (err) {
        records.push({ area: entry.area, source: label, query: entry.query, error: err.message });
      }
    }
  }

  return records;
}

/**
 * Evidence bundle for one selected therapeutic, organised by the rubric
 * dimension it informs so the reviewer prompt can cite by section.
 */
export async function gatherEvidence(trial, { perQueryLimit = 12, deepRead = true, onStep } = {}) {
  const name = trial.therapeuticName;
  const id = trial.trialId;
  const indication = trial.condition || '';
  const literature = [SOURCES.pmc, SOURCES.biorxiv];

  const plan = [
    {
      key: 'trial_registry',
      label: 'Trial registry records',
      dimension: 'trial_design_regulatory',
      scopes: TRIAL_SCOPES,
      query: [name, id, indication].filter(Boolean).join(' '),
    },
    {
      key: 'regulatory',
      label: 'FDA / EMA / PMDA review documents and precedents',
      dimension: 'trial_design_regulatory',
      scopes: [{ source: SOURCES.fda }],
      query: `${name} ${indication} review approval clinical pharmacology benefit risk`,
    },
    {
      key: 'immunogenicity',
      label: 'Immunogenicity',
      dimension: 'immunogenicity',
      scopes: [{ source: literature }],
      query: `${name} immunogenicity anti-drug antibodies neutralizing antibodies ADA incidence`,
    },
    {
      key: 'safety',
      label: 'Safety and tolerability',
      dimension: 'safety',
      scopes: [{ source: literature }],
      query: `${name} ${indication} adverse events serious adverse events toxicity dose limiting safety profile`,
    },
    {
      key: 'manufacturability',
      label: 'Manufacturability / CMC',
      dimension: 'manufacturability',
      scopes: [{ source: literature }],
      query: `${name} manufacturing process CMC comparability stability formulation scale-up potency assay`,
    },
    {
      key: 'efficacy',
      label: 'Efficacy and clinical evidence',
      dimension: 'efficacy_clinical_evidence',
      scopes: [{ source: literature }],
      query: `${name} ${indication} efficacy primary endpoint response rate survival effect size biomarker`,
    },
    {
      key: 'pkpd',
      label: 'PK/PD and dosing',
      dimension: 'pkpd_dosing',
      scopes: [{ source: literature }],
      query: `${name} pharmacokinetics pharmacodynamics half-life exposure response dose selection drug interaction`,
    },
    {
      key: 'mechanism',
      label: 'Target and mechanism of action',
      dimension: 'efficacy_clinical_evidence',
      scopes: [{ source: SOURCES.pmc }],
      query: `${name} target mechanism of action pharmacology class`,
    },
  ];

  const sections = [];

  for (const step of plan) {
    for (const scope of step.scopes) {
      const label = scopeLabel(scope);
      onStep?.({ key: step.key, label: step.label, source: label });
      try {
        const result = await search(step.query, { ...scope, limit: perQueryLimit });
        const text = result.text?.trim();
        if (!text) continue;
        sections.push({
          key: step.key,
          label: step.label,
          dimension: step.dimension,
          source: label,
          command: result.command,
          resultId: firstResultId(text),
          text: clip(text, 20000),
        });
      } catch (err) {
        sections.push({
          key: step.key,
          label: step.label,
          dimension: step.dimension,
          source: label,
          error: err.message,
        });
      }
    }
  }

  // Second pass: let Paperclip's own LLM readers pull specifics out of the
  // retrieved papers instead of relying on search snippets alone.
  if (deepRead) {
    const readable = sections.filter((s) => s.resultId).slice(0, 4);

    for (const section of readable) {
      onStep?.({ key: section.key, label: `${section.label} (deep read)`, source: section.source });
      try {
        const mapped = await map(
          section.resultId,
          `For ${name}${indication ? ` in ${indication}` : ''}, extract every concrete finding relevant to ` +
            `${section.label.toLowerCase()}: numbers, incidence rates, endpoints, doses, assay results, and any ` +
            `explicit limitation. Quote figures with units. Say "not reported" when absent.`,
        );

        let text = mapped.text || '';
        const mapId = firstResultId(text);
        if (mapId) {
          try {
            const reduced = await reduce(
              mapId,
              `Synthesise the per-paper findings on ${section.label.toLowerCase()} for ${name}, preserving all numeric values and noting disagreements.`,
              { strategy: 'summarize' },
            );
            if (reduced.text) text = `${text}\n\n--- synthesis ---\n${reduced.text}`;
          } catch {
            // A failed synthesis is not fatal — the per-paper map output stands.
          }
        }

        if (text.trim()) {
          sections.push({
            key: `${section.key}_deep`,
            label: `${section.label} — LLM reader extraction`,
            dimension: section.dimension,
            source: `${section.source} (map/reduce)`,
            command: mapped.command,
            text: clip(text, 24000),
          });
        }
      } catch (err) {
        sections.push({
          key: `${section.key}_deep`,
          label: `${section.label} — LLM reader extraction`,
          dimension: section.dimension,
          source: `${section.source} (map/reduce)`,
          error: err.message,
        });
      }
    }
  }

  const withText = sections.filter((s) => s.text);
  return {
    trial,
    gatheredAt: new Date().toISOString(),
    sections,
    stats: {
      sectionsRequested: sections.length,
      sectionsWithContent: withText.length,
      sectionsFailed: sections.filter((s) => s.error).length,
      totalChars: withText.reduce((sum, s) => sum + s.text.length, 0),
    },
  };
}

/** Render an evidence bundle as the text payload sent to Claude. */
export function renderEvidence(bundle) {
  const parts = [];
  for (const section of bundle.sections) {
    if (!section.text) continue;
    parts.push(
      [
        `### ${section.label}`,
        `scope: ${section.source}`,
        `paperclip command: ${section.command}`,
        '',
        section.text,
      ].join('\n'),
    );
  }
  const failed = bundle.sections.filter((s) => s.error);
  if (failed.length) {
    parts.push(
      `### Retrieval gaps\n${failed.map((s) => `- ${s.label} (${s.source}): ${s.error}`).join('\n')}`,
    );
  }
  return parts.join('\n\n---\n\n');
}
