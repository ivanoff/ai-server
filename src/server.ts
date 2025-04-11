import 'the-log';
import express from 'express';
import cors from 'cors';
import { getLlama, LlamaModel, LlamaChatSession } from 'node-llama-cpp';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';
import type { MessageType, ChatCompletionRequestType, ClaudeMessageRequestType } from './types';

// For working with __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config();
const {
  PORT,
  MODEL_PATH,
  DEFAULT_MAX_TOKENS,
  GPU_LAYERS,
  API_KEY
} = process.env;

const app = express();
const port = PORT ? parseInt(PORT) : 3000;
const modelPath = MODEL_PATH || path.join(__dirname, '..', 'models', 'llama-2-7b-chat.gguf');
const defaultMaxTokens = parseInt(DEFAULT_MAX_TOKENS || '2048');

const apiKeyMiddleware: (req: Request, res: Response, next: NextFunction) => void = (req, res, next) => {
  if (!API_KEY) return next();

  const apiKeyRaw = req.headers['x-api-key'] || req.headers['authorization'] || '';
  const apiKey = typeof apiKeyRaw === 'string' && apiKeyRaw.replace(/^bearer /i, '').trim();

  if (apiKey !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  next();
};

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize the model
let model: LlamaModel;

const llama = await getLlama({ gpu: "cuda" });
console.log("GPU type:", llama.gpu);

const initModel = async () => {
  try {
    model = await llama.loadModel({
      modelPath: modelPath,
      gpuLayers: GPU_LAYERS ? parseInt(GPU_LAYERS) : 0
    });
    console.log('Model loaded successfully');
  } catch (error) {
    console.error('Failed to load model:', error);
    process.exit(1);
  }
};

// Convert messages to a format compatible with Llama
function formatMessagesForLlama(messages: MessageType[]): string {
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

// OpenAI compatible /chat/completions endpoint
app.post('/v1/chat/completions', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    const { messages, model: modelName, max_tokens, temperature, stream } = req.body as ChatCompletionRequestType;
    
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }
    
    const maxTokens = max_tokens || defaultMaxTokens;
    const temp = temperature || 0.7;
    
    const context = await model.createContext();
    const contextSequence = context.getSequence();

    const session = new LlamaChatSession({contextSequence});
    
    const prompt = formatMessagesForLlama(messages);
    
    if (stream) {
      // Streaming mode
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let fullResponse = '';
      
      try {
        await session.promptWithMeta(prompt, {
          onResponseChunk(chunk) {
            fullResponse += chunk.text;
          
            const jsonData = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: modelName || 'llama-local',
              choices: [
                {
                  delta: { content: chunk },
                  index: 0,
                  finish_reason: null
                }
              ]
            };
            
            res.write(`data: ${JSON.stringify(jsonData)}\n\n`);
          }
        });
        
        const finishData = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelName || 'llama-local',
          choices: [
            {
              delta: {},
              index: 0,
              finish_reason: 'stop'
            }
          ]
        };
        
        res.write(`data: ${JSON.stringify(finishData)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        console.error('Streaming error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming mode
      const response = await session.prompt(prompt, {
        maxTokens,
        temperature: temp
      });
      
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelName || 'llama-local',
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
          prompt_tokens: Math.ceil(prompt.length / 4), // Quite average estimate
          completion_tokens: Math.ceil(response.length / 4), // Quite average estimate
          total_tokens: Math.ceil((prompt.length + response.length) / 4) // Quite average estimate
        }
      });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Claude compatible API endpoint
app.post('/v1/messages', apiKeyMiddleware, async (req: Request, res: Response) => {
  try {
    const { model: modelName, messages, max_tokens, temperature, stream } = req.body as ClaudeMessageRequestType;
    
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }
    
    const maxTokens = max_tokens || defaultMaxTokens;
    const temp = temperature || 0.7;
    
    // Transform messages from Claude format to Llama format
    const transformedMessages = messages.map(msg => {
      if (msg.role === 'human') {
        return { role: 'user', content: msg.content };
      } else if (msg.role === 'assistant') {
        return { role: 'assistant', content: msg.content };
      }
      return msg;
    });
    
    const context = await model.createContext();
    const contextSequence = context.getSequence();

    const session = new LlamaChatSession({contextSequence});

    const prompt = formatMessagesForLlama(transformedMessages);
    
    if (stream) {
      // Streaming mode
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let fullResponse = '';
      
      try {
        await session.promptWithMeta(prompt, {
          onResponseChunk(chunk) {
            fullResponse += chunk.text;
            const jsonData = {
              type: 'content_block_delta',
              delta: {
                type: 'text_delta',
                text: chunk
              },
              index: 0
            };
            
            res.write(`data: ${JSON.stringify(jsonData)}\n\n`);
          }
        });
        
        const finalData = {
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            stop_sequence: null
          },
          usage: {
            output_tokens: Math.ceil(fullResponse.length / 4)
          }
        };
        
        res.write(`data: ${JSON.stringify(finalData)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        console.error('Streaming error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming mode
      const response = await session.prompt(prompt, {
        maxTokens,
        temperature: temp
      });
      
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
        model: modelName || 'llama-local',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: Math.ceil(prompt.length / 4), // Average estimate
          output_tokens: Math.ceil(response.length / 4) // Average estimate
        }
      });
    }
  } catch (error) {
    console.error('Error processing request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: modelPath });
});

// Models endpoint for OpenAI API compatibility
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'llama-local',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'local'
      }
    ]
  });
});

// Initialize and start the server
const startServer = async () => {
  await initModel();
  
  app.listen(port, () => {
    console.log(`Llama API server running on port ${port}`);
    console.log(`Model path: ${modelPath}`);
  });
};

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
