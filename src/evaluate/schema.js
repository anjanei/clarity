import { DIMENSION_IDS } from './rubric.js';

/**
 * JSON Schemas for structured outputs. Constraints the API does not support
 * (minimum/maximum, minLength, minItems) are deliberately absent — bounds are
 * stated in `description` instead, and validated in JS after the call.
 */

export const PHASES = [
  'Early Phase 1',
  'Phase 1',
  'Phase 1/2',
  'Phase 2',
  'Phase 2/3',
  'Phase 3',
  'Phase 4',
  'Not Applicable',
  'Unknown',
];

const EVIDENCE_STRENGTH = ['strong', 'moderate', 'weak', 'absent'];

export const MODALITIES = [
  'Small molecule',
  'Monoclonal antibody',
  'Antibody-drug conjugate',
  'Bispecific / multispecific',
  'Protein / peptide',
  'Vaccine',
  'Cell therapy',
  'Gene therapy',
  'Oligonucleotide / RNA',
  'Other',
  'Unknown',
];

export const REGISTRIES = [
  'ClinicalTrials.gov',
  'EudraCT/CTIS',
  'ISRCTN',
  'ChiCTR',
  'jRCT/UMIN',
  'Other',
  'Unknown',
];

/** Modality + area for a trial we already have authoritative registry fields for. */
export const classifySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['modality', 'therapeuticArea'],
  properties: {
    modality: { type: 'string', enum: MODALITIES },
    therapeuticArea: {
      type: 'string',
      description:
        'Broad therapeutic area in title case, e.g. Oncology, Neurology, Rare & Genetic Disease, ' +
        'Cardiometabolic, Immunology & Inflammation, Infectious Disease & Vaccines, Hematology, Ophthalmology.',
    },
  },
};

export const catalogSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['trials'],
  properties: {
    trials: {
      type: 'array',
      description:
        'One entry per distinct clinical trial found in the source text. Do not invent trials; ' +
        'omit any record whose registry identifier you cannot read directly from the text.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['trialId', 'therapeuticName', 'sponsor', 'phase', 'startDate', 'registry'],
        properties: {
          trialId: {
            type: 'string',
            description:
              'Registry identifier exactly as written, e.g. NCT05123456, EUCTR2021-001234-56, ' +
              'ChiCTR2200012345, jRCT2031200123, ISRCTN12345678.',
          },
          therapeuticName: {
            type: 'string',
            description:
              'The investigational therapeutic under study (INN, code name, or brand). Not the disease. ' +
              'If several agents are studied, name the primary investigational product.',
          },
          sponsor: { type: 'string', description: 'Lead sponsor organisation. Use "Unknown" if absent.' },
          phase: { type: 'string', enum: PHASES },
          startDate: {
            type: 'string',
            description: 'Study start date as YYYY-MM-DD, or YYYY-MM / YYYY if only that precision is stated, or "Unknown".',
          },
          registry: { type: 'string', enum: REGISTRIES },
          condition: { type: 'string', description: 'Primary indication or condition studied. Empty string if absent.' },
          modality: { type: 'string', enum: MODALITIES },
          title: { type: 'string', description: 'Study title, trimmed. Empty string if absent.' },
          therapeuticArea: { type: 'string', description: 'Broad therapeutic area, e.g. Oncology. Empty string if unclear.' },
        },
      },
    },
  },
};

const criterionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'score',
    'evidenceStrength',
    'assessment',
    'supportingFindings',
    'concerns',
    'informationGaps',
  ],
  properties: {
    id: { type: 'string', enum: DIMENSION_IDS },
    score: {
      type: 'integer',
      description: 'Integer 1–5 against this dimension\'s anchors. Never above 3 when evidenceStrength is "absent".',
    },
    evidenceStrength: {
      type: 'string',
      enum: EVIDENCE_STRENGTH,
      description: 'How well the supplied evidence actually characterises this dimension.',
    },
    assessment: {
      type: 'string',
      description: 'Two to five sentences in the voice of an FDA reviewer, stating the finding and its regulatory consequence.',
    },
    supportingFindings: {
      type: 'array',
      description: 'Concrete findings that raised the score. Include numbers with units where the evidence gives them.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['finding', 'source'],
        properties: {
          finding: { type: 'string' },
          source: {
            type: 'string',
            description: 'Which evidence section, paper, registry record, or FDA document this came from. "Inferred" if not directly cited.',
          },
        },
      },
    },
    concerns: {
      type: 'array',
      description: 'Deficiencies a reviewer would raise, most material first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['concern', 'severity'],
        properties: {
          concern: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          source: { type: 'string', description: 'Evidence basis, or "Inferred" where this is a reasoned expectation.' },
        },
      },
    },
    informationGaps: {
      type: 'array',
      description: 'What the submitted evidence does not tell you and would need to.',
      items: { type: 'string' },
    },
  },
};

