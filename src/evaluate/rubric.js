
/**
 * FDA Review Rubric and Dossier Components
 *
 * This file defines:
 *   1. FDA review domains and their core regulatory questions.
 *   2. Signals reviewers should look for.
 *   3. Phase-specific dossier/review components.
 *   4. A 1–5 scoring rubric for regulatory readiness.
 *
 * Phase rules:
 *   - Pre-clinical: only pre-clinical components are generated.
 *   - Phase 1: only Phase 1 components are generated.
 *   - Phase 2: only Phase 2 components are generated.
 *   - Phase 3: only Phase 3 components are generated.
 *
 * The phase-specific component lists intentionally follow the supplied
 * rubric rather than generating later-stage evidence prematurely.
 */

export const FDA_REVIEW_DOMAINS = [
  {
    id: 'disease_context_mechanism',
    label: 'Disease Context & Mechanism',
    regulatoryQuestion:
      'What is the unmet need and biological rationale?',
    signalsToLookFor: [
      'Disease name, etiology, and core symptoms',
      'Mechanism of action',
      'Literature review',
      'Prior landscape / similar products on the market',
    ],

    phases: {
      preclinical: [
        'Disease name, etiology, and core symptoms',
        'Mechanism of action',
        'Literature review',
        'Prior landscape / similar products on the market',
      ],
      phase1: [
        'Disease name, etiology, and core symptoms',
        'Mechanism of action',
        'Literature review',
        'Prior landscape / similar products on the market',
      ],
      phase2: [
        'Disease name, etiology, and core symptoms',
        'Mechanism of action',
        'Literature review',
        'Prior landscape / similar products on the market',
      ],
      phase3: [
        'Disease name, etiology, and core symptoms',
        'Mechanism of action',
        'Literature review',
        'Prior landscape / similar products on the market',
      ],
    },
  },

  {
    id: 'trial_design',
    label: 'Trial Design',
    regulatoryQuestion:
      'Does the therapy improve a clinically meaningful endpoint?',
    signalsToLookFor: [
      'Pivotal trials',
      'Responder analyses',
      'Durability of response',
      'Surrogate endpoints',
    ],

    phases: {
      preclinical: [],

      phase1: [
        'Target effects (in vitro, in vivo, clinical)',
        'Dose-response results',
        'Inclusion / exclusion criteria',
        'Experimental & trial study design',
      ],

      phase2: [
        'Target effects (in vitro, in vivo, clinical)',
        'Dose-response results',
        'Inclusion / exclusion criteria',
        'Experimental & trial study design',
        'Efficacy endpoints & responder rates',
      ],

      phase3: [
        'Target effects (in vitro, in vivo, clinical)',
        'Dose-response results',
        'Inclusion / exclusion criteria',
        'Experimental & trial study design',
        'Efficacy endpoints & responder rates',
      ],
    },
  },

  {
    id: 'acute_safety_tolerability',
    label: 'Acute Safety & Tolerability',
    regulatoryQuestion:
      'What harms occur shortly after dosing?',
    signalsToLookFor: [
      'Adverse Events by System Organ Class (SOC)',
      'Non-fatal adverse events & serious AEs',
      'Blood test results & organ function panels',
      'Expected & unexpected off-target effects',
    ],

    phases: {
      preclinical: [
        'Adverse Events by System Organ Class (SOC)',
        'Non-fatal adverse events & serious AEs',
        'Blood test results & organ function panels',
        'Expected & unexpected off-target effects',
      ],

      phase1: [
        'Adverse Events by System Organ Class (SOC)',
        'Non-fatal adverse events & serious AEs',
        'Blood test results & organ function panels',
        'Expected & unexpected off-target effects',
      ],

      phase2: [
        'Adverse Events by System Organ Class (SOC)',
        'Non-fatal adverse events & serious AEs',
        'Blood test results & organ function panels',
        'Expected & unexpected off-target effects',
      ],

      phase3: [
        'Adverse Events by System Organ Class (SOC)',
        'Non-fatal adverse events & serious AEs',
        'Blood test results & organ function panels',
        'Expected & unexpected off-target effects',
      ],
    },
  },

  {
    id: 'long_term_genetic_risk',
    label: 'Long-Term Genetic Risk',
    regulatoryQuestion:
      'Could the therapy cause malignancy or unintended genetic alterations?',
    signalsToLookFor: [
      'Integration-site analysis',
      'Off-target editing assays',
      'Clonality',
      'Tumor surveillance',
    ],

    phases: {
      preclinical: [],
      phase1: [],

      phase2: [
        'Off-target editing assays (in vitro / in vivo)',
        'Malignancy and insertional oncogenesis screening',
        'Genomic stability assessments',
      ],

      phase3: [
        'Off-target editing assays (in vitro / in vivo)',
        'Malignancy and insertional oncogenesis screening',
        'Genomic stability assessments',
      ],
    },
  },

  {
    id: 'biodistribution_pharmacology',
    label: 'Biodistribution & Pharmacology',
    regulatoryQuestion:
      'Where does the vector/cell product go and what does it express?',
    signalsToLookFor: [
      'Animal biodistribution',
      'Transgene expression',
      'Vector shedding',
      'Biomarker kinetics',
    ],

    phases: {
      preclinical: [],

      phase1: [
        'In vivo biodistribution profiles',
        'Transgene expression & cellular kinetics',
      ],

      phase2: [
        'In vivo biodistribution profiles',
        'Transgene expression & cellular kinetics',
        'Time-dependency of exposure',
      ],

      phase3: [
        'In vivo biodistribution profiles',
        'Transgene expression & cellular kinetics',
        'Time-dependency of exposure',
      ],
    },
  },

  {
    id: 'immunogenicity_special_populations',
    label: 'Immunogenicity & Special Populations',
    regulatoryQuestion:
      'Can host immune responses limit efficacy or cause severe toxicity?',
    signalsToLookFor: [
      'Anti-capsid antibodies',
      'Anti-transgene antibodies',
      'Cellular immunity',
      'Re-dosing constraints',
    ],

    phases: {
      preclinical: [],

      phase1: [
        'Baseline demographics & comorbidities',
        'Neutralizing antibodies & T-cell responses',
      ],

      phase2: [
        'Baseline demographics & comorbidities',
        'Special populations (e.g., pediatric, renal/hepatic impairment)',
        'Neutralizing antibodies & T-cell responses',
      ],

      phase3: [
        'Baseline demographics & comorbidities',
        'Special populations (e.g., pediatric, renal/hepatic impairment)',
        'Neutralizing antibodies & T-cell responses',
      ],
    },
  },

  {
    id: 'product_quality_cmc',
    label: 'Product Quality & CMC',
    regulatoryQuestion:
      'Can commercial lots be manufactured consistently, potently, and safely?',
    signalsToLookFor: [
      'Identity',
      'Purity',
      'Potency',
      'Impurities',
      'Stability',
      'Comparability',
      'Process validation',
    ],

    phases: {
      preclinical: [
        'Quality compliance & release specifications',
      ],

      phase1: [
        'Assay validation',
        'Quality compliance & release specifications',
      ],

      phase2: [
        'Assay validation',
        'Quality compliance & release specifications',
        'Facility inspection records & process consistency',
      ],

      phase3: [
        'Assay validation',
        'Quality compliance & release specifications',
        'Facility inspection records & process consistency',
      ],
    },
  },

  {
    id: 'trial_integrity_governance',
    label: 'Trial Integrity, Governance & Operational Infrastructure',
    regulatoryQuestion:
      'Were the trials conducted with rigorous compliance and ethical oversight?',
    signalsToLookFor: [
      'Protocol adherence',
      'Clinical site audits',
      'GCP inspections',
    ],

    phases: {
      preclinical: [],

      phase1: [
        'Good Clinical Practices (GCP) compliance',
        'Protocol deviations & violations',
        'Financial disclosures & investigator conflicts',
      ],

      phase2: [
        'Good Clinical Practices (GCP) compliance',
        'Protocol deviations & violations',
        'Financial disclosures & investigator conflicts',
      ],

      phase3: [
        'Good Clinical Practices (GCP) compliance',
        'Protocol deviations & violations',
        'Financial disclosures & investigator conflicts',
      ],
    },
  },

  {
    id: 'benefit_risk_postmarketing',
    label: 'Benefit–Risk & Postmarketing Controls',
    regulatoryQuestion:
      'What residual uncertainties remain, and how will long-term safety be tracked?',
    signalsToLookFor: [
      'Benefit–risk uncertainty',
      '15-year patient registries',
      'Confirmatory trials',
      'CMC commitments',
    ],

    phases: {
      preclinical: [],
      phase1: [],
      phase2: [],

      phase3: [
        'Overall risk-benefit assessment criteria',
        'Long-term follow-up (LTFU) protocols (e.g., 15-year tracking)',
        'Pharmacovigilance and risk evaluation mitigation strategies (REMS)',
      ],
    },
  },
];

