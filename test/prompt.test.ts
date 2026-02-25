import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMessagesForLlama } from '../src/prompt';

test('formatMessagesForLlama builds llama-style prompt', () => {
  const prompt = formatMessagesForLlama([
    { role: 'system', content: 'You are concise.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there.' },
    { role: 'user', content: 'Explain TypeScript in one line.' }
  ]);

  assert.equal(
    prompt,
    '<s>[INST] <<SYS>>\nYou are concise.\n<</SYS>>\n\n[INST] Hello [/INST] Hi there. </s>[INST] Explain TypeScript in one line. [/INST]'
  );
});
