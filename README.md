# OpenWire

Expose VS Code language models (GitHub Copilot, Gemini, Ollama, etc.) as an **OpenAI-compatible REST API** on localhost.

One extension. Every model VS Code can see. Standard API. Built for agents.

## Features

- **OpenAI-compatible** — `/v1/chat/completions`, `/v1/models` with streaming (SSE)
- **Auto-discovery** — finds all language models registered in VS Code
- **Tool forwarding** — pass OpenAI-format tools, get tool_calls back
- **Rate limiting** — configurable per-minute request cap
- **API key auth** — optional Bearer token authentication
- **Zero dependencies** — pure Node.js HTTP, no Express, no frameworks

## Quick Start

1. Install from the VS Code Marketplace (or load the `.vsix`)
2. The server starts automatically on `http://127.0.0.1:3030`
3. Use it:

```bash
# List available models
curl http://localhost:3030/v1/models

# Chat completion
curl http://localhost:3030/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'

# Streaming
curl http://localhost:3030/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/v1/models` | List available models |
| GET | `/v1/models/:id` | Get specific model |
| POST | `/v1/chat/completions` | Chat completion (streaming + non-streaming) |
| POST | `/v1/completions` | Legacy completions (mapped to chat) |

## Configuration

All settings are under `openWire.server.*` in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoStart` | `true` | Start server when VS Code launches |
| `host` | `127.0.0.1` | Bind address |
| `port` | `3030` | Port number |
| `apiKey` | `""` | Bearer token for authentication |
| `defaultModel` | `""` | Fallback model when none specified |
| `defaultSystemPrompt` | `""` | Injected system prompt if none present |
| `maxConcurrentRequests` | `4` | Concurrent request limit |
| `rateLimitPerMinute` | `60` | Rate limit |
| `requestTimeoutSeconds` | `300` | Request timeout |
| `enableLogging` | `false` | Verbose logging |

## Commands

- **OpenWire: Start Server**
- **OpenWire: Stop Server**
- **OpenWire: Restart Server**
- **OpenWire: Toggle Server**

## Architecture

```
src/
  extension.ts          — activation, commands, status bar
  models/
    discovery.ts        — model discovery, caching, lookup
  routes/
    chat.ts             — chat completions (streaming + non-streaming)
  server/
    config.ts           — settings loader
    gateway.ts          — HTTP server, routing, middleware
  types/
    vscode-lm.d.ts      — type augmentations for newer VS Code APIs
```

8 source files. 20KB bundled output. Zero runtime dependencies.

## License

[MIT](LICENSE)