/**
 * Explicit phase labels accepted by the dossier generator.
 */
export const FDA_PHASES = {
  PRECLINICAL: 'preclinical',
  PHASE1: 'phase1',
  PHASE2: 'phase2',
  PHASE3: 'phase3',
};

/**
 * Phase-specific components only.
 *
 * This function is intentionally strict: it does not backfill a later-phase
 * component into an earlier phase.
 */
export function getPhaseDossierComponents(phase) {
  const normalizedPhase = normalizePhase(phase);

  return FDA_REVIEW_DOMAINS.map((domain) => ({
    domainId: domain.id,
    domain: domain.label,
    regulatoryQuestion: domain.regulatoryQuestion,
    signalsToLookFor: [...domain.signalsToLookFor],
    components: [...domain.phases[normalizedPhase]],
  })).filter((domain) => domain.components.length > 0);
}

/**
 * Generate only the components allowed for the requested phase.
 */
export function generatePhaseReviewElements(phase) {
  return getPhaseDossierComponents(phase);
}

/**
 * Convenience functions for callers that want a fixed phase.
 */
export const getPreclinicalReviewElements = () =>
  getPhaseDossierComponents(FDA_PHASES.PRECLINICAL);

export const getPhase1ReviewElements = () =>
  getPhaseDossierComponents(FDA_PHASES.PHASE1);

