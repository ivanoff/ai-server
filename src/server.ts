import 'the-log';
import cors from 'cors';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getLlama, LlamaChatSession, LlamaModel } from 'node-llama-cpp';
import type { NextFunction, Request, Response } from 'express';
import type { ClaudeMessageRequestType, MessageType } from './types';
import { config, corsOptions, getLlamaGpuOption } from './config';
import { logger } from './logger';
import { formatMessagesForLlama } from './prompt';
import {
  getValidationMessage,
  isValidationError,
  parseChatCompletionRequest,
  parseClaudeMessageRequest
} from './validation';

type LlamaContextType = Awaited<ReturnType<LlamaModel['createContext']>>;

const app = express();
let model: LlamaModel | null = null;
let modelLoadedAt: string | null = null;
let modelLoadError: string | null = null;
let activeRequests = 0;
const serviceStartedAt = Date.now();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

if (config.securityHeadersEnabled) {
  app.disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header('x-request-id')?.trim();
  const requestId = incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = process.hrtime.bigint();

  logger.info('request.start', {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logger.info('request.finish', {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      active_requests: activeRequests
    });
  });

  next();
});

if (config.corsEnabled) {
  app.use(cors(corsOptions));
}

app.use(express.json({ limit: config.bodyLimit }));

function requestIdFrom(res: Response): string {
  return typeof res.locals.requestId === 'string' ? res.locals.requestId : 'unknown';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function errorResponse(res: Response, status: number, message: string, type = 'server_error'): void {
  res.status(status).json({
    error: {
      message,
      type
    },
    request_id: requestIdFrom(res)
  });
}

function sseErrorResponse(res: Response, message: string): void {
  res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function safeCompare(secretA: string, secretB: string): boolean {
  const secretABuffer = Buffer.from(secretA);
  const secretBBuffer = Buffer.from(secretB);

  if (secretABuffer.length !== secretBBuffer.length) {
    return false;
  }

  return timingSafeEqual(secretABuffer, secretBBuffer);
}

function getApiKeyFromRequest(req: Request): string {
  const xApiKey = req.header('x-api-key');
  if (xApiKey && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }

  const authHeader = req.header('authorization');
  if (!authHeader) {
    return '';
  }

  return authHeader.replace(/^bearer\s+/i, '').trim();
}

function acquireRequestSlot(): boolean {
  if (activeRequests >= config.maxConcurrentRequests) {
    return false;
  }

  activeRequests += 1;
  return true;
}

function releaseRequestSlot(): void {
  activeRequests = Math.max(0, activeRequests - 1);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractChunkText(chunk: unknown): string {
  if (typeof chunk === 'string') {
    return chunk;
  }

  if (typeof chunk === 'object' && chunk !== null) {
    const maybeText = (chunk as { text?: unknown }).text;
    if (typeof maybeText === 'string') {
      return maybeText;
    }
  }

  return '';
}

function createGenerationAbortController(req: Request, res: Response, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort(new Error(`Generation timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onClientDisconnect = () => {
    controller.abort(new Error('Client disconnected'));
  };

  req.on('aborted', onClientDisconnect);
  req.on('close', onClientDisconnect);
  res.on('close', onClientDisconnect);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      req.off('aborted', onClientDisconnect);
      req.off('close', onClientDisconnect);
      res.off('close', onClientDisconnect);
    }
  };
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || error.message.toLowerCase().includes('abort') || error.message.toLowerCase().includes('disconnect') || error.message.toLowerCase().includes('timed out');
}

const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!config.apiKey) {
    next();
    return;
  }

  const requestApiKey = getApiKeyFromRequest(req);
  if (!requestApiKey || !safeCompare(requestApiKey, config.apiKey)) {
    errorResponse(res, 401, 'Unauthorized', 'authentication_error');
    return;
  }

  next();
};

function ensureModelLoaded(res: Response): boolean {
  if (model) {
    return true;
  }

  errorResponse(res, 503, 'Model is not loaded yet', 'service_unavailable_error');
  return false;
}

async function handleOpenAIStream(
  res: Response,
  session: LlamaChatSession,
  prompt: string,
  maxTokens: number,
  temperature: number,
  modelId: string,
  signal: AbortSignal
): Promise<void> {
  const responseId = `chatcmpl-${Date.now()}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ delta: { role: 'assistant' }, index: 0, finish_reason: null }]
    })}\n\n`
  );

  await session.promptWithMeta(
    prompt,
    {
      maxTokens,
      temperature,
      signal,
      onResponseChunk(chunk: unknown) {
        const text = extractChunkText(chunk);

        if (!text || res.writableEnded) {
          return;
        }

        const jsonData = {
          id: responseId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [
            {
              delta: { content: text },
              index: 0,
              finish_reason: null
            }
          ]
        };

        res.write(`data: ${JSON.stringify(jsonData)}\n\n`);
      }
    } as never
  );

  res.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
    })}\n\n`
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleClaudeStream(
  res: Response,
  session: LlamaChatSession,
  prompt: string,
  maxTokens: number,
  temperature: number,
  modelId: string,
  signal: AbortSignal
): Promise<void> {
  const messageId = `msg_${Date.now()}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: modelId,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: estimateTokens(prompt), output_tokens: 0 }
      }
    })}\n\n`
  );

  res.write(
    `data: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: ''
      }
    })}\n\n`
  );

  let outputTokens = 0;

  await session.promptWithMeta(
    prompt,
    {
      maxTokens,
      temperature,
      signal,
      onResponseChunk(chunk: unknown) {
        const text = extractChunkText(chunk);

        if (!text || res.writableEnded) {
          return;
        }

        outputTokens += estimateTokens(text);

        const jsonData = {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text
          },
          index: 0
        };

        res.write(`data: ${JSON.stringify(jsonData)}\n\n`);
      }
    } as never
  );

  res.write(
    `data: ${JSON.stringify({
      type: 'content_block_stop',
      index: 0
    })}\n\n`
  );

  res.write(
    `data: ${JSON.stringify({
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
        stop_sequence: null
      },
      usage: {
        output_tokens: outputTokens
      }
    })}\n\n`
  );

  res.write(
    `data: ${JSON.stringify({
      type: 'message_stop'
    })}\n\n`
  );

  res.end();
}

