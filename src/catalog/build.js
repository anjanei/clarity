/**
 * One-time (re-runnable) ingest.
 *
 *   Paperclip trial-registry + FDA search  ->  Claude structured extraction  ->  data/trials.json
 *
 * The registries come back as prose/snippet text rather than typed rows, so the
 * normalisation into clinicalTrialObjects is done by Claude under a strict
 * schema. Run with `npm run catalog`. Existing entries are preserved and merged
 * unless --replace is passed.
 *
 *   npm run catalog -- --limit 60 --replace
 */

import { structuredCall } from '../anthropic.js';
import { CATALOG_QUERIES, fetchCatalogRaw } from '../paperclip/queries.js';
import { catalogSchema, PHASES } from '../evaluate/schema.js';
import { config, requireKeys } from '../config.js';
import { loadCatalog, saveCatalog } from './store.js';
import { enrichFromRegistry } from './enrich.js';
import { checkConnection } from '../paperclip/tools.js';

const EXTRACTION_SYSTEM = `You normalise clinical trial registry text into structured records.

Rules:
- Extract only trials that are actually present in the text. Never invent a record, a registry
  identifier, a sponsor, or a date.
- One record per distinct registry identifier. If the same trial appears twice, emit it once.
- therapeuticName is the investigational product, not the disease and not the sponsor.
- Registry identifiers must be copied verbatim, including prefix and punctuation.
- Skip observational studies, registries, surveys, and retrospective chart reviews: this catalog
  covers interventional trials of therapeutics only.
- Skip any record where you cannot read a registry identifier directly from the text.
- Use "Unknown" for a required field that the text genuinely does not state, and an empty string
  for an optional one. Do not guess a phase from the study title alone unless it is stated.`;

function parseArgs(argv) {
  const args = { limit: 40, replace: false, enrich: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replace') args.replace = true;
    else if (arg === '--no-enrich') args.enrich = false;
    else if (arg === '--limit') args.limit = Number(argv[++i]) || args.limit;
  }
  return args;
}

const VALID_PHASES = new Set(PHASES);

function isPlausible(trial) {
  if (!trial?.trialId || !trial?.therapeuticName) return false;
  // Registry IDs always carry a digit; prose fragments generally do not.
  if (!/\d/.test(trial.trialId)) return false;
  if (trial.therapeuticName.length > 120) return false;
  return true;
}

function normalize(trial, area) {
  return {
    trialId: trial.trialId.trim(),
    therapeuticName: trial.therapeuticName.trim(),
    sponsor: (trial.sponsor || 'Unknown').trim(),
    phase: VALID_PHASES.has(trial.phase) ? trial.phase : 'Unknown',
    startDate: (trial.startDate || 'Unknown').trim(),
    registry: trial.registry || 'Unknown',
    condition: (trial.condition || '').trim(),
    modality: trial.modality || 'Unknown',
    title: (trial.title || '').trim(),
    therapeuticArea: (trial.therapeuticArea || area || '').trim(),
  };
}