export const getPhase2ReviewElements = () =>
  getPhaseDossierComponents(FDA_PHASES.PHASE2);

export const getPhase3ReviewElements = () =>
  getPhaseDossierComponents(FDA_PHASES.PHASE3);

/**
 * Normalize common representations such as:
 *   "pre-clinical"
 *   "Preclinical"
 *   "Phase 1"
 *   "phase 2a"
 *   "phase 2b"
 *   "Phase 3a"
 *   "Phase 3b"
 */
export function normalizePhase(phase) {
  if (typeof phase !== 'string') {
    throw new TypeError('FDA phase must be a string.');
  }

  const normalized = phase
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

  if (
    normalized === 'preclinical' ||
    normalized === 'preclin' ||
    normalized === 'pre'
  ) {
    return FDA_PHASES.PRECLINICAL;
  }

  if (
    normalized === 'phase1' ||
    normalized === 'p1'
  ) {
    return FDA_PHASES.PHASE1;
  }

  if (
    normalized === 'phase2' ||
    normalized === 'phase2a' ||
    normalized === 'phase2b' ||
    normalized === 'p2'
  ) {
    return FDA_PHASES.PHASE2;
  }

  if (
    normalized === 'phase3' ||
    normalized === 'phase3a' ||
    normalized === 'phase3b' ||
    normalized === 'p3'
  ) {
    return FDA_PHASES.PHASE3;
  }

  throw new RangeError(
    `Unsupported FDA phase "${phase}". ` +
    'Expected preclinical, phase 1, phase 2/2a/2b, or phase 3/3a/3b.'
  );
}


