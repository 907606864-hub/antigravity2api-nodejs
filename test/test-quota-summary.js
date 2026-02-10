import assert from 'assert';
import { summarizeQuotaByModel } from '../src/utils/quotaSummary.js';

const nowMs = Date.parse('2026-02-10T16:00:00.000Z');
const plusMinutes = (minutes) => new Date(nowMs + minutes * 60 * 1000).toISOString();

const tokens = [
  { id: 't1', email: 'a@example.com', projectId: 'p1', enable: true },
  { id: 't2', email: 'b@example.com', projectId: 'p2', enable: true },
  { id: 't3', email: 'c@example.com', projectId: 'p3', enable: false }
];

const quotaByTokenId = {
  t1: {
    'gemini-3-pro-high': { r: 0.5, t: plusMinutes(120) },
    'gemini-2.5-pro': { r: 0, t: plusMinutes(60) }
  },
  t2: {
    'gemini-3-pro-high': { r: 0, t: plusMinutes(30) }
  },
  t3: {}
};

const result = summarizeQuotaByModel(tokens, quotaByTokenId, nowMs);

assert.strictEqual(result.tokenStats.totalTokens, 3);
assert.strictEqual(result.tokenStats.withQuotaData, 2);
assert.strictEqual(result.tokenStats.withoutQuotaData, 1);
assert.strictEqual(result.tokenStats.enabledTokens, 2);
assert.strictEqual(result.tokenStats.disabledTokens, 1);

const g3 = result.models.find(m => m.modelId === 'gemini-3-pro-high');
assert.ok(g3, 'gemini-3-pro-high summary should exist');
assert.strictEqual(g3.tokenCount, 2);
assert.strictEqual(g3.exhaustedCount, 1);
assert.strictEqual(g3.avgRemaining, 0.25);
assert.strictEqual(g3.avgRemainingPercent, 25);
assert.strictEqual(g3.avgResetDelayMinutes, 75);
assert.strictEqual(g3.avgResetDelayMinutesExhausted, 30);
assert.ok(g3.avgResetMs > 0);

const g25 = result.models.find(m => m.modelId === 'gemini-2.5-pro');
assert.ok(g25, 'gemini-2.5-pro summary should exist');
assert.strictEqual(g25.tokenCount, 1);
assert.strictEqual(g25.exhaustedCount, 1);
assert.strictEqual(g25.avgRemaining, 0);
assert.strictEqual(g25.avgResetDelayMinutes, 60);

const g3Details = result.detailsByModel['gemini-3-pro-high'];
assert.ok(g3Details, 'gemini-3-pro-high details should exist');
assert.strictEqual(g3Details.entries.length, 2);
assert.strictEqual(g3Details.entries[0].tokenId, 't2', 'exhausted entries should be sorted first');
assert.strictEqual(g3Details.entries[0].isExhausted, true);
assert.strictEqual(g3Details.entries[0].tokenType, 'token');
assert.strictEqual(g3Details.entries[1].tokenId, 't1');

console.log('test-quota-summary passed');
