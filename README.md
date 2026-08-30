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

<br />

<a href="https://marketplace.visualstudio.com/items?itemName=lewiswigmore.open-wire">
<img src="https://img.shields.io/badge/Install%20on%20VS%20Marketplace-007ACC?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Install on VS Marketplace" />
</a>

</div>

---

## Features

- **OpenAI-compatible.** `/v1/chat/completions` and `/v1/models`, with SSE streaming.
- **Auto-discovery.** Every language model registered in VS Code shows up. No configuration.
- **Tool forwarding.** Send OpenAI-format tools, get `tool_calls` back.
- **Content normalisation.** String content and `type: "text"` parts both flatten to plain text before they reach the VS Code LM API.
- **XML tool call fallback.** Non-streaming responses containing a `<function_calls>` block are converted to `tool_calls`.
- **Rate limiting.** Configurable per-minute request cap.
- **API key auth.** Bearer token authentication enabled by default.
- **Tight CORS defaults.** Browser requests are limited to loopback origins.
- **Zero dependencies.** Node's built-in HTTP server, no Express.

## Models

Any model registered with VS Code's Language Model API is exposed automatically. In practice that means:

- **Claude.** Whatever Anthropic model family/tier is currently registered by an installed extension (e.g. Opus, Sonnet, Haiku)
- **GPT.** Whatever OpenAI model family is currently registered by an installed extension (e.g. GPT and reasoning-tier variants)
- **Gemini.** Whatever Google model family is currently registered by an installed extension (e.g. Pro, Flash)
- **Ollama.** Only when a separate extension registers your local models with VS Code. OpenWire never talks to Ollama directly.
- Anything else registered with the VS Code Language Model API

Call `GET /v1/models` to see what your setup actually exposes.

## Provider compatibility

OpenWire normalises differences between providers so callers get a consistent OpenAI-format response:

| Provider | Content format | Tool calling | Status |
|----------|---------------|-------------|--------|
| **Claude** (Anthropic) | Array of `{"type":"text","text":"..."}` parts | Native via VS Code API, plus an XML `<function_calls>` fallback on non-streaming responses | Supported |
| **GPT** (OpenAI) | Plain string | Native `tool_calls` via VS Code API | Supported |
| **Gemini** (Google) | Plain string, or text parts tagged `type: "text"` | Native via VS Code API | Supported |
| **Ollama** (local) | Plain string | Depends on the model | Only via a VS Code LM provider extension |

**Content normalisation.** Message `content` can be a plain string, `null`, or an array of parts. All three flatten to a plain string before OpenWire calls the VS Code LM API. Parts survive only when they are strings or carry `type: "text"`, so image parts and other non-text parts are dropped.

**Tool call fallback.** A model can answer with a raw XML `<function_calls>` block instead of a native tool call. On non-streaming requests OpenWire parses that block into standard `tool_calls` and strips it from the message content. Streaming requests rely on native tool-call parts, so XML can still reach the client as ordinary text.

## Quick start

Install from the VS Code Marketplace, or load the `.vsix` yourself. The server starts on `http://127.0.0.1:3030` as soon as VS Code loads the extension.

```bash
export OPENWIRE_API_KEY="change-me-openwire-key"

# List available models
curl http://localhost:3030/v1/models \
  -H "Authorization: Bearer $OPENWIRE_API_KEY"

# Chat completion
curl http://localhost:3030/v1/chat/completions \
  -H "Authorization: Bearer $OPENWIRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Streaming
curl http://localhost:3030/v1/chat/completions \
  -H "Authorization: Bearer $OPENWIRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<model-id>",
    "messages": [{"role": "user", "content": "Explain zero-knowledge proofs"}],
    "stream": true
  }'
```

Replace `<model-id>` with any id from `GET /v1/models`. OpenWire matches on model id or family and has no built-in aliases, so an unrecognised name returns a 404 listing what is available.

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
| `apiKey` | `"change-me-openwire-key"` | Bearer token required for authentication (change this locally) |
| `corsAllowedOrigins` | `["http://localhost", "http://127.0.0.1", "http://[::1]"]` | Allowed browser origins for CORS |
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

OpenWire works as a model provider for [OpenClaw](https://openclaw.ai) agents. Register OpenWire as a custom provider called `copilot-proxy` in your `~/.openclaw/openclaw.json`:

```jsonc
{
  "models": {
    "providers": {
      "copilot-proxy": {
        "baseUrl": "http://localhost:3030/v1",
        "apiKey": "change-me-openwire-key",
        "api": "openai-completions",
        "models": [
          {
            "id": "<model-id>",
            "name": "<Display Name>",
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
        "primary": "copilot-proxy/<model-id>"
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

OpenWire requires a Bearer token by default. Set a custom `openWire.server.apiKey` in VS Code and use the same value in OpenClaw.

## Architecture

```
src/
  extension.ts          activation, commands, status bar
  models/
    discovery.ts        model discovery, caching, dedup
  routes/
    chat.ts             chat completions + tool forwarding
  server/
    config.ts           settings loader
    gateway.ts          HTTP server, routing, middleware
  ui/
    sidebar.ts          webview sidebar panel
  types/
    vscode-lm.d.ts      type augmentations
```

## Development

Clone the repo and install dependencies:

```bash
npm install
```

Start esbuild in watch mode, then press F5 in VS Code to launch the Extension
Development Host with OpenWire loaded:

```bash
npm run watch
```

`.vscode/launch.json` has two configurations. "Run Extension" builds once and
launches. "Run Extension (Watch)" starts the watcher for you. Reload the
Development Host window to pick up a rebuild.

| Command | What it does |
| --- | --- |
| `npm run lint` | Type checks with `tsc --noEmit` |
| `npm run test` | Runs the Vitest suite |
| `npm run build` | Bundles `src/` into `dist/extension.js` |
| `npm run package` | Builds a production bundle and writes a local `.vsix` |

`npm run package` fails when `@types/vscode` is newer than `engines.vscode`,
so raising the types version means raising the engine floor too. The reverse
is not checked. Raising `engines.vscode` on its own packages and publishes
without complaint, which leaves the types older than the VS Code version the
extension now claims to support, so bump `@types/vscode` to match by hand.

## Releasing

CI runs lint, build and test on Node 20 and 22, and packages the extension once
on Node 20. The `.vsix` from that run is uploaded as a build artifact, so you
can install a branch build before it ships. It runs on every pull request
whatever base branch it targets, so stacked branches are covered too.

To cut a release:

1. Bump `version` in `package.json` and merge that to `main`.
2. Tag the merge commit as `vX.Y.Z`, matching the version you just set.
3. Push the tag.

The Release workflow checks the tag against the version in `package.json` and
stops if they disagree. It then runs lint, build and test, packages a single
`.vsix`, publishes that exact file to the VS Code Marketplace, and attaches it
to a GitHub release. Publishing needs a `VSCE_PAT` repository secret.

## License

[MIT](LICENSE)