/* -------------------------------------------------------------------------- */
/* Regulatory scoring rubric                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Each dimension is scored 1–5.
 *
 * The weights sum to 1.00 and are used to sanity-check an overall regulatory
 * probability/readiness assessment.
 */
export const DIMENSIONS = [
  {
    id: 'disease_context_mechanism',
    label: 'Disease Context & Mechanism',
    weight: 0.05,
    focus:
      'Unmet medical need, disease natural history, biological rationale, ' +
      'mechanism of action, literature support, and differentiation from ' +
      'existing therapies.',
    anchors: {
      1: 'No credible biological rationale or meaningful understanding of the disease context.',
      2: 'Rationale is speculative or poorly differentiated from existing approaches.',
      3: 'Plausible biological rationale with reasonable literature support but meaningful uncertainties.',
      4: 'Well-supported disease rationale and mechanism with clear clinical relevance.',
      5: 'Compelling unmet need and thoroughly validated mechanism with strong differentiation and precedent.',
    },
  },

  {
    id: 'efficacy_clinical_evidence',
    label: 'Efficacy & Clinical Evidence',
    weight: 0.22,
    focus:
      'Endpoint selection and clinical meaningfulness, observed effect size versus control, ' +
      'statistical power and multiplicity control, biomarker/patient-selection strategy, ' +
      'consistency across cohorts and studies, responder analyses, durability, and whether ' +
      'the evidence supports a substantial-evidence-of-effectiveness finding.',
    anchors: {
      1: 'No credible efficacy signal, or endpoints that would not support approval.',
      2: 'Weak or purely exploratory signal; endpoint or population poorly justified.',
      3: 'Plausible signal on an acceptable endpoint, but underpowered or single-arm.',
      4: 'Clinically meaningful effect on an accepted endpoint with adequate design.',
      5: 'Large, reproducible effect on a validated endpoint in an adequately powered controlled trial.',
    },
  },

  {
    id: 'safety',
    label: 'Safety & Tolerability',
    weight: 0.20,
    focus:
      'Serious adverse event rates and causality, dose-limiting toxicities, deaths, ' +
      'discontinuation rates, organ-system signals, class effects, black-box risk, ' +
      'adequacy of monitoring and mitigation, and benefit–risk for the intended population.',
    anchors: {
      1: 'Unacceptable toxicity or unexplained deaths; benefit–risk clearly unfavourable.',
      2: 'Serious signals requiring major mitigation or population restriction.',
      3: 'Manageable toxicity typical of the class, with gaps in characterisation.',
      4: 'Well-characterised, manageable safety profile with adequate monitoring.',
      5: 'Clean, thoroughly characterised profile with favourable benefit–risk.',
    },
  },

  {
    id: 'long_term_genetic_risk',
    label: 'Long-Term Genetic Risk',
    weight: 0.10,
    focus:
      'Off-target effects, genomic stability, integration-site risk, clonality, ' +
      'insertional oncogenesis, malignancy surveillance, and adequacy of long-term follow-up ' +
      'for products capable of persistent genetic effects.',
    anchors: {
      1: 'Credible major genetic or oncogenic risk is unresolved and benefit–risk is unacceptable.',
      2: 'Important genetic-risk questions remain inadequately characterised.',
      3: 'Risk appears manageable but long-term evidence or surveillance remains incomplete.',
      4: 'Genetic-risk profile is well characterised with appropriate monitoring.',
      5: 'Extensive genetic-risk package with strong long-term evidence and surveillance.',
    },
  },

  {
    id: 'biodistribution_pharmacology',
    label: 'Biodistribution & Pharmacology',
    weight: 0.10,
    focus:
      'Distribution of the vector/cell/product, target engagement, transgene expression, ' +
      'cellular kinetics, biomarker kinetics, exposure over time, persistence, and shedding where applicable.',
    anchors: {
      1: 'Distribution or pharmacology is unknown or inconsistent with the proposed mechanism.',
      2: 'Sparse or poorly interpretable distribution/pharmacology data.',
      3: 'Adequate characterization with meaningful exposure or persistence gaps.',
      4: 'Well-characterised distribution, expression, and pharmacological activity.',
      5: 'Comprehensive quantitative characterization directly linking distribution to pharmacology and clinical effects.',
    },
  },

  {
    id: 'immunogenicity',
    label: 'Immunogenicity',
    weight: 0.05,
    focus:
      'Anti-drug, anti-capsid, anti-transgene, or cellular immune responses; neutralising ' +
      'antibody incidence and titre; impact on exposure, efficacy and safety; assay validation; ' +
      'hypersensitivity; infusion reactions; and re-dosing constraints.',
    anchors: {
      1: 'High-titre neutralising ADA that abolishes exposure or efficacy, or severe hypersensitivity.',
      2: 'Clinically consequential immunogenicity with inadequate assessment or mitigation.',
      3: 'Detectable immunogenicity of unclear clinical consequence; assay strategy partially characterised.',
      4: 'Low or clinically inconsequential immunogenicity with an adequate validated assay strategy.',
      5: 'Negligible immunogenicity, thoroughly characterised with validated tiered assays.',
    },
  },

  {
    id: 'manufacturability',
    label: 'Manufacturability & CMC',
    weight: 0.10,
    focus:
      'Process definition and control strategy, comparability across scales and sites, ' +
      'potency and identity assays, critical quality attributes, stability and shelf life, ' +
      'formulation and delivery, batch failure and cold-chain risk, raw-material/vector/cell supply, ' +
      'facility readiness, and commercial-scale validation.',
    anchors: {
      1: 'No viable commercial process; product cannot be reliably characterised.',
      2: 'Immature process with unresolved comparability or potency-assay problems.',
      3: 'Workable clinical process with meaningful scale-up or control-strategy gaps.',
      4: 'Well-controlled process with defined CQAs and demonstrated comparability.',
      5: 'Commercial-ready, validated process with robust assays and stability data.',
    },
  },

  {
    id: 'pkpd_dosing',
    label: 'PK/PD & Dosing',
    weight: 0.08,
    focus:
      'Pharmacokinetic characterization, exposure–response for efficacy and safety, ' +
      'dose and regimen justification, target engagement, half-life and accumulation, ' +
      'drug–drug interaction and food effects where applicable, and special populations.',
    anchors: {
      1: 'Dose selected without exposure–response basis; PK poorly characterised.',
      2: 'Sparse PK and no exposure–response analysis; regimen weakly justified.',
      3: 'Adequate PK with partial exposure–response and some population gaps.',
      4: 'Well-characterised PK with exposure–response supporting the chosen regimen.',
      5: 'Complete PK/PD package with quantitative exposure–response and special populations covered.',
    },
  },

  {
    id: 'trial_design_regulatory',
    label: 'Trial Design & Regulatory Strategy',
    weight: 0.07,
    focus:
      'Control arm and blinding, randomisation and bias control, enrolment feasibility, ' +
      'site and geographic distribution, US-population applicability, statistical analysis, ' +
      'interim strategy, regulatory precedent, and eligibility for expedited pathways.',
    anchors: {
      1: 'Design cannot support a regulatory conclusion; enrolment or comparator infeasible.',
      2: 'Serious design weaknesses such as inappropriate comparator or unblinded subjective endpoint.',
      3: 'Acceptable design with notable feasibility or interpretability risks.',
      4: 'Well-designed and feasible trial aligned with regulatory precedent.',
      5: 'Exemplary design with clear precedent and a credible expedited-pathway case.',
    },
  },

  {
    id: 'trial_integrity_governance',
    label: 'Trial Integrity, Governance & Operational Infrastructure',
    weight: 0.03,
    focus:
      'GCP compliance, protocol adherence, deviations and violations, site oversight, ' +
      'audits, inspections, investigator conflicts, financial disclosures, and operational reliability.',
    anchors: {
      1: 'Major integrity or compliance failures undermine the reliability of the evidence.',
      2: 'Material compliance deficiencies requiring major remediation.',
      3: 'Generally acceptable conduct with notable operational or documentation gaps.',
      4: 'Strong GCP compliance and appropriate governance and oversight.',
      5: 'Exceptional operational execution with comprehensive oversight and inspection readiness.',
    },
  },
];

