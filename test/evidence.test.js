import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  EVIDENCE_DOMAINS,
  activeDomainsForPhase,
  inactiveDomainsForPhase,
  normalizeClarityPhase,
} from '../src/evidence/domains.js';
import {
  canonicalSourceUrl,
  normalizeDomainDossier,
  renderEvidenceDossier,
} from '../src/evidence/dossier.js';

test('maps catalog phases to the CLARITY phase gates', () => {
  assert.equal(normalizeClarityPhase('Early Phase 1'), 'phase1');
  assert.equal(normalizeClarityPhase('phase1'), 'phase1');
  assert.equal(normalizeClarityPhase('Phase 1/2'), 'phase1');
  assert.equal(normalizeClarityPhase('Phase 2/3'), 'phase2');
  assert.equal(normalizeClarityPhase('Phase 4'), null);

  assert.deepEqual(
    activeDomainsForPhase('Phase 2').map(({ id }) => id),
    [
      'disease_context_mechanism',
      'trial_design',
      'acute_safety_tolerability',
      'long_term_genetic_risk',
      'biodistribution_pharmacology',
      'immunogenicity_special_populations',
      'product_quality_cmc',
      'trial_integrity_governance',
    ],
  );
  assert.deepEqual(inactiveDomainsForPhase('Phase 2').map(({ id }) => id), ['benefit_risk_postmarketing']);
  assert.equal(activeDomainsForPhase('phase1').length, 7);
});

test('ships a CLARITY policy file for every executable domain', async () => {
  await Promise.all(EVIDENCE_DOMAINS.map(({ skillFile }) => fs.access(skillFile)));
});

test('requires direct, canonical citations in normalized evidence content', () => {
  const domain = EVIDENCE_DOMAINS.find(({ id }) => id === 'disease_context_mechanism');
  const dossier = normalizeDomainDossier(
    {
      summary: 'A source-backed mechanism is available.',
      elements: [
        {
          element: 'Mechanism of action',
          finding: 'The article reports target engagement.',
          confidenceScore: 84,
          rationale: 'Direct program-specific primary evidence.',
          citations: [
            {
              title: 'Primary VEC-201 report',
              identifier: 'PMC1234567',
              url: '',
              sourceType: 'primary_literature',
            },
          ],
        },
        {
          element: 'Literature review',
          finding: 'Unsupported claim.',
          confidenceScore: 90,
          rationale: 'No source was supplied.',
          citations: [],
        },
      ],
      informationGaps: ['No long-term follow-up publication was located.'],
    },
    domain,
    'Phase 2',
  );

  const mechanism = dossier.elements.find(({ element }) => element === 'Mechanism of action');
  assert.equal(mechanism.citations[0].url, 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/');
  assert.equal(mechanism.confidenceScore, 84);

  const unsupported = dossier.elements.find(({ element }) => element === 'Literature review');
  assert.equal(unsupported.finding, 'Not found in public sources');
  assert.deepEqual(unsupported.citations, []);
  assert.equal(unsupported.confidenceScore, 10);

  assert.equal(canonicalSourceUrl('NCT01234567'), 'https://clinicaltrials.gov/study/NCT01234567');
  assert.equal(canonicalSourceUrl('doi:10.1000/example.1'), 'https://doi.org/10.1000/example.1');
});

test('renders cited domain content without adding a rubric score', () => {
  const rendered = renderEvidenceDossier({
    phase: 'phase1',
    domains: [
      {
        domainId: 'disease_context_mechanism',
        domainLabel: 'Disease Context & Mechanism',
        status: 'evaluated',
        summary: 'One source-backed finding.',
        elements: [
          {
            element: 'Mechanism of action',
            finding: 'Target engagement was reported.',
            confidenceScore: 70,
            rationale: 'One direct source.',
            citations: [{ title: 'Study', identifier: 'NCT01234567', url: 'https://clinicaltrials.gov/study/NCT01234567' }],
          },
        ],
        informationGaps: [],
      },
      {
        domainId: 'benefit_risk_postmarketing',
        domainLabel: 'Benefit–Risk & Postmarketing Controls',
        status: 'not_applicable',
        summary: 'Do not generate',
        elements: [],
        informationGaps: [],
      },
    ],
  });

  assert.match(rendered, /https:\/\/clinicaltrials\.gov\/study\/NCT01234567/);
  assert.match(rendered, /Do not generate/);
  assert.doesNotMatch(rendered, /rubric score/i);
});
