import assert from 'assert';
import { generateGenerationConfig } from '../src/utils/utils.js';

function buildConfig({ max_tokens, thinking_budget, reasoning_effort, model = 'claude-sonnet-4-5', enableThinking = true } = {}) {
  return generateGenerationConfig({
    max_tokens,
    thinking_budget,
    reasoning_effort,
    temperature: 1,
    top_p: 0.9,
    top_k: 50
  }, enableThinking, model);
}

// Case 1: reasoning_effort=high maps to 32000, but must be clamped under max_tokens.
{
  const cfg = buildConfig({ max_tokens: 4096, reasoning_effort: 'high' });
  assert.strictEqual(cfg.maxOutputTokens, 4096);
  assert.strictEqual(cfg.thinkingConfig.includeThoughts, true);
  assert.strictEqual(cfg.thinkingConfig.thinkingBudget, 4095);
}

// Case 2: explicit thinking_budget larger than max_tokens should be clamped.
{
  const cfg = buildConfig({ max_tokens: 2000, thinking_budget: 5000 });
  assert.strictEqual(cfg.maxOutputTokens, 2000);
  assert.strictEqual(cfg.thinkingConfig.includeThoughts, true);
  assert.strictEqual(cfg.thinkingConfig.thinkingBudget, 1999);
}

// Case 3: when max_tokens is too small (<=1024), thinking is disabled to avoid upstream 400.
{
  const cfg = buildConfig({ max_tokens: 1024, thinking_budget: 1024 });
  assert.strictEqual(cfg.maxOutputTokens, 1024);
  assert.strictEqual(cfg.thinkingConfig.includeThoughts, false);
  assert.strictEqual(cfg.thinkingConfig.thinkingBudget, 0);
}

console.log('test-thinking-budget-guard passed');