app.post('/v1/chat/completions', apiKeyMiddleware, async (req: Request, res: Response) => {
  let parsedBody;

  try {
    parsedBody = parseChatCompletionRequest(req.body);
  } catch (error) {
    if (isValidationError(error)) {
      errorResponse(res, 400, getValidationMessage(error), 'invalid_request_error');
      return;
    }

    errorResponse(res, 400, 'Invalid request body', 'invalid_request_error');
    return;
  }

  if (!ensureModelLoaded(res)) {
    return;
  }

  if (!acquireRequestSlot()) {
    errorResponse(res, 429, 'Too many concurrent requests', 'rate_limit_error');
    return;
  }

  const modelId = parsedBody.model || config.modelId;
  const maxTokens = parsedBody.max_tokens ?? config.defaultMaxTokens;
  const temperature = parsedBody.temperature ?? 0.7;
  const timeoutMs = parsedBody.timeout_ms ?? config.requestTimeoutMs;

  let context: LlamaContextType | undefined;
  let cleanupAbort: (() => void) | undefined;

  try {
    context = await model!.createContext();

    const session = new LlamaChatSession({
      contextSequence: context.getSequence()
    });

    const prompt = formatMessagesForLlama(parsedBody.messages);

    const abort = createGenerationAbortController(req, res, timeoutMs);
    cleanupAbort = abort.cleanup;

    if (parsedBody.stream) {
      await handleOpenAIStream(res, session, prompt, maxTokens, temperature, modelId, abort.signal);
      return;
    }

    const response = await session.prompt(
      prompt,
      {
        maxTokens,
        temperature,
        signal: abort.signal
      } as never
    );

    res.json({
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          message: {
            role: 'assistant',
            content: response
          },
          index: 0,
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(response),
        total_tokens: estimateTokens(prompt + response)
      }
    });
  } catch (error) {
    const message = toErrorMessage(error);

    if (isAbortError(error)) {
      const status = message.toLowerCase().includes('timed out') ? 408 : 499;

      if (res.headersSent) {
        if (!res.writableEnded) {
          sseErrorResponse(res, message);
        }
        return;
      }

      errorResponse(res, status, message, 'request_aborted_error');
      return;
    }

    logger.error('chat.completions.error', {
      request_id: requestIdFrom(res),
      error: message
    });

    if (res.headersSent) {
      if (!res.writableEnded) {
        sseErrorResponse(res, message);
      }
      return;
    }

    errorResponse(res, 500, message, 'server_error');
  } finally {
    cleanupAbort?.();

    if (context) {
      try {
        context.dispose();
      } catch (error) {
        logger.warn('context.dispose.failed', {
          request_id: requestIdFrom(res),
          error: toErrorMessage(error)
        });
      }
    }

    releaseRequestSlot();
  }
});

