import fs from 'node:fs/promises';
import { paths } from '../config.js';

let cache = null;
let cacheMtime = 0;

/** Read the persisted catalog, re-reading only when the file changes on disk. */
export async function loadCatalog() {
  let stat;
  try {
    stat = await fs.stat(paths.catalog);
  } catch {
    return null;
  }
  if (cache && stat.mtimeMs === cacheMtime) return cache;

  const raw = await fs.readFile(paths.catalog, 'utf8');
  cache = JSON.parse(raw);
  cacheMtime = stat.mtimeMs;
  return cache;
}

export async function saveCatalog(catalog) {
  await fs.mkdir(paths.data, { recursive: true });
  await fs.writeFile(paths.catalog, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  cache = null;
  cacheMtime = 0;
}

export async function getTrial(trialId) {
  const catalog = await loadCatalog();
  if (!catalog) return null;
  const wanted = String(trialId).toLowerCase();
  return catalog.trials.find((t) => t.trialId.toLowerCase() === wanted) ?? null;
}

/** Sort key: newest start date first, unknown dates last. */
function startDateKey(trial) {
  const raw = trial.startDate || '';
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(raw);
  if (!match) return '0000-00-00';
  const [, y, m = '00', d = '00'] = match;
  return `${y}-${m}-${d}`;
}

export function filterTrials(trials, { q, phase, sponsor, area, registry } = {}) {
  let result = trials;

  if (q) {
    const needle = q.toLowerCase();
    result = result.filter((t) =>
      [t.therapeuticName, t.sponsor, t.condition, t.trialId, t.title, t.therapeuticArea, t.modality]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(needle)),
    );
  }
  if (phase) result = result.filter((t) => t.phase === phase);
  if (sponsor) result = result.filter((t) => t.sponsor === sponsor);
  if (area) result = result.filter((t) => t.therapeuticArea === area);
  if (registry) result = result.filter((t) => t.registry === registry);

  return [...result].sort((a, b) => startDateKey(b).localeCompare(startDateKey(a)));
}

/** Distinct values for the frontend filter controls. */
export function facets(trials) {
  const collect = (key) =>
    [...new Set(trials.map((t) => t[key]).filter((v) => v && v !== 'Unknown'))].sort();
  return {
    phases: collect('phase'),
    sponsors: collect('sponsor'),
    areas: collect('therapeuticArea'),
    registries: collect('registry'),
    modalities: collect('modality'),
  };
}
