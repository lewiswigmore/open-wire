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
- **Enforced JSON mode.** `response_format` is honoured server-side: strict instruction, JSON recovery from prose, schema validation, and a bounded repair retry.
- **Sampling controls.** `temperature`, `top_p`, `max_tokens`, `stop`, `seed` and penalties are forwarded to the model.
- **Image input.** OpenAI `image_url` parts reach vision-capable models (VS Code 1.125+).
- **No silent no-ops.** Anything OpenWire cannot honour is rejected or reported back in the response. `GET /v1/capabilities` states what this build supports.
- **Tool forwarding.** Send OpenAI-format tools, get `tool_calls` back, with full `tool_choice` support.
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

| Provider | Content format | Tool calling | Image input | Status |
|----------|---------------|-------------|-------------|--------|
| **Claude** (Anthropic) | Array of `{"type":"text","text":"..."}` parts | Native via VS Code API, plus an XML `<function_calls>` fallback on non-streaming responses | Vision models | Supported |
| **GPT** (OpenAI) | Plain string | Native `tool_calls` via VS Code API | Vision models | Supported |
| **Gemini** (Google) | Plain string, or text parts tagged `type: "text"` | Native via VS Code API | Vision models | Supported |
| **Ollama** (local) | Plain string | Depends on the model | Depends on the model | Only via a VS Code LM provider extension |

Image input additionally requires VS Code 1.125 or newer, whatever the provider.

**Content normalisation.** Message `content` can be a plain string, `null`, or an array of
parts. Text parts flatten to a plain string. `image_url` parts are carried through as binary
image data rather than dropped. Unsupported part types (`input_audio`, `file`) are rejected
with a 400 instead of being silently discarded.

**Tool call fallback.** A model can answer with a raw XML `<function_calls>` block instead of
a native tool call. On non-streaming requests OpenWire parses that block into standard
`tool_calls` and strips it from the message content. Streaming requests rely on native
tool-call parts, so an XML block can still reach the client as ordinary text.

## Request parameters

OpenWire never accepts a parameter it does not honour. Every field lands in one of three
buckets, and `GET /v1/capabilities` reports the split for the running build.

| Bucket | Behaviour | Fields |
|--------|-----------|--------|
| **Honoured** | Forwarded to the model or handled by OpenWire | `model`, `messages`, `prompt`, `stream`, `stream_options`, `tools`, `tool_choice`, `response_format`, `temperature`, `top_p`, `max_tokens`, `max_completion_tokens`, `stop`, `seed`, `presence_penalty`, `frequency_penalty` |
| **Rejected** | `400`, because honouring them partially would be misleading | `n` greater than 1, out-of-range sampling values, unsupported `response_format.type`, unsupported JSON Schema keywords, remote image URLs |
| **Reported** | Accepted, but listed under `x_openwire.unsupported_params` in the response | `logprobs`, `top_logprobs`, `logit_bias`, `user`, `parallel_tool_calls`, `store`, `metadata`, `service_tier`, and other OpenAI fields with no VS Code equivalent |

Set `openWire.server.strictParams` to `true` to turn the third bucket into `400`s as well.
That is the right setting for agents that need a hard guarantee about what was applied.

Invalid values are rejected rather than clamped. `temperature: 9` returns a `400`; it does
not quietly become `2`.

## JSON mode

The VS Code Language Model API has no provider-level JSON mode, so OpenWire enforces
`response_format` itself:

1. A strict instruction is appended to the conversation.
2. The reply is parsed. JSON is recovered even when wrapped in prose or ```json fences.
3. For `json_schema`, the value is validated against the schema.
4. On failure, OpenWire retries once with a harsher instruction that quotes the bad output.
5. If it still cannot produce valid JSON it returns **502**. It never returns prose that
   claims to be JSON.

```bash
curl http://localhost:3030/v1/chat/completions \
  -H "Authorization: Bearer $OPENWIRE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Rate this repo out of 10"}],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "rating",
        "schema": {
          "type": "object",
          "required": ["score"],
          "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 10}}
        }
      }
    }
  }'
```

**Supported schema keywords.** `type`, `enum`, `const`, `required`, `properties`,
`additionalProperties`, `items`, `minimum`, `maximum`, `minLength`, `maxLength`,
`minItems`, `maxItems`. Annotations such as `title` and `description` are ignored. Anything
else (`$ref`, `allOf`, `anyOf`, `oneOf`, `patternProperties`) returns a `400` rather than
being accepted and left unenforced.

**Streaming.** Validity cannot be judged mid-stream, so a JSON-mode request with
`stream: true` buffers the reply, enforces the contract, then emits it as a single content
delta followed by `[DONE]`. The SSE contract is preserved; the token-by-token behaviour is not.

## Images

Vision requests use the standard OpenAI content-part shape:

```jsonc
{
  "model": "claude-sonnet-4.6",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What is in this screenshot?"},
      {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KG..."}}
    ]
  }]
}
```

- **Base64 `data:` URIs only.** Remote `http(s)` image URLs return a `400`. OpenWire will not
  fetch a URL on your behalf, because that would let any caller drive requests from your
  machine into your own network.
- **Supported types.** `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- **Requires VS Code 1.125 or newer**, where `LanguageModelDataPart` reached the stable API.
  On older builds an image request returns `501` rather than silently dropping the image.
  Check `image_input.supported` in `GET /v1/capabilities`.
- Image payloads are large, so the request body limit defaults to 10 MB
  (`openWire.server.maxRequestBodyMb`).

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
| `GET` | `/v1/capabilities` | What this build honours, rejects and ignores |
| `POST` | `/v1/chat/completions` | Chat completion (streaming + non-streaming) |
| `POST` | `/v1/completions` | Legacy completions, returned in `text_completion` shape |

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
| `strictParams` | `false` | Reject parameters OpenWire cannot honour instead of reporting them |
| `jsonModeMaxRetries` | `1` | Repair attempts when `response_format` requires JSON |
| `maxRequestBodyMb` | `10` | Maximum request body size, raised from 1 MB for image input |
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
    chat.ts             vscode binding + orchestration
    content.ts          message/content normalisation, image parts
    params.ts           sampling params, capability classification
    json-mode.ts        response_format enforcement
    schema.ts           JSON Schema subset validator
    tool-calls.ts       tool mapping, tool_choice, XML fallback
    legacy.ts           text_completion shape for /v1/completions
    errors.ts           RequestError with an HTTP status
  server/
    config.ts           settings loader
    gateway.ts          HTTP server, routing, middleware
  ui/
    sidebar.ts          webview sidebar panel
  test/
    vscode-mock.ts      in-memory vscode stand-in for tests
    gateway.test.ts     end-to-end HTTP tests
  types/
    vscode-lm.d.ts      type augmentations

Everything under `routes/` except `chat.ts` is free of `vscode` imports, so it is unit
tested directly. `gateway.test.ts` runs the real server over HTTP against a mocked
`vscode` module, aliased in `vitest.config.ts`.
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
