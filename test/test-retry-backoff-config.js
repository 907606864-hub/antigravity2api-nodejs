import assert from 'assert';
import { __test_computeBackoffMs } from '../src/server/stream.js';

const fixedRandom = () => 0.5; // jitterFactor = 1.0

// Case 1: explicit delay uses upstream hint + safety buffer by default
{
  const wait = __test_computeBackoffMs(1, 300, {}, fixedRandom);
  assert.strictEqual(wait, 350);
}

// Case 2: configurable first retry minimum delay floor
{
  const wait = __test_computeBackoffMs(1, 300, { firstDelayMinMs: 3000, stepMinMs: 2000 }, fixedRandom);
  assert.strictEqual(wait, 3000);
}

// Case 3: configurable per-attempt incremental floor
{
  const wait = __test_computeBackoffMs(2, 300, { firstDelayMinMs: 3000, stepMinMs: 2000 }, fixedRandom);
  assert.strictEqual(wait, 5000);
}

// Case 4: no explicit delay still respects configured floors
{
  const wait = __test_computeBackoffMs(1, null, { firstDelayMinMs: 2000, stepMinMs: 1000 }, fixedRandom);
  assert.strictEqual(wait, 2000);
}

console.log('test-retry-backoff-config passed');
