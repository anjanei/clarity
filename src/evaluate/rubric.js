/**
 * The review rubric. Each dimension is scored 1–5 against the anchors below and
 * carries a weight used to sanity-check the overall probability. Weights sum to 1.
 */
export const DIMENSIONS = [
  {
    id: 'efficacy_clinical_evidence',
    label: 'Efficacy & clinical evidence',
    weight: 0.26,
    focus:
      'Endpoint selection and clinical meaningfulness, observed effect size versus control, ' +
      'statistical power and multiplicity control, biomarker/patient-selection strategy, ' +
      'consistency across cohorts and studies, and whether the evidence would support a ' +
      'substantial-evidence-of-effectiveness finding.',
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
    label: 'Safety & tolerability',
    weight: 0.22,
    focus:
      'Serious adverse event rates and causality, dose-limiting toxicities, deaths, ' +
      'discontinuation rates, organ-system signals, class effects, black-box risk, ' +
      'adequacy of monitoring and mitigation, and the benefit–risk balance for the intended population.',
    anchors: {
      1: 'Unacceptable toxicity or unexplained deaths; benefit–risk clearly unfavourable.',
      2: 'Serious signals requiring major mitigation or population restriction.',
      3: 'Manageable toxicity typical of the class, with gaps in characterisation.',
      4: 'Well-characterised, manageable safety profile with adequate monitoring.',
      5: 'Clean, thoroughly characterised profile with favourable benefit–risk.',
    },
  },
  {
    id: 'immunogenicity',
    label: 'Immunogenicity',
    weight: 0.14,
    focus:
      'Anti-drug antibody incidence and titre, neutralising antibody fraction, impact on ' +
      'exposure, efficacy and safety (including hypersensitivity and infusion reactions), ' +
      'adequacy and validation of the ADA assay strategy and tiered testing, and risk ' +
      'inherent to the modality (mAb, fusion protein, AAV capsid, cell product, peptide).',
    anchors: {
      1: 'High-titre neutralising ADA that abolishes exposure or efficacy, or severe hypersensitivity.',
      2: 'Clinically consequential ADA with inadequate assessment or mitigation.',
      3: 'Detectable ADA of unclear clinical consequence; assay strategy partially characterised.',
      4: 'Low or clinically inconsequential ADA with an adequate validated assay strategy.',
      5: 'Negligible immunogenicity, thoroughly characterised with validated tiered assays.',
    },
  },
  {
    id: 'manufacturability',
    label: 'Manufacturability & CMC',
    weight: 0.14,
    focus:
      'Process definition and control strategy, comparability across scales and sites, ' +
      'potency and identity assays, critical quality attributes, stability and shelf life, ' +
      'formulation and delivery, batch failure and cold-chain risk, raw-material and vector/cell ' +
      'supply constraints, and readiness for commercial-scale validation.',
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
    label: 'PK/PD & dosing',
    weight: 0.13,
    focus:
      'Pharmacokinetic characterisation, exposure–response for efficacy and safety, ' +
      'justification of the selected dose and regimen, target engagement, half-life and ' +
      'accumulation, drug–drug interaction and food effects, special populations ' +
      '(renal/hepatic impairment, paediatric, elderly), and dose-modification guidance.',
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
    label: 'Trial design & regulatory strategy',
    weight: 0.11,
    focus:
      'Control arm and blinding, randomisation and bias control, enrolment feasibility and ' +
      'accrual risk, site and geographic distribution and applicability to the US population, ' +
      'statistical analysis plan and interim strategy, precedent from comparable FDA approvals ' +
      'and complete-response letters, and eligibility for expedited pathways ' +
      '(Fast Track, Breakthrough, Accelerated Approval, RMAT, Priority Review).',
    anchors: {
      1: 'Design cannot support a regulatory conclusion; enrolment or comparator infeasible.',
      2: 'Serious design weaknesses (inappropriate comparator, unblinded subjective endpoint).',
      3: 'Acceptable design with notable feasibility or interpretability risks.',
      4: 'Well-designed and feasible trial aligned with regulatory precedent.',
      5: 'Exemplary design with clear precedent and a credible expedited-pathway case.',
    },
  },
];

export const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);

export const RUBRIC_VERSION = '1.0.0';

/** Weighted mean of 1–5 scores, used to cross-check Claude's probability. */
export function weightedScore(criteria) {
  let total = 0;
  let weight = 0;
  for (const dimension of DIMENSIONS) {
    const found = criteria.find((c) => c.id === dimension.id);
    if (!found || typeof found.score !== 'number') continue;
    total += found.score * dimension.weight;
    weight += dimension.weight;
  }
  return weight ? Number((total / weight).toFixed(2)) : null;
}

/** The rubric rendered for the system prompt — stable text, so it caches. */
export function renderRubric() {
  return DIMENSIONS.map((dimension) => {
    const anchors = Object.entries(dimension.anchors)
      .map(([score, text]) => `    ${score} — ${text}`)
      .join('\n');
    return [
      `## ${dimension.label}  (id: ${dimension.id}, weight: ${dimension.weight})`,
      `What to assess: ${dimension.focus}`,
      'Score anchors:',
      anchors,
    ].join('\n');
  }).join('\n\n');
}
