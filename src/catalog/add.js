/**
 * Add specific trials to the catalog by registry id, without a full sweep.
 *
 *   npm run catalog:add -- NCT03655678
 *   npm run catalog:add -- NCT03655678 NCT05123456 --force
 *
 * Registry-backed fields (sponsor, phase, start date, conditions, title,
 * interventions, status) come from the ClinicalTrials.gov v2 API — authoritative
 * and free. Modality and therapeutic area are not registry fields, so those come
 * from one cheap Claude classification over the registry record, matching how the
 * sweep in build.js assigns them.
 *
 * NCT ids only: the other registries have no equivalent free API, so a
 * non-NCT id here would produce a record with nothing but its own identifier.
 */

import { structuredCall } from '../anthropic.js';
import { classifySchema } from '../evaluate/schema.js';
import { config, requireKeys } from '../config.js';
import { enrichFromRegistry } from './enrich.js';
import { loadCatalog, saveCatalog } from './store.js';

const NCT_ID = /^NCT\d{8}$/i;

const CLASSIFY_SYSTEM = `You classify a clinical trial record into a therapeutic modality and a broad
therapeutic area, given its title, conditions, and investigational interventions.

- Choose the modality of the investigational product, not of any comparator or supportive care.
- An autologous or allogeneic cell product that has been gene-edited ex vivo is "Cell therapy".
  Reserve "Gene therapy" for in vivo vector-delivered gene transfer.
- Use "Unknown" only when the record genuinely does not indicate the modality.
- therapeuticArea is one broad area in title case, not a restatement of the indication.`;

function parseArgs(argv) {
  const ids = [];
  let force = false;
  for (const arg of argv) {
    if (arg === '--force') force = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`);
    else ids.push(arg.toUpperCase());
  }
  return { ids, force };
}

function seedRecord(trialId) {
  return {
    trialId,
    therapeuticName: '',
    sponsor: 'Unknown',
    phase: 'Unknown',
    startDate: 'Unknown',
    registry: 'ClinicalTrials.gov',
    condition: '',
    modality: 'Unknown',
    title: '',
    therapeuticArea: '',
  };
}

async function classify(trial) {
  const { data } = await structuredCall({
    system: CLASSIFY_SYSTEM,
    userContent: [
      `Trial: ${trial.trialId}`,
      `Title: ${trial.title}`,
      `Conditions: ${trial.condition || '(none stated)'}`,
      `Investigational interventions: ${(trial.registryProducts || []).join(', ') || '(none stated)'}`,
      `Sponsor: ${trial.sponsor}`,
    ].join('\n'),
    schema: classifySchema,
    effort: config.anthropic.extractEffort,
    maxTokens: 2000,
    useFallbacks: false,
  });
  return data;
}

async function main() {
  const { ids, force } = parseArgs(process.argv.slice(2));
  if (!ids.length) {
    throw new Error('Usage: npm run catalog:add -- NCT03655678 [NCT…] [--force]');
  }

  const invalid = ids.filter((id) => !NCT_ID.test(id));
  if (invalid.length) {
    throw new Error(
      `Not NCT ids: ${invalid.join(', ')}. Only ClinicalTrials.gov ids can be added this way — ` +
        'other registries have no batch API to populate sponsor/phase/start date.',
    );
  }

  requireKeys('anthropic');

  const catalog = (await loadCatalog()) ?? {
    generatedAt: new Date().toISOString(),
    generator: { note: 'created by catalog:add' },
    sources: [],
    retrievalFailures: [],
    enrichment: null,
    trials: [],
  };

  const existing = new Map(catalog.trials.map((t) => [t.trialId.toUpperCase(), t]));
  const wanted = ids.filter((id) => {
    if (existing.has(id) && !force) {
      console.log(`  = ${id} already in catalog (use --force to refresh)`);
      return false;
    }
    return true;
  });

  if (!wanted.length) {
    console.log('\nNothing to do.');
    return;
  }

  console.log(`\nFetching ${wanted.length} record(s) from ClinicalTrials.gov…`);
  const { trials: enriched, stats } = await enrichFromRegistry(wanted.map(seedRecord));

  const notFound = enriched.filter((t) => !t.registryEnriched).map((t) => t.trialId);
  if (notFound.length) console.log(`  ! not found in the registry: ${notFound.join(', ')}`);
  if (stats.droppedObservational) {
    console.log(`  ! ${stats.droppedObservational} dropped as non-interventional`);
  }
  for (const f of stats.failures) console.log(`  ! ${f.batch}: ${f.error}`);

  const added = [];
  for (const trial of enriched) {
    if (!trial.registryEnriched) continue;

    // The registry names the product; fall back to the study title if it doesn't.
    if (!trial.therapeuticName) {
      trial.therapeuticName = trial.registryProducts?.[0] || trial.title || trial.trialId;
    }

    console.log(`\n  ${trial.trialId}  ${trial.therapeuticName}`);
    console.log(`    ${trial.sponsor} · ${trial.phase} · start ${trial.startDate} · ${trial.overallStatus}`);

    const classified = await classify(trial);
    trial.modality = classified.modality;
    trial.therapeuticArea = classified.therapeuticArea;
    trial.addedManuallyAt = new Date().toISOString();
    console.log(`    classified: ${trial.modality} · ${trial.therapeuticArea}`);

    existing.set(trial.trialId.toUpperCase(), trial);
    added.push(trial);
  }

  if (!added.length) {
    console.log('\nNo records added.');
    return;
  }

  catalog.trials = [...existing.values()].sort((a, b) =>
    a.therapeuticName.localeCompare(b.therapeuticName),
  );
  catalog.manualAdditions = [
    ...(catalog.manualAdditions || []).filter((m) => !added.some((t) => t.trialId === m.trialId)),
    ...added.map((t) => ({ trialId: t.trialId, addedAt: t.addedManuallyAt })),
  ];

  await saveCatalog(catalog);
  console.log(`\nAdded ${added.length} trial(s). Catalog now holds ${catalog.trials.length}.`);
}

main().catch((err) => {
  console.error(`\ncatalog:add failed: ${err.message}`);
  process.exitCode = 1;
});