/**
 * Weight check.
 */
export const TOTAL_DIMENSION_WEIGHT = DIMENSIONS.reduce(
  (total, dimension) => total + dimension.weight,
  0
);

if (Number(TOTAL_DIMENSION_WEIGHT.toFixed(2)) !== 1) {
  throw new Error(
    `FDA review rubric weights must sum to 1.0; got ${TOTAL_DIMENSION_WEIGHT}.`
  );
}

export const DIMENSION_IDS = DIMENSIONS.map((dimension) => dimension.id);

export const RUBRIC_VERSION = '2.0.0';


/**
 * Calculate a weighted 1–5 score from available dimension scores.
 */
export function weightedScore(criteria) {
  if (!Array.isArray(criteria)) {
    throw new TypeError('criteria must be an array.');
  }

  let total = 0;
  let weight = 0;

  for (const dimension of DIMENSIONS) {
    const found = criteria.find(
      (criterion) => criterion && criterion.id === dimension.id
    );

    if (!found || typeof found.score !== 'number') {
      continue;
    }

    if (found.score < 1 || found.score > 5) {
      throw new RangeError(
        `Score for "${dimension.id}" must be between 1 and 5.`
      );
    }

    total += found.score * dimension.weight;
    weight += dimension.weight;
  }

  return weight ? Number((total / weight).toFixed(2)) : null;
}


