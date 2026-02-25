import type { MessageType } from './types';

export function formatMessagesForLlama(messages: MessageType[]): string {
  let formattedPrompt = '';

  for (const message of messages) {
    const role = message.role.toLowerCase();
    const content = message.content;

    if (role === 'system') {
      formattedPrompt += `<s>[INST] <<SYS>>\n${content}\n<</SYS>>\n\n`;
    } else if (role === 'user' || role === 'human') {
      if (formattedPrompt === '') {
        formattedPrompt += `<s>[INST] ${content} [/INST]`;
      } else {
        formattedPrompt += `[INST] ${content} [/INST]`;
      }
    } else if (role === 'assistant' || role === 'bot') {
      formattedPrompt += ` ${content} </s>`;
    }
  }

  return formattedPrompt;
}
