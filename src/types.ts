export type MessageType = {
  role: string;
  content: string;
}
  
export type ChatCompletionRequestType = {
  messages: MessageType[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}
  
export type ClaudeMessageRequestType = {
  messages: MessageType[];
  model?: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}
  