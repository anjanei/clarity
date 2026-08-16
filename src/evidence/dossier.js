import fs from 'node:fs/promises';
import { structuredCall } from '../anthropic.js';
import { config } from '../config.js';
import {
  EVIDENCE_DOMAINS,
  EVIDENCE_DOSSIER_VERSION,
  ORCHESTRATOR_SKILL_FILE,
  activeDomainsForPhase,
  clarityPhaseLabel,
  inactiveDomainsForPhase,
  outputsForDomain,
} from './domains.js';
import { mapWithConcurrency } from '../utils/concurrency.js';

const DOMAIN_IDS = EVIDENCE_DOMAINS.map((domain) => domain.id);

const citationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'identifier', 'url', 'sourceType'],
  properties: {
    title: { type: 'string', description: 'Primary-source title. Never use a Paperclip command as a title.' },
    identifier: { type: 'string', description: 'DOI, PMCID, NCT number, FDA document identifier, or equivalent public ID.' },
    url: { type: 'string', description: 'Direct https URL to the primary article, registry record, or regulatory document.' },
    sourceType: { type: 'string', enum: ['primary_literature', 'trial_registry', 'regulatory_document'] },
  },
};

const evidenceElementSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['element', 'finding', 'citations', 'confidenceScore', 'rationale'],
  properties: {
    element: { type: 'string', description: 'One requested phase-appropriate element, copied exactly.' },
    finding: { type: 'string', description: 'Concise, source-grounded finding, or exactly "Not found in public sources".' },
    citations: { type: 'array', items: citationSchema },
    confidenceScore: { type: 'integer', description: '10–100. Use 10 for an unfound element.' },
    rationale: { type: 'string', description: 'One sentence explaining source strength, agreement, or the absence of evidence.' },
  },
};

const domainDossierSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['domainId', 'summary', 'elements', 'informationGaps'],
  properties: {
    domainId: { type: 'string', enum: DOMAIN_IDS },
    summary: { type: 'string', description: 'Evidence-only domain synopsis. Do not assign a rubric score or probability.' },
    elements: { type: 'array', items: evidenceElementSchema },
    informationGaps: { type: 'array', items: { type: 'string' } },
  },
};

const skillCache = new Map();

