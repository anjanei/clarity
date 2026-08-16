import path from 'node:path';
import { paths } from '../config.js';

export const EVIDENCE_DOSSIER_VERSION = '1.0.0';

const skillRoot = path.join(paths.root, 'evidence_skills', 'CLARITY_FDA_Review_Skills');

export const ORCHESTRATOR_SKILL_FILE = path.join(skillRoot, '00_orchestrator', 'SKILL.md');

export const CLARITY_PHASES = ['preclinical', 'phase1', 'phase2', 'phase3'];

const phaseRank = Object.freeze({
  preclinical: 0,
  phase1: 1,
  phase2: 2,
  phase3: 3,
});

/** Map catalog values to the four development phases supported by the CLARITY skills. */
export function normalizeClarityPhase(phase) {
  const value = String(phase || '').trim().toLowerCase();
  // Callers may already hold the canonical internal value after an earlier
  // normalization pass (for example, gatherEvidence → activeDomainsForPhase).
  if (CLARITY_PHASES.includes(value)) return value;
  if (value === 'pre-clinical' || value === 'preclinical') return 'preclinical';
  if (value === 'early phase 1' || value === 'phase 1' || value === 'phase 1/2') return 'phase1';
  if (value === 'phase 2' || value === 'phase 2/3') return 'phase2';
  if (value === 'phase 3') return 'phase3';
  return null;
}

export function clarityPhaseLabel(phase) {
  return {
    preclinical: 'Pre-clinical',
    phase1: 'Phase 1',
    phase2: 'Phase 2',
    phase3: 'Phase 3',
  }[phase] ?? phase;
}

function terms(trial, extra = '') {
  return [trial.therapeuticName, trial.condition, trial.modality, extra]
    .filter((value) => value && value !== 'Unknown')
    .join(' ');
}

function registryTerms(trial, extra = '') {
  return [trial.trialId, trial.therapeuticName, trial.condition, extra]
    .filter((value) => value && value !== 'Unknown')
    .join(' ');
}

function outputs(preclinical, phase1 = preclinical, phase2 = phase1, phase3 = phase2) {
  return { preclinical, phase1, phase2, phase3 };
}

/**
 * Executable counterpart to the CLARITY Markdown skills. The Markdown remains
 * the human-readable policy and is supplied verbatim to each domain call.
 */
