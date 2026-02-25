import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChatCompletionRequest, parseClaudeMessageRequest } from '../src/validation';

test('parseChatCompletionRequest accepts valid payload', () => {
  const parsed = parseChatCompletionRequest({
    model: 'llama-local',
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 128,
    temperature: 0.5,
    stream: false,
    timeout_ms: 5000
  });

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.max_tokens, 128);
});

test('parseChatCompletionRequest rejects missing messages', () => {
  assert.throws(() => {
    parseChatCompletionRequest({ model: 'llama-local' });
  });
});

test('parseClaudeMessageRequest accepts human/user roles', () => {
  const parsed = parseClaudeMessageRequest({
    messages: [
      { role: 'human', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Continue' }
    ],
    stream: true
  });

  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.stream, true);
});
