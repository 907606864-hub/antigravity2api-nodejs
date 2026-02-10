import assert from 'assert';
import { isModelUserFacing, toOpenAIModelItem } from '../src/utils/modelVisibility.js';

// Internal/hidden model ids should be filtered out.
assert.strictEqual(isModelUserFacing('tab_flash_lite_preview'), false);
assert.strictEqual(isModelUserFacing('chat_20706'), false);

// Explicit internal flags from upstream metadata should be filtered out.
assert.strictEqual(isModelUserFacing('gemini-2.5-pro', { isInternal: true }), false);
assert.strictEqual(isModelUserFacing('gemini-2.5-pro', { is_internal: true }), false);
assert.strictEqual(isModelUserFacing('gemini-2.5-pro', { visibility: 'INTERNAL' }), false);

// Regular model ids should remain available.
assert.strictEqual(isModelUserFacing('gemini-2.5-pro'), true);
assert.strictEqual(isModelUserFacing('claude-sonnet-4-5'), true);

// Empty/invalid ids should be rejected.
assert.strictEqual(isModelUserFacing(''), false);
assert.strictEqual(isModelUserFacing('   '), false);
assert.strictEqual(isModelUserFacing(null), false);

// Model list item format should stay OpenAI-compatible.
const created = 123456;
assert.deepStrictEqual(toOpenAIModelItem('gemini-2.5-pro', created), {
  id: 'gemini-2.5-pro',
  object: 'model',
  created,
  owned_by: 'google'
});

console.log('test-model-visibility passed');
