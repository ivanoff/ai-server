import { z } from 'zod';
import type { ChatCompletionRequestType, ClaudeMessageRequestType } from './types';

const sharedRequestSchema = z.object({
  model: z.string().trim().min(1).optional(),
  max_tokens: z.number().int().positive().max(32768).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
  timeout_ms: z.number().int().positive().max(600000).optional()
}).strict();

const openAIMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'human', 'bot']),
  content: z.string().min(1)
}).strict();

const claudeMessageSchema = z.object({
  role: z.enum(['human', 'user', 'assistant']),
  content: z.string().min(1)
}).strict();

export const chatCompletionRequestSchema = sharedRequestSchema.extend({
  messages: z.array(openAIMessageSchema).min(1)
});

export const claudeMessageRequestSchema = sharedRequestSchema.extend({
  messages: z.array(claudeMessageSchema).min(1)
});

export function parseChatCompletionRequest(payload: unknown): ChatCompletionRequestType {
  return chatCompletionRequestSchema.parse(payload);
}

export function parseClaudeMessageRequest(payload: unknown): ClaudeMessageRequestType {
  return claudeMessageRequestSchema.parse(payload);
}

export function isValidationError(error: unknown): boolean {
  return error instanceof z.ZodError;
}

export function getValidationMessage(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return 'Invalid request body';
  }

  const firstIssue = error.issues[0];

  if (!firstIssue) {
    return 'Invalid request body';
  }

  const path = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'body';
  return `${path}: ${firstIssue.message}`;
}