export const EVIDENCE_DOMAINS = [
  {
    id: 'disease_context_mechanism',
    label: 'Disease Context & Mechanism',
    skillFile: path.join(skillRoot, '01_disease_context_mechanism', 'SKILL.md'),
    activeFrom: 'preclinical',
    outputs: outputs([
      'Disease name, etiology, and core symptoms',
      'Mechanism of action',
      'Literature review',
      'Prior landscape / similar products on the market',
    ]),
    searches: [
      { key: 'registry', label: 'Trial registry context', scope: 'registry', query: (trial) => registryTerms(trial, 'condition intervention rationale') },
      { key: 'literature', label: 'Primary literature: disease context and mechanism', scope: 'literature', query: (trial) => terms(trial, 'disease natural history mechanism of action treatment landscape') },
      { key: 'regulatory', label: 'Regulatory precedents', scope: 'fda', query: (trial) => terms(trial, 'approved treatment review indication') },
    ],
  },
  {
    id: 'trial_design',
    label: 'Trial Design',
    skillFile: path.join(skillRoot, '02_trial_design', 'SKILL.md'),
    activeFrom: 'phase1',
    outputs: outputs(
      [],
      ['Target effects (in vitro, in vivo, clinical)', 'Dose-response results', 'Inclusion / exclusion criteria', 'Experimental & trial study design'],
      ['Target effects (in vitro, in vivo, clinical)', 'Dose-response results', 'Inclusion / exclusion criteria', 'Experimental & trial study design', 'Efficacy endpoints & responder rates'],
    ),
    searches: [
      { key: 'registry', label: 'Trial registry design', scope: 'registry', query: (trial) => registryTerms(trial, 'protocol endpoints eligibility arms outcomes') },
      { key: 'literature', label: 'Primary literature: trial design and efficacy', scope: 'literature', query: (trial) => terms(trial, 'clinical trial primary endpoint response rate dose response control randomization') },
      { key: 'regulatory', label: 'Regulatory design precedents', scope: 'fda', query: (trial) => terms(trial, 'clinical review endpoint trial design approval') },
    ],
  },
  {
    id: 'acute_safety_tolerability',
    label: 'Acute Safety & Tolerability',
    skillFile: path.join(skillRoot, '03_acute_safety_tolerability', 'SKILL.md'),
    activeFrom: 'preclinical',
    outputs: outputs(['Adverse Events by System Organ Class (SOC)', 'Non-fatal adverse events & serious AEs', 'Blood test results & organ function panels', 'Expected & unexpected off-target effects']),
    searches: [
      { key: 'literature', label: 'Primary literature: acute safety', scope: 'literature', query: (trial) => terms(trial, 'adverse events serious adverse events toxicity dose limiting laboratory organ function safety') },
      { key: 'registry', label: 'Trial registry safety reporting', scope: 'registry', query: (trial) => registryTerms(trial, 'adverse events safety monitoring') },
      { key: 'regulatory', label: 'Regulatory safety evidence', scope: 'fda', query: (trial) => terms(trial, 'safety review adverse events warning') },
    ],
  },
  {
    id: 'long_term_genetic_risk',
    label: 'Long-Term Genetic Risk',
    skillFile: path.join(skillRoot, '04_long_term_genetic_risk', 'SKILL.md'),
    activeFrom: 'phase2',
    outputs: outputs([], [], ['Off-target editing assays (in vitro / in vivo)', 'Malignancy and insertional oncogenesis screening', 'Genomic stability assessments']),
    searches: [
      { key: 'literature', label: 'Primary literature: long-term genetic risk', scope: 'literature', query: (trial) => terms(trial, 'off-target editing integration site insertional oncogenesis clonality genomic stability malignancy') },
      { key: 'regulatory', label: 'Regulatory long-term follow-up evidence', scope: 'fda', query: (trial) => terms(trial, 'gene therapy long term follow-up integration oncogenesis review') },
    ],
  },
  {
    id: 'biodistribution_pharmacology',
    label: 'Biodistribution & Pharmacology',
    skillFile: path.join(skillRoot, '05_biodistribution_pharmacology', 'SKILL.md'),
    activeFrom: 'phase1',
    outputs: outputs([], ['In vivo biodistribution profiles', 'Transgene expression & cellular kinetics'], ['In vivo biodistribution profiles', 'Transgene expression & cellular kinetics', 'Time-dependency of exposure']),
    searches: [
      { key: 'literature', label: 'Primary literature: biodistribution and pharmacology', scope: 'literature', query: (trial) => terms(trial, 'biodistribution transgene expression cellular kinetics persistence shedding pharmacokinetics exposure') },
      { key: 'regulatory', label: 'Regulatory pharmacology evidence', scope: 'fda', query: (trial) => terms(trial, 'clinical pharmacology biodistribution pharmacokinetics review') },
    ],
  },
  {
    id: 'immunogenicity_special_populations',
    label: 'Immunogenicity & Special Populations',
    skillFile: path.join(skillRoot, '06_immunogenicity_special_populations', 'SKILL.md'),
    activeFrom: 'phase1',
    outputs: outputs([], ['Baseline demographics & comorbidities', 'Neutralizing antibodies & T-cell responses'], ['Baseline demographics & comorbidities', 'Special populations (e.g., pediatric, renal/hepatic impairment)', 'Neutralizing antibodies & T-cell responses']),
    searches: [
      { key: 'literature', label: 'Primary literature: immunogenicity and special populations', scope: 'literature', query: (trial) => terms(trial, 'immunogenicity anti-drug antibodies neutralizing antibodies T-cell response pediatric renal hepatic impairment') },
      { key: 'registry', label: 'Trial registry population criteria', scope: 'registry', query: (trial) => registryTerms(trial, 'demographics comorbidities pediatric renal hepatic eligibility') },
      { key: 'regulatory', label: 'Regulatory immunogenicity evidence', scope: 'fda', query: (trial) => terms(trial, 'immunogenicity clinical review special populations') },
    ],
  },
  {
    id: 'product_quality_cmc',
    label: 'Product Quality & CMC',
    skillFile: path.join(skillRoot, '07_product_quality_cmc', 'SKILL.md'),
    activeFrom: 'preclinical',
    outputs: outputs(['Quality compliance & release specifications'], ['Assay validation', 'Quality compliance & release specifications'], ['Assay validation', 'Quality compliance & release specifications', 'Facility inspection records & process consistency']),
    searches: [
      { key: 'literature', label: 'Primary literature: product quality and CMC', scope: 'literature', query: (trial) => terms(trial, 'manufacturing CMC release specification potency assay validation comparability stability scale-up') },
      { key: 'regulatory', label: 'Regulatory CMC evidence', scope: 'fda', query: (trial) => terms(trial, 'chemistry manufacturing controls inspection comparability review') },
    ],
  },
  {
    id: 'trial_integrity_governance',
    label: 'Trial Integrity, Governance & Operational Infrastructure',
    skillFile: path.join(skillRoot, '08_trial_integrity_governance', 'SKILL.md'),
    activeFrom: 'phase1',
    outputs: outputs([], ['Good Clinical Practices (GCP) compliance', 'Protocol deviations & violations', 'Financial disclosures & investigator conflicts']),
    searches: [
      { key: 'registry', label: 'Trial registry governance evidence', scope: 'registry', query: (trial) => registryTerms(trial, 'protocol deviations investigator conflicts disclosures monitoring') },
      { key: 'regulatory', label: 'Regulatory trial integrity evidence', scope: 'fda', query: (trial) => terms(trial, 'GCP inspection protocol deviation clinical trial integrity financial disclosure') },
      { key: 'literature', label: 'Primary literature: trial operations', scope: 'literature', query: (trial) => terms(trial, 'clinical trial protocol deviations governance investigator conflict') },
    ],
  },
  {
    id: 'benefit_risk_postmarketing',
    label: 'Benefit–Risk & Postmarketing Controls',
    skillFile: path.join(skillRoot, '09_benefit_risk_postmarketing', 'SKILL.md'),
    activeFrom: 'phase3',
    outputs: outputs([], [], [], ['Overall risk-benefit assessment criteria', 'Long-term follow-up (LTFU) protocols (e.g., 15-year tracking)', 'Pharmacovigilance and risk evaluation mitigation strategies (REMS)']),
    searches: [
      { key: 'regulatory', label: 'Regulatory benefit-risk and postmarketing evidence', scope: 'fda', query: (trial) => terms(trial, 'benefit risk REMS pharmacovigilance postmarketing long term follow-up review') },
      { key: 'registry', label: 'Trial registry long-term follow-up', scope: 'registry', query: (trial) => registryTerms(trial, 'long term follow-up safety monitoring') },
      { key: 'literature', label: 'Primary literature: long-term follow-up', scope: 'literature', query: (trial) => terms(trial, 'long term follow-up pharmacovigilance benefit risk') },
    ],
  },
];

export function activeDomainsForPhase(phase) {
  const normalized = normalizeClarityPhase(phase);
  if (!normalized) return [];
  return EVIDENCE_DOMAINS.filter((domain) => phaseRank[domain.activeFrom] <= phaseRank[normalized]);
}

export function inactiveDomainsForPhase(phase) {
  const normalized = normalizeClarityPhase(phase);
  if (!normalized) return [...EVIDENCE_DOMAINS];
  return EVIDENCE_DOMAINS.filter((domain) => phaseRank[domain.activeFrom] > phaseRank[normalized]);
}

export function outputsForDomain(domain, phase) {
  const normalized = normalizeClarityPhase(phase);
  return normalized ? domain.outputs[normalized] ?? [] : [];
}
