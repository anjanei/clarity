import assert from 'node:assert/strict';
import test from 'node:test';

import { citationIndex, inferType, parseSources } from '../public/citations.js';

const index = citationIndex({
  evidence: {
    dossier: {
      domains: [
        {
          elements: [
            {
              citations: [
                {
                  title: 'Editing an α-globin enhancer in primary human hematopoietic stem cells',
                  identifier: 'PMC5583283',
                  url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5583283/',
                  sourceType: 'primary_literature',
                },
                {
                  title: 'CASGEVY approval package',
                  identifier: 'BLA 125785',
                  url: 'https://www.fda.gov/vaccines-blood-biologics/casgevy',
                  sourceType: 'regulatory_document',
                },
              ],
            },
          ],
        },
      ],
    },
  },
});

test('splits a compound source into one entry per cited document', () => {
  const sources = parseSources('Disease context section; PMC5583283; PMC12672394', index);
  assert.equal(sources.length, 3);
  assert.deepEqual(
    sources.map((s) => s.type),
    ['Internal', 'Literature', 'Literature'],
  );
});

test('prefers a resolved dossier title over reviewer shorthand', () => {
  const [source] = parseSources('PMC5583283', index);
  assert.match(source.title, /Editing an α-globin enhancer/);
  assert.equal(source.url, 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5583283/');
  assert.deepEqual(source.ids, ['PMC5583283']);
});

test('keeps the reviewer shorthand as a note when a dossier title replaces it', () => {
  const [source] = parseSources('FDA BLA 125785', index);
  assert.equal(source.title, 'CASGEVY approval package');
  assert.equal(source.note, 'FDA');
  assert.equal(source.type, 'FDA');
});

test('links unresolved identifiers to their canonical registry or archive', () => {
  const [registry] = parseSources('NCT06065189', new Map());
  assert.equal(registry.url, 'https://clinicaltrials.gov/study/NCT06065189');

  const [application] = parseSources('FDA Wainua review (NDA 217388)', new Map());
  assert.equal(application.title, 'Wainua review');
  assert.match(application.url, /ApplNo=217388$/);

  const [article] = parseSources('Jiang et al. (PMC13124466)', new Map());
  assert.equal(article.title, 'Jiang et al.');
  assert.equal(article.url, 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13124466/');

  const [paper] = parseSources('Smith 2024 doi:10.1056/NEJMoa2107454', new Map());
  assert.equal(paper.url, 'https://doi.org/10.1056/NEJMoa2107454');
});

test('expands an abbreviated run of registry ids into separate links', () => {
  const sources = parseSources(
    'Registry records NCT06024876/06065189/06291961/06328764',
    new Map(),
  );
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'Registry records');
  assert.deepEqual(sources[0].ids, [
    'NCT06024876',
    'NCT06065189',
    'NCT06291961',
    'NCT06328764',
  ]);
  // No stray "/06065189" fragments survive in the visible label.
  assert.doesNotMatch(sources[0].title, /\d/);
});

test('demotes retrieval-internal handles to metadata rather than links', () => {
  const [source] = parseSources('FDA CASGEVY TOC Review (fda_82fdd3d22eb1)', new Map());
  assert.equal(source.title, 'CASGEVY TOC Review');
  assert.equal(source.url, '');
  assert.deepEqual(source.ids, ['fda_82fdd3d22eb1']);
});

test('drops a type word the title repeats, but never empties the label', () => {
  // The pill already renders the type beside the title.
  const [repeated] = parseSources('FDA CASGEVY/ZYNTEGLO reviews', new Map());
  assert.equal(repeated.type, 'FDA');
  assert.equal(repeated.title, 'CASGEVY/ZYNTEGLO reviews');

  const [bare] = parseSources('FDA', new Map());
  assert.equal(bare.title, 'FDA');
});

test('labels bundle provenance as internal instead of implying a public source', () => {
  assert.equal(inferType('Inferred from modality knowledge'), 'Internal');
  assert.equal(inferType("Acute Safety section — 'Not found in public sources'"), 'Internal');
  assert.equal(inferType('Trial Design information gaps'), 'Internal');
  assert.equal(inferType('FDA CASGEVY pharm/tox review'), 'FDA');
});

test('rejects a non-https citation url', () => {
  const [source] = parseSources('Example', citationIndex({}));
  assert.equal(source.url, '');
});

test('tolerates an empty or missing source string', () => {
  assert.deepEqual(parseSources('', new Map()), []);
  assert.deepEqual(parseSources(undefined, new Map()), []);
});
