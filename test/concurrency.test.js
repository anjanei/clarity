import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWithConcurrency } from '../src/utils/concurrency.js';

test('maps asynchronous work in input order without exceeding its concurrency ceiling', async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 8 - value));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [0, 10, 20, 30, 40]);
  assert.ok(peak <= 2);
  assert.ok(peak >= 2);
});

test('handles an empty worklist without invoking a mapper', async () => {
  const results = await mapWithConcurrency([], 4, () => {
    throw new Error('mapper should not run');
  });
  assert.deepEqual(results, []);
});