export const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'therapeuticName',
    'trialId',
    'reviewerSummary',
    'probabilityOfTrialSuccess',
    'confidence',
    'criteria',
    'keyDrivers',
    'redFlags',
    'deRiskingActions',
    'regulatoryPrecedents',
    'expeditedPathways',
    'evidenceQuality',
  ],
  properties: {
    therapeuticName: { type: 'string' },
    trialId: { type: 'string' },
    reviewerSummary: {
      type: 'string',
      description:
        'A single-paragraph reviewer memo (roughly 100–180 words): what this program is, the ' +
        'central question, and where it currently stands. Lead with the conclusion.',
    },
    probabilityOfTrialSuccess: {
      type: 'object',
      additionalProperties: false,
      required: ['pointEstimate', 'low', 'high', 'basis'],
      properties: {
        pointEstimate: {
          type: 'integer',
          description:
            'Probability (0–100) that this program successfully completes its clinical trial program ' +
            'to the point of supporting an approvable submission. Anchor on historical phase-transition ' +
            'base rates for this phase, modality and therapeutic area, then adjust for the evidence.',
        },
        low: { type: 'integer', description: 'Lower bound of the plausible range, 0–100. Must be below pointEstimate.' },
        high: { type: 'integer', description: 'Upper bound of the plausible range, 0–100. Must be above pointEstimate.' },
        basis: {
          type: 'string',
          description:
            'State the base rate you anchored on (with the phase/modality/area it applies to) and each ' +
            'adjustment you made away from it, with direction and rough magnitude.',
        },
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'rationale'],
      properties: {
        level: { type: 'string', enum: ['low', 'moderate', 'high'] },
        rationale: {
          type: 'string',
          description: 'Why this confidence level, framed in terms of evidence coverage rather than program quality.',
        },
      },
    },
    criteria: {
      type: 'array',
      description: 'Exactly one entry per rubric dimension, in the order the rubric lists them.',
      items: criterionSchema,
    },
    keyDrivers: {
      type: 'array',
      description: 'The few factors doing the most work in the probability estimate, positive or negative.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['driver', 'direction', 'weight'],
        properties: {
          driver: { type: 'string' },
          direction: { type: 'string', enum: ['increases', 'decreases'] },
          weight: { type: 'string', enum: ['high', 'moderate', 'low'] },
        },
      },
    },
    redFlags: {
      type: 'array',
      description: 'Issues that could stop this program outright. Empty array if there are none.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['flag', 'why'],
        properties: {
          flag: { type: 'string' },
          why: { type: 'string', description: 'The regulatory consequence, not just the observation.' },
        },
      },
    },
    deRiskingActions: {
      type: 'array',
      description: 'Specific, actionable steps the sponsor could take before the next regulatory interaction.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'addresses', 'priority'],
        properties: {
          action: { type: 'string' },
          addresses: { type: 'string', enum: DIMENSION_IDS },
          priority: { type: 'string', enum: ['immediate', 'near-term', 'later'] },
        },
      },
    },
    regulatoryPrecedents: {
      type: 'array',
      description: 'Comparable FDA decisions (approvals, CRLs, withdrawals) that inform this assessment.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product', 'relevance'],
        properties: {
          product: { type: 'string' },
          outcome: { type: 'string', description: 'e.g. "Approved 2021 (accelerated)", "CRL 2019 (CMC)".' },
          relevance: { type: 'string' },
        },
      },
    },
    expeditedPathways: {
      type: 'array',
      description: 'Expedited programs this therapeutic may plausibly qualify for. Empty array if none apply.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pathway', 'eligibility', 'rationale'],
        properties: {
          pathway: {
            type: 'string',
            enum: [
              'Fast Track',
              'Breakthrough Therapy',
              'Accelerated Approval',
              'Priority Review',
              'RMAT',
              'Orphan Drug',
              'Qualified Infectious Disease Product',
            ],
          },
          eligibility: { type: 'string', enum: ['likely', 'possible', 'unlikely'] },
          rationale: { type: 'string' },
        },
      },
    },
    evidenceQuality: {
      type: 'object',
      additionalProperties: false,
      required: ['overall', 'notes'],
      properties: {
        overall: { type: 'string', enum: EVIDENCE_STRENGTH },
        notes: {
          type: 'string',
          description:
            'What the retrieved evidence covered well and what it did not. Be explicit where a score ' +
            'rests on modality-class expectation rather than program-specific data.',
        },
      },
    },
  },
};
