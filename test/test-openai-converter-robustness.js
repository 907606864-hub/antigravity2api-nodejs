import assert from 'assert';
import { generateRequestBody } from '../src/utils/converters/openai.js';

const token = {
  projectId: 'project-test',
  sessionId: 'session-test'
};

// Case 1: mixed OpenAI content blocks should be accepted (no trim crash)
const request1 = generateRequestBody([
  {
    role: 'user',
    content: [
      { type: 'input_text', text: 'hello' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAA=' }
    ]
  },
  {
    role: 'assistant',
    content: [{ type: 'output_text', text: 'assistant-output' }]
  }
], 'gemini-2.5-pro', {}, [], token);

assert.ok(Array.isArray(request1?.request?.contents), 'request.contents should be array');
const userMsg = request1.request.contents.find(m => m.role === 'user');
assert.ok(userMsg, 'user message should exist');
assert.ok(userMsg.parts.some(p => p.inlineData), 'user message should include parsed image inlineData');

const modelMsg = request1.request.contents.find(m => m.role === 'model');
assert.ok(modelMsg, 'model message should exist');
const modelTextPart = modelMsg.parts.find(p => typeof p.text === 'string' && p.thought !== true);
assert.ok(modelTextPart, 'model text part should exist');
assert.strictEqual(modelTextPart.text, 'assistant-output');

// Case 2: invalid tool arguments JSON should not throw and should be preserved safely
const request2 = generateRequestBody([
  { role: 'user', content: 'run tool' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        function: {
          name: 'my_tool',
          arguments: '{not-json'
        }
      }
    ]
  }
], 'gemini-2.5-pro', {}, [], token);

const modelMsg2 = request2.request.contents.find(m => m.role === 'model');
assert.ok(modelMsg2, 'model message with tool call should exist');
const toolCallPart = modelMsg2.parts.find(p => p.functionCall && p.functionCall.id === 'call_1');
assert.ok(toolCallPart, 'tool call part should exist');
assert.deepStrictEqual(toolCallPart.functionCall.args, { raw: '{not-json' });

// Case 3: object content should not throw
const request3 = generateRequestBody([
  { role: 'user', content: 'x' },
  { role: 'assistant', content: { type: 'text', text: 'object-text' } }
], 'gemini-2.5-pro', {}, [], token);

const modelMsg3 = request3.request.contents.find(m => m.role === 'model');
assert.ok(modelMsg3, 'model message for object content should exist');
const objectTextPart = modelMsg3.parts.find(p => typeof p.text === 'string' && p.text.includes('object-text'));
assert.ok(objectTextPart, 'object content should be normalized to text');

console.log('test-openai-converter-robustness passed');
