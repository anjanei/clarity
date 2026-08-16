import 'dotenv/config';
import { getTrial } from '../catalog/store.js';
import { runEvaluation } from '../evaluate/store.js';

function usage() {
  return [
    'Usage: npm run review -- <NCT_ID> [--force] [--trace=metadata|full]',
    '',
    'Runs the full FDA review locally and writes data/evaluations/<NCT_ID>.json.',
    'Use this for reviews that are too long for a public serverless deployment.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { trialId: '', force: false, traceMode: undefined };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg.startsWith('--trace=')) args.traceMode = arg.slice('--trace='.length);
    else if (!args.trialId) args.trialId = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!args.trialId || args.trialId === '--help' || args.trialId === '-h') {
    throw Object.assign(new Error(usage()), { showUsage: true });
  }
  if (args.traceMode && !['metadata', 'full'].includes(args.traceMode)) {
    throw new Error('--trace must be metadata or full.');
  }
  return args;
}

function tag(step) {
  const text = `${step.stage || ''} ${step.message || ''}`;
  if (/evidence|paperclip|retriev/i.test(text)) return 'paperclip';
  if (/dossier|review|scor/i.test(text)) return 'claude';
  return 'sys';
}

try {
  const { trialId, force, traceMode } = parseArgs(process.argv.slice(2));
  const trial = await getTrial(trialId);
  if (!trial) throw new Error(`Unknown trial id: ${trialId}`);

  console.log(`Reviewing ${trial.therapeuticName} (${trial.trialId})`);
  if (traceMode) console.log(`Trace mode: ${traceMode}`);

  const started = Date.now();
  const evaluation = await runEvaluation(trial, {
    force,
    traceMode,
    onStep: (step) => {
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`[${elapsed}s] ${tag(step)}: ${step.message || step.stage}`);
    },
  });

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  const point = evaluation.review?.probabilityOfTrialSuccess?.pointEstimate;
  console.log(`Done in ${minutes} min. Cached review written for ${trial.trialId}.`);
  if (point != null) console.log(`Probability of trial success: ${point}%`);
} catch (err) {
  console.error(err.showUsage ? err.message : `Review failed: ${err.message}`);
  process.exit(1);
}
