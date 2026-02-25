# AI Server

A TypeScript microservice that exposes OpenAI- and Claude-compatible endpoints for local GGUF models via `node-llama-cpp`.

## Features

- OpenAI-compatible chat endpoint: `POST /v1/chat/completions`
- Claude-compatible messages endpoint: `POST /v1/messages`
- Streaming responses via Server-Sent Events (SSE)
- API key authentication (`Authorization: Bearer ...` or `x-api-key`)
- Configurable timeout and concurrency limits
- Configurable CORS and basic security headers
- Structured JSON logs with request IDs
- Health and readiness probes: `GET /health`, `GET /ready`
- Models list endpoint: `GET /v1/models`

## Requirements

- Node.js 20+
- npm 10+
- GGUF model file

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

3. Create a models directory and place a GGUF model there:

```bash
mkdir -p models
```

4. Copy environment template and adjust values:

```bash
cp .env.example .env
```

5. Build and run:

```bash
npm run build
npm start
```

## Scripts

- `npm run dev` - run server in watch mode (TypeScript, hot reload)
- `npm run typecheck` - run strict TypeScript checks
- `npm run watch` - run typecheck in watch mode
- `npm run test` - run unit tests
- `npm run build` - typecheck + production bundle to `dist/server.js`
- `npm start` - start built server

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MODEL_PATH` | `./models/llama-2-7b-chat.gguf` | Model path (absolute or relative to project root) |
| `MODEL_ID` | `llama-local` | Model identifier returned in API responses |
| `PORT` | `3000` | HTTP port |
| `DEFAULT_MAX_TOKENS` | `2048` | Default max tokens for generation |
| `GPU_LAYERS` | `0` | Number of layers offloaded to GPU |
| `GPU_BACKEND` | `auto` | `auto`, `cpu`, `cuda`, `vulkan`, `metal` |
| `REQUEST_TIMEOUT_MS` | `120000` | Per-request generation timeout |
| `MAX_CONCURRENT_REQUESTS` | `2` | Maximum active generation requests |
| `BODY_LIMIT` | `1mb` | Max request body size |
| `API_KEY` | empty | API key; if empty, auth is disabled |
| `CORS_ENABLED` | `true` | Enable CORS middleware |
| `CORS_ORIGIN` | `*` | Allowed origins (`*` or comma-separated list) |
| `CORS_CREDENTIALS` | `false` | Enable CORS credentials |
| `TRUST_PROXY` | `false` | Enable Express trust proxy |
| `SECURITY_HEADERS_ENABLED` | `true` | Add basic security headers |
| `EXPOSE_MODEL_PATH_IN_HEALTH` | `false` | Include model path in `/health` response |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## API examples

### OpenAI-style request

```ts
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your_api_key'
  },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [
      { role: 'system', content: 'You are a concise assistant.' },
      { role: 'user', content: 'Tell me about TypeScript in one paragraph.' }
    ],
    max_tokens: 300,
    temperature: 0.7
  })
});

console.log(await response.json());
```

### Claude-style request

```ts
const response = await fetch('http://localhost:3000/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your_api_key'
  },
  body: JSON.stringify({
    model: 'llama-local',
    messages: [{ role: 'human', content: 'Explain TypeScript briefly.' }],
    max_tokens: 300,
    temperature: 0.7
  })
});

console.log(await response.json());
```

### Streaming

Add `stream: true` and consume SSE chunks from response body.

## Endpoints

- `POST /v1/chat/completions` - OpenAI Chat Completions compatible endpoint
- `POST /v1/messages` - Claude Messages compatible endpoint
- `GET /v1/models` - list available model IDs
- `GET /health` - liveness and runtime information
- `GET /ready` - readiness probe (`503` until model is loaded)

## Testing and CI

- Unit tests are in `test/`
- GitHub Actions workflow runs typecheck, tests, and build on push/PR

## License

[MIT](https://choosealicense.com/licenses/mit/)

## Author

Dimitry Ivanov <2@ivanoff.org.ua> # curl -A cv ivanoff.org.ua
