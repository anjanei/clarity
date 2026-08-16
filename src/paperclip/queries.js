import { PATHS, SOURCES, map, reduce, search } from './tools.js';
import {
  activeDomainsForPhase,
  clarityPhaseLabel,
  normalizeClarityPhase,
} from '../evidence/domains.js';

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

const EVIDENCE_SCOPES = {
  registry: TRIAL_SCOPES,
  fda: [{ source: SOURCES.fda }],
  // PMC provides primary full text; arXiv supplies openly available preprints
  // where a program's public evidence has not yet reached PMC.
  literature: [{ source: [SOURCES.pmc, SOURCES.arxiv] }],
};

/**
 * Evidence bundle for one selected therapeutic, organised around the active
 * CLARITY evidence-skill domains. Scoring is deliberately not done here.
 */
export async function gatherEvidence(trial, { perQueryLimit = 12, deepRead = true, onStep } = {}) {
  const phase = normalizeClarityPhase(trial.phase);
  if (!phase) {
    throw new Error(
      `The CLARITY evidence dossier requires Pre-clinical, Phase 1, Phase 2, or Phase 3; received "${trial.phase || 'Unknown'}".`,
    );
  }
  const domains = activeDomainsForPhase(phase);

  const sections = [];

  for (const domain of domains) {
    for (const step of domain.searches) {
      const query = step.query(trial);
      if (!query) {
        sections.push({
          key: step.key,
          label: step.label,
          domainId: domain.id,
          domainLabel: domain.label,
          source: step.scope,
          error: 'No searchable asset identity was available for this evidence request.',
        });
        continue;
      }
      for (const scope of EVIDENCE_SCOPES[step.scope]) {
        const label = scopeLabel(scope);
        onStep?.({
          key: step.key,
          domainId: domain.id,
          label: `${domain.label}: ${step.label}`,
          source: label,
        });
        try {
          const result = await search(query, { ...scope, limit: perQueryLimit });
          const text = result.text?.trim();
          if (!text) continue;
          sections.push({
            key: step.key,
            label: step.label,
            domainId: domain.id,
            domainLabel: domain.label,
            query,
            scope: step.scope,
            source: label,
            command: result.command,
            resultId: firstResultId(text),
            text: clip(text, 20000),
          });
        } catch (err) {
          sections.push({
            key: step.key,
            label: step.label,
            domainId: domain.id,
            domainLabel: domain.label,
            query,
            scope: step.scope,
            source: label,
            error: err.message,
          });
        }
      }
    }
  }

  // Ask Paperclip's reader to extract one balanced source set per domain. This
  // preserves domain coverage without unbounded map calls for every result set.
  if (deepRead) {
    const readable = domains
      .map((domain) => {
        const candidates = sections.filter((section) => section.domainId === domain.id && section.resultId);
        return candidates.find((section) => section.scope === 'literature') ?? candidates[0];
      })
      .filter(Boolean);

    for (const section of readable) {
      onStep?.({
        key: section.key,
        domainId: section.domainId,
        label: `${section.domainLabel}: ${section.label} (source extraction)`,
        source: section.source,
      });
      try {
        const mapped = await map(
          section.resultId,
          `For ${trial.therapeuticName}${trial.condition ? ` in ${trial.condition}` : ''}, extract every concrete finding relevant to ` +
            `${section.domainLabel}. Preserve numbers and units, record explicit limitations, and identify each primary ` +
            `source with title, DOI/PMCID/NCT/FDA identifier, and a direct URL when available. Do not cite Paperclip ` +
            `commands as sources. Say "not reported" when an element is absent.`,
        );

        let text = mapped.text || '';
        const mapId = firstResultId(text);
        if (mapId) {
          try {
            const reduced = await reduce(
              mapId,
              `Synthesize the per-source findings for ${section.domainLabel} for ${trial.therapeuticName}, preserving ` +
                'source identifiers, direct URLs, numerical values, and disagreements. Do not infer missing data.',
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
            domainId: section.domainId,
            domainLabel: section.domainLabel,
            query: section.query,
            scope: section.scope,
            source: `${section.source} (map/reduce)`,
            command: mapped.command,
            text: clip(text, 24000),
          });
        }
      } catch (err) {
        sections.push({
          key: `${section.key}_deep`,
          label: `${section.label} — LLM reader extraction`,
          domainId: section.domainId,
          domainLabel: section.domainLabel,
          query: section.query,
          scope: section.scope,
          source: `${section.source} (map/reduce)`,
          error: err.message,
        });
      }
    }
  }

  const withText = sections.filter((s) => s.text);
  return {
    trial,
    phase,
    phaseLabel: clarityPhaseLabel(phase),
    domains: domains.map(({ id, label }) => ({ id, label })),
    gatheredAt: new Date().toISOString(),
    sections,
    stats: {
      sectionsRequested: sections.length,
      sectionsWithContent: withText.length,
      sectionsFailed: sections.filter((s) => s.error).length,
      domainsRequested: domains.length,
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