app.post('/v1/messages', apiKeyMiddleware, async (req: Request, res: Response) => {
  let parsedBody: ClaudeMessageRequestType;

  try {
    parsedBody = parseClaudeMessageRequest(req.body);
  } catch (error) {
    if (isValidationError(error)) {
      errorResponse(res, 400, getValidationMessage(error), 'invalid_request_error');
      return;
    }

    errorResponse(res, 400, 'Invalid request body', 'invalid_request_error');
    return;
  }

  if (!ensureModelLoaded(res)) {
    return;
  }

  if (!acquireRequestSlot()) {
    errorResponse(res, 429, 'Too many concurrent requests', 'rate_limit_error');
    return;
  }

  const transformedMessages: MessageType[] = parsedBody.messages.map((message) => {
    if (message.role === 'human' || message.role === 'user') {
      return { role: 'user', content: message.content };
    }

    return { role: 'assistant', content: message.content };
  });

  const modelId = parsedBody.model || config.modelId;
  const maxTokens = parsedBody.max_tokens ?? config.defaultMaxTokens;
  const temperature = parsedBody.temperature ?? 0.7;
  const timeoutMs = parsedBody.timeout_ms ?? config.requestTimeoutMs;

  let context: LlamaContextType | undefined;
  let cleanupAbort: (() => void) | undefined;

  try {
    context = await model!.createContext();

    const session = new LlamaChatSession({
      contextSequence: context.getSequence()
    });

    const prompt = formatMessagesForLlama(transformedMessages);

    const abort = createGenerationAbortController(req, res, timeoutMs);
    cleanupAbort = abort.cleanup;

    if (parsedBody.stream) {
      await handleClaudeStream(res, session, prompt, maxTokens, temperature, modelId, abort.signal);
      return;
    }

    const response = await session.prompt(
      prompt,
      {
        maxTokens,
        temperature,
        signal: abort.signal
      } as never
    );

    res.json({
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: response
        }
      ],
      model: modelId,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: estimateTokens(prompt),
        output_tokens: estimateTokens(response)
      }
    });
  } catch (error) {
    const message = toErrorMessage(error);

    if (isAbortError(error)) {
      const status = message.toLowerCase().includes('timed out') ? 408 : 499;

      if (res.headersSent) {
        if (!res.writableEnded) {
          sseErrorResponse(res, message);
        }
        return;
      }

      errorResponse(res, status, message, 'request_aborted_error');
      return;
    }

    logger.error('messages.error', {
      request_id: requestIdFrom(res),
      error: message
    });

    if (res.headersSent) {
      if (!res.writableEnded) {
        sseErrorResponse(res, message);
      }
      return;
    }

    errorResponse(res, 500, message, 'server_error');
  } finally {
    cleanupAbort?.();

    if (context) {
      try {
        context.dispose();
      } catch (error) {
        logger.warn('context.dispose.failed', {
          request_id: requestIdFrom(res),
          error: toErrorMessage(error)
        });
      }
    }

    releaseRequestSlot();
  }
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - serviceStartedAt) / 1000),
    model: {
      id: config.modelId,
      loaded: Boolean(model),
      loaded_at: modelLoadedAt,
      load_error: modelLoadError,
      path: config.exposeModelPathInHealth ? config.modelPath : undefined
    },
    requests: {
      active: activeRequests,
      max_concurrent: config.maxConcurrentRequests
    },
    runtime: {
      gpu_backend: config.gpuBackend,
      gpu_layers: config.gpuLayers,
      request_timeout_ms: config.requestTimeoutMs
    }
  });
});

app.get('/ready', (req: Request, res: Response) => {
  if (!model) {
    res.status(503).json({
      status: 'not_ready',
      reason: modelLoadError || 'model_not_loaded',
      request_id: requestIdFrom(res)
    });
    return;
  }

  res.json({
    status: 'ready',
    request_id: requestIdFrom(res)
  });
});

app.get('/v1/models', apiKeyMiddleware, (req: Request, res: Response) => {
  res.json({
    object: 'list',
    data: [
      {
        id: config.modelId,
        object: 'model',
        created: Math.floor(serviceStartedAt / 1000),
        owned_by: 'local'
      }
    ]
  });
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) {
    errorResponse(res, 400, 'Invalid JSON payload', 'invalid_request_error');
    return;
  }

  next(error);
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('unhandled.error', {
    request_id: requestIdFrom(res),
    error: toErrorMessage(error)
  });

  if (!res.headersSent) {
    errorResponse(res, 500, 'Internal server error', 'server_error');
    return;
  }

  next(error);
});

async function initModel(): Promise<void> {
  try {
    const llama = await getLlama(getLlamaGpuOption());

    logger.info('llama.runtime.ready', {
      gpu_backend: config.gpuBackend,
      llama_gpu: String(llama.gpu)
    });

    model = await llama.loadModel({
      modelPath: config.modelPath,
      gpuLayers: config.gpuLayers
    });

    modelLoadedAt = new Date().toISOString();
    modelLoadError = null;

    logger.info('model.loaded', {
      model_id: config.modelId,
      model_path: config.modelPath,
      gpu_layers: config.gpuLayers
    });
  } catch (error) {
    model = null;
    modelLoadError = toErrorMessage(error);

    logger.error('model.load.failed', {
      error: modelLoadError,
      model_path: config.modelPath,
      gpu_backend: config.gpuBackend,
      gpu_layers: config.gpuLayers
    });

    throw error;
  }
}

async function startServer(): Promise<void> {
  await initModel();

  app.listen(config.port, () => {
    logger.info('server.started', {
      port: config.port,
      model_id: config.modelId,
      cors_enabled: config.corsEnabled,
      max_concurrent_requests: config.maxConcurrentRequests
    });
  });
}

startServer().catch((error) => {
  logger.error('server.start.failed', {
    error: toErrorMessage(error)
  });

  process.exit(1);
});
