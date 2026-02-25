export type RoleType = 'system' | 'user' | 'assistant' | 'human' | 'bot';

export type MessageType = {
  role: RoleType;
  content: string;
};

export type ChatCompletionRequestType = {
  messages: MessageType[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  timeout_ms?: number;
};

export type ClaudeMessageRequestType = {
  messages: Array<{
    role: 'human' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  timeout_ms?: number;
};
