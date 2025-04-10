# AI Server

A TypeScript microservice that provides an API compatible with OpenAI and Claude for working with local LLM models through node-llama-cpp.

## Features

- 🔄 Full compatibility with OpenAI Chat API (`/v1/chat/completions`)
- 🤖 Compatibility with Anthropic Claude API (`/v1/messages`)
- 🐟 Full compatibility with DeepSeek API (`/v1/chat/completions`)
- 🌊 Support for streaming generation (Streaming API)
- 🧠 Run local LLM models in GGUF format
- ⚙️ Configuration through environment variables
- 🔍 Monitoring via `/health` endpoint
- 📋 Standard API for retrieving model list (`/v1/models`)

## Requirements

- Node.js 18+
- TypeScript 5.3+
- GGUF model (Llama 2, Mistral, LLaMA 3, or other compatible models)
- Recommended minimum 16 GB RAM for 7B models

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ivanoff/ai-server.git
   cd ai-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a directory for models:
   ```bash
   mkdir -p models
   ```

4. Download a GGUF model into the `models/` directory (for example, from [Hugging Face](https://huggingface.co/models))

5. Copy the example `.env` file and configure it to your needs:
   ```bash
   cp .env.example .env
   ```

6. Compile TypeScript:
   ```bash
   npm run build
   ```

7. Start the server:
   ```bash
   npm start
   ```

## Project Structure

```
ai-server/
├── src/
│   └── server.ts         # Main server code
├── models/               # Directory for GGUF models
├── dist/                 # Compiled files
├── .env                  # Configuration
├── package.json
└── tsconfig.json
```

## Configuration

Configure the `.env` file to change server parameters:

```ini
# Path to the model (absolute or relative to project root)
MODEL_PATH=./models/llama-2-7b-chat.gguf

# Server port
PORT=3000

# Default maximum number of tokens
DEFAULT_MAX_TOKENS=2048

# Number of model layers to offload to GPU (0 for CPU-only)
GPU_LAYERS=0

# Enable logging (true/false)
DEBUG=false
```

## Usage Examples

### OpenAI API compatible request

```typescript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about TypeScript' }
    ],
    max_tokens: 500,
    temperature: 0.7
  })
});

const data = await response.json();
console.log(data);
```

### Anthropic Claude API compatible request

```typescript
const response = await fetch('http://localhost:3000/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'human', content: 'Tell me about TypeScript' }
    ],
    max_tokens: 500,
    temperature: 0.7
  })
});

const data = await response.json();
console.log(data);
```

### Streaming mode

To use streaming mode, add the `stream: true` parameter to the request and process the event stream:

```typescript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about TypeScript' }
    ],
    max_tokens: 500,
    temperature: 0.7,
    stream: true
  })
});

// Process the event stream
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n').filter(line => line.trim() !== '');
  
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const jsonData = JSON.parse(line.replace('data: ', ''));
      console.log(jsonData);
    }
  }
}
```

## API Endpoints

### `/v1/chat/completions`

OpenAI Chat API compatible endpoint.

**Request Parameters:**
- `messages`: Array of message objects with `role` and `content`
- `model`: Model identifier (optional)
- `max_tokens`: Maximum tokens to generate (optional)
- `temperature`: Randomness of generation (optional)
- `stream`: Enable streaming mode (optional)

### `/v1/messages`

Claude API compatible endpoint.

**Request Parameters:**
- `messages`: Array of message objects with `role` and `content`
- `model`: Model identifier (optional)
- `max_tokens`: Maximum tokens to generate (optional)
- `temperature`: Randomness of generation (optional)
- `stream`: Enable streaming mode (optional)

### `/health`

Health check endpoint that returns server status and model path.

### `/v1/models`

Returns a list of available models (currently returns a single model, `llama-local`).

## Development

- Run in development mode with hot reloading:
  ```bash
  npm run dev
  ```

- Watch for TypeScript changes:
  ```bash
  npm run watch
  ```

## License

[MIT](https://choosealicense.com/licenses/mit/)

## Created by

Dimitry Ivanov <2@ivanoff.org.ua> # curl -A cv ivanoff.org.ua