async function extract(record, { effort }) {
  const userContent = [
    `Therapeutic area sweep: ${record.area}`,
    `Paperclip source: ${record.source}`,
    `Query: ${record.query}`,
    '',
    'Registry text:',
    '',
    record.text,
  ].join('\n');

  const { data } = await structuredCall({
    system: EXTRACTION_SYSTEM,
    userContent,
    schema: catalogSchema,
    effort,
    maxTokens: 16000,
    // Extraction is mechanical; a decline here should surface, not reroute.
    useFallbacks: false,
  });
  return data.trials || [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireKeys('paperclip', 'anthropic');

  console.log(`Paperclip: ${config.paperclip.mcpUrl}`);
  const connection = await checkConnection();
  console.log(`Driving the CLI through the "${connection.toolName}" MCP tool.`);

  console.log(`\nSweeping ${CATALOG_QUERIES.length} areas at limit ${args.limit}…`);
  const records = await fetchCatalogRaw({
    limit: args.limit,
    onStep: ({ area, source }) => console.log(`  search  ${area} · ${source}`),
  });

  const usable = records.filter((r) => r.text);
  const failed = records.filter((r) => r.error);
  console.log(`\n${usable.length} searches returned text, ${failed.length} failed.`);
  for (const f of failed) console.log(`  ! ${f.area} · ${f.source}: ${f.error}`);

  if (!usable.length) {
    throw new Error(
      'No searches returned text. Verify PAPERCLIP_API_KEY and run `npm run probe` to inspect the tool list.',
    );
  }

  console.log(`\nExtracting structured records (effort: ${config.anthropic.extractEffort})…`);
  const byId = new Map();

  if (!args.replace) {
    const existing = await loadCatalog();
    for (const trial of existing?.trials || []) byId.set(trial.trialId.toLowerCase(), trial);
    if (existing) console.log(`  merging into ${byId.size} existing records`);
  }

  let extracted = 0;
  let skipped = 0;

  for (const record of usable) {
    try {
      const trials = await extract(record, { effort: config.anthropic.extractEffort });
      let added = 0;
      for (const raw of trials) {
        if (!isPlausible(raw)) {
          skipped += 1;
          continue;
        }
        const trial = normalize(raw, record.area);
        const key = trial.trialId.toLowerCase();
        // Prefer the richer record when the same trial shows up twice.
        const prior = byId.get(key);
        if (!prior || score(trial) > score(prior)) byId.set(key, trial);
        added += 1;
      }
      extracted += added;
      console.log(`  extract ${record.area} · ${record.source}: ${added} trials`);
    } catch (err) {
      console.log(`  ! extract ${record.area} · ${record.source}: ${err.message}`);
    }
  }

  let trials = [...byId.values()];
  let enrichment = null;

  // Sponsor / phase / start date are not in Paperclip's trial corpus — fill them
  // from the authoritative registry rather than leaving required fields empty.
  if (args.enrich) {
    console.log('\nEnriching sponsor / phase / start date from ClinicalTrials.gov…');
    const result = await enrichFromRegistry(trials, {
      onStep: ({ from, to, total }) => console.log(`  registry ${from}-${to} of ${total}`),
    });
    trials = result.trials;
    enrichment = result.stats;
    console.log(
      `  matched ${enrichment.matched}/${enrichment.eligible} NCT records · ` +
        `${enrichment.notNct} non-NCT skipped · ` +
        `${enrichment.droppedObservational} observational dropped`,
    );
    for (const f of enrichment.failures) console.log(`  ! batch ${f.batch}: ${f.error}`);
  }

  trials.sort((a, b) => a.therapeuticName.localeCompare(b.therapeuticName));

  const catalog = {
    generatedAt: new Date().toISOString(),
    generator: {
      model: config.anthropic.model,
      extractEffort: config.anthropic.extractEffort,
      paperclipUrl: config.paperclip.mcpUrl,
      searchLimit: args.limit,
    },
    sources: usable.map(({ area, source, query, command }) => ({ area, source, query, command })),
    retrievalFailures: failed.map(({ area, source, error }) => ({ area, source, error })),
    enrichment,
    trials,
  };

  await saveCatalog(catalog);

  const complete = trials.filter(
    (t) => t.sponsor !== 'Unknown' && t.phase !== 'Unknown' && t.startDate !== 'Unknown',
  ).length;
  console.log(
    `\nWrote ${trials.length} trials to data/trials.json ` +
      `(${extracted} extracted this run, ${skipped} rejected as implausible).`,
  );
  console.log(
    `${complete} of ${trials.length} have all five required fields populated ` +
      `(${Math.round((100 * complete) / Math.max(trials.length, 1))}%).`,
  );
}

/** Completeness heuristic for dedupe: more known fields wins. */
function score(trial) {
  return [trial.sponsor, trial.phase, trial.startDate, trial.condition, trial.modality, trial.title]
    .filter((v) => v && v !== 'Unknown')
    .length;
}

main().catch((err) => {
  console.error(`\nCatalog build failed: ${err.message}`);
  process.exitCode = 1;
});
