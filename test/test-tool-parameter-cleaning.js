import assert from 'assert';
import { cleanParameters } from '../src/utils/utils.js';

function assertNoTypeArray(node) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      assertNoTypeArray(item);
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(node, 'type')) {
    assert.ok(!Array.isArray(node.type), 'type should not remain an array');
  }

  for (const value of Object.values(node)) {
    assertNoTypeArray(value);
  }
}

// Case 1: type arrays (including NULL) are flattened to a single type and required is filtered.
{
  const input = {
    type: 'object',
    properties: {
      a: { type: ['null', 'string'] },
      b: { type: ['NULL', 'number'] },
      c: { type: ['null', null] }
    },
    required: ['a', 'missing']
  };

  const cleaned = cleanParameters(input);
  assert.strictEqual(cleaned.type, 'OBJECT');
  assert.strictEqual(cleaned.properties.a.type, 'STRING');
  assert.strictEqual(cleaned.properties.b.type, 'NUMBER');
  assert.strictEqual(cleaned.properties.c.type, 'STRING');
  assert.deepStrictEqual(cleaned.required, ['a']);
}

// Case 2: oneOf prefers the richer object schema.
{
  const input = {
    type: 'object',
    properties: {
      payload: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              key: { type: 'string' }
            },
            required: ['key']
          }
        ]
      }
    }
  };

  const cleaned = cleanParameters(input);
  assert.strictEqual(cleaned.properties.payload.type, 'OBJECT');
  assert.strictEqual(cleaned.properties.payload.properties.key.type, 'STRING');
  assert.deepStrictEqual(cleaned.properties.payload.required, ['key']);
}

// Case 3: allOf is merged and invalid required fields are removed.
{
  const input = {
    type: 'object',
    allOf: [
      {
        properties: {
          x: { type: 'string' }
        },
        required: ['x']
      },
      {
        properties: {
          y: { type: 'integer' }
        },
        required: ['y', 'ghost']
      }
    ]
  };

  const cleaned = cleanParameters(input);
  assert.strictEqual(cleaned.type, 'OBJECT');
  assert.strictEqual(cleaned.properties.x.type, 'STRING');
  assert.strictEqual(cleaned.properties.y.type, 'INTEGER');
  assert.deepStrictEqual(cleaned.required.sort(), ['x', 'y']);
}

// Case 4: properties in key/value-entry array format are normalized into an object map.
{
  const input = {
    type: 'object',
    properties: [
      { key: 'foo', value: { type: ['string', 'null'] } },
      { key: 'bar', value: { type: 'integer' } }
    ]
  };

  const cleaned = cleanParameters(input);
  assert.strictEqual(cleaned.properties.foo.type, 'STRING');
  assert.strictEqual(cleaned.properties.bar.type, 'INTEGER');
}

// Case 5: enum values are normalized to strings and unsupported keys are removed.
{
  const input = {
    type: 'object',
    properties: {
      mode: {
        enum: [1, 'safe', true],
        format: 'uuid',
        'x-google-enum-descriptions': ['a', 'b']
      }
    }
  };

  const cleaned = cleanParameters(input);
  assert.deepStrictEqual(cleaned.properties.mode.enum, ['1', 'safe', 'true']);
  assert.strictEqual(cleaned.properties.mode.type, 'STRING');
  assert.ok(!Object.prototype.hasOwnProperty.call(cleaned.properties.mode, 'format'));
  assert.ok(!Object.prototype.hasOwnProperty.call(cleaned.properties.mode, 'x-google-enum-descriptions'));
}

assertNoTypeArray(cleanParameters({
  type: 'object',
  properties: {
    nested: {
      type: ['null', 'object'],
      properties: {
        value: {
          anyOf: [
            { type: ['NULL', 'string'] },
            { type: ['null', 'number'] }
          ]
        }
      }
    }
  }
}));

console.log('test-tool-parameter-cleaning passed');
