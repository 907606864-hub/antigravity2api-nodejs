import assert from 'assert';
import { generateRequestBody } from '../src/utils/converters/openai.js';

function runCase(messages) {
  const token = { sessionId: 'test-session', projectId: 'test-project' };
  return generateRequestBody(messages, 'gemini-2.5-flash-lite', {}, null, token);
}

function getFirstModelTextPart(body) {
  const contents = body?.request?.contents || [];
  const modelMessage = contents.find((m) => m.role === 'model');
  assert.ok(modelMessage, 'expected a model message');

  const textPart = (modelMessage.parts || []).find((p) => typeof p?.text === 'string' && !p?.thought);
  assert.ok(textPart, 'expected a text part in model message');
  return textPart.text;
}

// Case 1: legacy string content
{
  const body = runCase([
    { role: 'assistant', content: 'hello' },
    { role: 'user', content: 'continue' }
  ]);
  assert.strictEqual(getFirstModelTextPart(body), 'hello');
}

// Case 2: multimodal array content should not throw and should extract text parts
{
  const body = runCase([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,Zm9v' } },
        { type: 'text', text: 'world' }
      ]
    },
    { role: 'user', content: 'continue' }
  ]);
  assert.strictEqual(getFirstModelTextPart(body), 'hello world');
}

console.log('test-openai-assistant-content passed');