async function readSkill(file) {
  if (!skillCache.has(file)) {
    skillCache.set(
      file,
      fs.readFile(file, 'utf8').catch((err) => {
        skillCache.delete(file);
        throw new Error(`Unable to load CLARITY evidence skill at ${file}: ${err.message}`);
      }),
    );
  }
  return skillCache.get(file);
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanUrl(value) {
  const text = cleanText(value).replace(/[.,;]+$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || /paperclip\.gxl\.ai$/i.test(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Create a stable primary-source URL when Paperclip exposes a canonical ID. */
export function canonicalSourceUrl(identifier, suppliedUrl) {
  const safeUrl = cleanUrl(suppliedUrl);
  if (safeUrl) return safeUrl;

  const value = cleanText(identifier);
  const nct = value.match(/\bNCT\d{8}\b/i)?.[0];
  if (nct) return `https://clinicaltrials.gov/study/${nct.toUpperCase()}`;

  const pmc = value.match(/\bPMC\d+\b/i)?.[0];
  if (pmc) return `https://pmc.ncbi.nlm.nih.gov/articles/${pmc.toUpperCase()}/`;

  const doi = value.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0];
  if (doi) return `https://doi.org/${doi}`;

  return '';
}

function normalizeCitation(citation) {
  const identifier = cleanText(citation?.identifier);
  const url = canonicalSourceUrl(identifier, citation?.url);
  if (!identifier || !url) return null;
  return {
    title: cleanText(citation?.title, identifier),
    identifier,
    url,
    sourceType: ['primary_literature', 'trial_registry', 'regulatory_document'].includes(citation?.sourceType)
      ? citation.sourceType
      : 'primary_literature',
  };
}

function notFoundElement(element, rationale = 'No direct, citable public source was retrieved for this element.') {
  return {
    element,
    finding: 'Not found in public sources',
    citations: [],
    confidenceScore: 10,
    rationale,
  };
}

function normalizeElement(raw, element) {
  if (!raw) return notFoundElement(element, 'This required phase-appropriate element was not returned.');

  const citations = (raw.citations || []).map(normalizeCitation).filter(Boolean);
  if (!citations.length) {
    return notFoundElement(element, 'No direct, citable public source supported the returned content.');
  }

  const confidence = Math.round(Number(raw.confidenceScore));
  return {
    element,
    finding: cleanText(raw.finding, 'Not found in public sources'),
    citations,
    confidenceScore: Number.isFinite(confidence) ? Math.min(100, Math.max(10, confidence)) : 10,
    rationale: cleanText(raw.rationale, 'Evidence confidence was not explained.'),
  };
}

/** Enforce the skill contract without changing downstream scoring behavior. */
export function normalizeDomainDossier(raw, domain, phase) {
  const requestedElements = outputsForDomain(domain, phase);
  const byElement = new Map(
    (raw?.elements || []).map((element) => [cleanText(element.element).toLowerCase(), element]),
  );
  const elements = requestedElements.map((element) =>
    normalizeElement(byElement.get(element.toLowerCase()), element),
  );
  const hasEvidence = elements.some((element) => element.citations.length > 0);

  return {
    domainId: domain.id,
    domainLabel: domain.label,
    status: 'evaluated',
    summary: hasEvidence
      ? cleanText(raw?.summary, 'Evidence was retrieved for this domain.')
      : 'Not found in public sources',
    elements,
    informationGaps: [...new Set((raw?.informationGaps || []).map((gap) => cleanText(gap)).filter(Boolean))],
  };
}

function unavailableDomain(domain, phase, reason) {
  return {
    domainId: domain.id,
    domainLabel: domain.label,
    status: 'not_applicable',
    output: 'Do not generate',
    summary: 'Do not generate',
    elements: outputsForDomain(domain, phase).map((element) => notFoundElement(element, reason)),
    informationGaps: [reason],
  };
}

function unavailableEvidenceDomain(domain, phase) {
  return {
    domainId: domain.id,
    domainLabel: domain.label,
    status: 'evaluated',
    summary: 'Not found in public sources',
    elements: outputsForDomain(domain, phase).map((element) => notFoundElement(element)),
    informationGaps: ['No public evidence was retrieved for this active domain.'],
  };
}

/**
 * A successful Paperclip map/reduce is a citation-oriented transformation of a
 * raw result set. Do not send both to Claude: it pays twice for the same
 * evidence and can overweight a repeated finding. Raw material remains as a
 * fallback if deep extraction was unavailable.
 */
export function selectEvidenceForDomainPrompt(sections) {
  const deepBases = new Set(
    sections
      .filter((section) => section.text && section.key?.endsWith('_deep'))
      .map((section) => section.key.slice(0, -'_deep'.length)),
  );
  const seen = new Set();
  return sections.filter((section) => {
    if (!section.text) return false;
    if (!section.key?.endsWith('_deep') && deepBases.has(section.key)) return false;
    const fingerprint = `${section.scope ?? ''}\u0000${section.text}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function renderDomainEvidence(sections) {
  return selectEvidenceForDomainPrompt(sections)
    .map((section) => [
      `### ${section.label}`,
      `retrieval scope: ${section.source}`,
      '',
      section.text,
    ].join('\n'))
    .join('\n\n---\n\n');
}

const DOMAIN_EVIDENCE_INSTRUCTIONS = `You prepare the cited evidence content for one section of an FDA review dossier. You are not the
downstream rubric scorer: do not assign any score, weight, probability, approval recommendation, or risk rating.

Use only the evidence packet supplied by the user. A source citation is valid only when it names a direct
primary article, trial-registry record, or regulatory document with a public identifier and direct HTTPS link.
Paperclip commands, result-set IDs, and unsupported background knowledge are not citations. If a direct source
cannot support an element, return exactly "Not found in public sources" with an empty citations array and a
confidenceScore of 10. Do not make links up.`;

/** The cache breakpoint follows the domain-invariant CLARITY policy. */
export function domainSystemPrompt(orchestrator, domainSkill) {
  return [
    DOMAIN_EVIDENCE_INSTRUCTIONS,
    { text: `# Shared CLARITY policy\n\n${orchestrator}`, cache: true },
    `# Active CLARITY domain skill\n\n${domainSkill}`,
  ];
}


function domainUserContent(trial, domain, phase, sections) {
  const requested = outputsForDomain(domain, phase);
  return [
    '# Asset',
    '```json',
    JSON.stringify(trial, null, 2),
    '```',
    '',
    `# Development phase\n${clarityPhaseLabel(phase)}`,
    '',
    '# Required output elements',
    ...requested.map((element) => `- ${element}`),
    '',
    '# Domain evidence packet',
    renderDomainEvidence(sections),
    '',
    '# Task',
    `Produce evidence-only content for ${domain.label}. Return exactly one entry for every required output element.`,
  ].join('\n');
}

function addUsage(total, usage) {
  for (const [key, value] of Object.entries(usage || {})) {
    if (typeof value === 'number') total[key] = (total[key] || 0) + value;
  }
  return total;
}

/**
 * Run each active CLARITY skill over its pooled evidence. The returned dossier
 * contains content and citations only; the existing scoring call consumes it
 * unchanged later in the evaluation pipeline.
 */
export async function synthesizeEvidenceDossier(
  trial,
  bundle,
  { onStep, trace, domainConcurrency = config.evidence.domainConcurrency } = {},
) {
  const phase = bundle.phase;
  const activeDomains = activeDomainsForPhase(phase);
  const inactiveDomains = inactiveDomainsForPhase(phase);
  const [orchestrator, ...domainSkills] = await Promise.all([
    readSkill(ORCHESTRATOR_SKILL_FILE),
    ...activeDomains.map((domain) => readSkill(domain.skillFile)),
  ]);
  const evaluatedDomains = await mapWithConcurrency(activeDomains, domainConcurrency, async (domain, index) => {
    const sections = bundle.sections.filter((section) => section.domainId === domain.id && section.text);
    if (!sections.length) {
      return { dossier: unavailableEvidenceDomain(domain, phase), usage: null };
    }

    onStep?.({
      stage: 'dossier',
      domainId: domain.id,
      message: `Synthesizing cited evidence for ${domain.label}`,
    });
    const { data, usage: domainUsage } = await structuredCall({
      system: domainSystemPrompt(orchestrator, domainSkills[index]),
      userContent: domainUserContent(trial, domain, phase, sections),
      schema: domainDossierSchema,
      effort: config.anthropic.extractEffort,
      maxTokens: 14000,
      trace,
      traceLabel: `dossier.${domain.id}`,
    });
    return { dossier: normalizeDomainDossier(data, domain, phase), usage: domainUsage };
  });

  const usage = {};
  const domains = evaluatedDomains.map((result) => {
    addUsage(usage, result.usage);
    return result.dossier;
  });

  for (const domain of inactiveDomains) {
    domains.push(unavailableDomain(domain, phase, `The ${clarityPhaseLabel(phase)} CLARITY phase does not generate this domain.`));
  }

  return {
    version: EVIDENCE_DOSSIER_VERSION,
    phase,
    phaseLabel: clarityPhaseLabel(phase),
    domains: EVIDENCE_DOMAINS.map((definition) => domains.find((domain) => domain.domainId === definition.id)),
    usage,
  };
}

/** Render the evidence-only dossier as the input to the unchanged scoring call. */
export function renderEvidenceDossier(dossier) {
  return dossier.domains.map((domain) => {
    const header = [`## ${domain.domainLabel}`, `Status: ${domain.status}`];
    if (domain.status === 'not_applicable') return [...header, 'Do not generate'].join('\n\n');

    const elements = domain.elements.map((element) => {
      const citations = element.citations.length
        ? element.citations.map((citation) => `- ${citation.title} (${citation.identifier}): ${citation.url}`).join('\n')
        : '- None';
      return [
        `### ${element.element}`,
        element.finding,
        `Confidence: ${element.confidenceScore}% — ${element.rationale}`,
        'Direct sources:',
        citations,
      ].join('\n');
    });
    const gaps = domain.informationGaps.length
      ? `Information gaps:\n${domain.informationGaps.map((gap) => `- ${gap}`).join('\n')}`
      : '';
    return [...header, domain.summary, ...elements, gaps].filter(Boolean).join('\n\n');
  }).join('\n\n---\n\n');
}