/**
 * Convert a 1–5 weighted score to an approximate percentage.
 *
 * This is a normalized rubric score, NOT an FDA approval probability.
 */
export function normalizedRubricScore(criteria) {
  const score = weightedScore(criteria);

  if (score === null) {
    return null;
  }

  return Number((((score - 1) / 4) * 100).toFixed(1));
}


/**
 * Render the scoring rubric for use in a system prompt or review prompt.
 */
export function renderRubric() {
  return DIMENSIONS.map((dimension) => {
    const anchors = Object.entries(dimension.anchors)
      .map(([score, text]) => `    ${score} — ${text}`)
      .join('\n');

    return [
      `## ${dimension.label} (id: ${dimension.id}, weight: ${dimension.weight})`,
      `What to assess: ${dimension.focus}`,
      'Score anchors:',
      anchors,
    ].join('\n');
  }).join('\n\n');
}


/**
 * Render the phase-specific dossier components for a prompt.
 */
export function renderPhaseDossierComponents(phase) {
  const normalizedPhase = normalizePhase(phase);
  const components = getPhaseDossierComponents(normalizedPhase);

  return components
    .map((domain) => {
      const componentText =
        domain.components.length > 0
          ? domain.components.map((item) => `- ${item}`).join('\n')
          : '- None for this phase';

      return [
        `## ${domain.domain}`,
        `Regulatory question: ${domain.regulatoryQuestion}`,
        'Signals:',
        domain.signalsToLookFor.map((item) => `- ${item}`).join('\n'),
        'Generate only:',
        componentText,
      ].join('\n');
    })
    .join('\n\n');
}


/**
 * Build a complete phase-restricted review instruction.
 *
 * The returned instruction explicitly prevents the reviewer from generating
 * components assigned exclusively to other development phases.
 */
export function buildPhaseReviewInstruction(phase) {
  const normalizedPhase = normalizePhase(phase);

  return [
    `FDA DEVELOPMENT PHASE: ${normalizedPhase}`,
    '',
    'Generate ONLY the review elements and dossier components assigned to this phase.',
    'Do not generate later-phase components.',
    'Do not infer missing phase-specific components from other phases.',
    '',
    renderPhaseDossierComponents(normalizedPhase),
  ].join('\n');
}


/**
 * Return the entire rubric as a machine-readable object.
 */
export function getFDAReviewRubric() {
  return {
    version: RUBRIC_VERSION,
    dimensions: DIMENSIONS,
    phases: FDA_PHASES,
    domains: FDA_REVIEW_DOMAINS,
  };
}
