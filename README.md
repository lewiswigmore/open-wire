<div align="center">

# OpenWire

Expose VS Code language models as an **OpenAI-compatible REST API** on localhost.

One extension. Every model VS Code can see. Standard API. Built for agents.

<br />

<img src="https://img.shields.io/badge/Anthropic-191919?style=for-the-badge&logo=anthropic&logoColor=white" alt="Anthropic" />
<img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge" alt="OpenAI" />
<img src="https://img.shields.io/badge/Google%20Gemini-886FBF?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Google Gemini" />
<img src="https://img.shields.io/badge/Copilot-000?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="GitHub Copilot" />
<img src="https://img.shields.io/badge/Ollama-000?style=for-the-badge&logo=ollama&logoColor=white" alt="Ollama" />

<br /><br />

[![Install from Marketplace](https://img.shields.io/visual-studio-marketplace/v/lewiswigmore.open-wire?label=VS%20Marketplace&style=for-the-badge&logo=visualstudiocode&logoColor=white&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=lewiswigmore.open-wire)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/lewiswigmore.open-wire?style=for-the-badge&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=lewiswigmore.open-wire)

</div>

---

## Features

- **OpenAI-compatible** — `/v1/chat/completions`, `/v1/models` with streaming (SSE)
- **Auto-discovery** — finds every language model registered in VS Code
- **Tool forwarding** — pass OpenAI-format tools, get `tool_calls` back
- **Rate limiting** — configurable per-minute request cap
- **API key auth** — optional Bearer token authentication
- **Zero dependencies** — pure Node.js HTTP, no Express, no frameworks

## Models

Any model available through VS Code's Language Model API is automatically exposed — no configuration needed. This typically includes:

- **Claude** — Opus, Sonnet, Haiku
- **GPT** — Codex, GPT-4.1, o4-mini
- **Gemini** — Gemini Pro, Gemini Flash
- **Ollama** — any locally running Ollama models (Llama, Qwen, DeepSeek, Mistral, etc.)
- Any other models registered via the VS Code Language Model API

Run `GET /v1/models` to see what's available in your setup.

## Quick Start

Install from the VS Code Marketplace (or load the `.vsix`). The server starts automatically on `http://127.0.0.1:3030`.

```bash
# List available models
curl http://localhost:3030/v1/models

# Chat completion
curl http://localhost:3030/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Streaming
curl http://localhost:3030/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Explain zero-knowledge proofs"}],
    "stream": true
  }'
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/v1/models` | List available models |
| `GET` | `/v1/models/:id` | Get specific model |
| `POST` | `/v1/chat/completions` | Chat completion (streaming + non-streaming) |
| `POST` | `/v1/completions` | Legacy completions (mapped to chat) |

## Configuration

All settings live under `openWire.server.*` in VS Code:

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

## Using with OpenClaw

OpenWire can serve as a model provider for [OpenClaw](https://openclaw.ai) agents. Register OpenWire as a custom provider called `copilot-proxy` in your `~/.openclaw/openclaw.json`:

```jsonc
{
  "models": {
    "providers": {
      "copilot-proxy": {
        "baseUrl": "http://localhost:3030/v1",
        "apiKey": "n/a",
        "api": "openai-completions",
        "authHeader": false,
        "models": [
          {
            "id": "claude-sonnet-4.6",
            "name": "Claude Sonnet 4.6",
            "contextWindow": 128000,
            "maxTokens": 8192
          }
          // add any other models from /v1/models
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "copilot-proxy/claude-sonnet-4.6"
      }
    }
  },
  "plugins": {
    "entries": {
      "copilot-proxy": { "enabled": true }
    }
  }
}
```

Set `authHeader: false` since OpenWire handles authentication through VS Code's Copilot session — no API keys are needed. Run `curl http://localhost:3030/v1/models` to see all available model IDs.

## Architecture

```
src/
  extension.ts          — activation, commands, status bar
  models/
    discovery.ts        — model discovery, caching, dedup
  routes/
    chat.ts             — chat completions + tool forwarding
  server/
    config.ts           — settings loader
    gateway.ts          — HTTP server, routing, middleware
  ui/
    sidebar.ts          — webview sidebar panel
  types/
    vscode-lm.d.ts      — type augmentations
```

Lightweight · zero runtime dependencies

## License

[MIT](LICENSE)
