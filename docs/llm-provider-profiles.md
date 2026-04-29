# LLM Provider Profiles

This restored tree now supports a provider abstraction at the API boundary:

- `anthropic`
- `openai_compat`
- `anthropic_compat`
- `mock`

The active profile is resolved from:

1. `CLAUDE_CODE_LLM_PROFILE`
2. `settings.json` → `llm.providerProfile`
3. built-in default profile `anthropic`

## Startup Chooser

Interactive startup now separates two different concepts:

- `Claude via 3rd-party cloud`
  - For Claude models on Amazon Bedrock, Microsoft Foundry, or Vertex AI
- `Third-party/API-compatible provider`
  - For `openai_compat` and `anthropic_compat` profiles such as `openai`,
    `deepseek`, `deepseek-anthropic`, `qwen`, `qwen-anthropic`,
    `qwen-coding-openai`, `qwen-coding-anthropic`, `openrouter`,
    `nvidia_nim`, local runtimes, and custom compatible profiles

The API-compatible startup path does not use Claude OAuth. It checks the
selected profile's `apiKeyEnv` plus `apiKeyEnvFallbacks`, writes
`llm.providerProfile`, and continues when credentials are already present in
the environment.

`/login` uses this same API-compatible path as a profile selector. It does not
prompt for or store third-party API keys. Set the provider key in the
environment first, then use `/login` to select the profile. If
`CLAUDE_CODE_LLM_PROFILE` is set, it has the highest priority and locks the
current process to that profile; `/login` will not pretend to switch to a
different profile until you unset the variable or restart with a different
value.

If you already know which provider you want, you can still launch directly:

- `CLAUDE_CODE_LLM_PROFILE=deepseek bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=deepseek-anthropic bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=qwen bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=qwen-coding-anthropic bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=openai bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=openrouter bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=ollama bun run dev --bare`
- `CLAUDE_CONFIG_DIR=~/.von-claude CLAUDE_CODE_LLM_PROFILE=deepseek tools/von-claude --bare`

## Settings Shape

```json
{
  "llm": {
    "providerProfile": "openai",
    "profiles": {
      "openai": {
        "type": "openai_compat",
        "baseURL": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY",
        "defaultModel": "gpt-4.1",
        "includeUsageInStream": true
      },
      "deepseek": {
        "type": "openai_compat",
        "baseURL": "https://api.deepseek.com",
        "apiKeyEnv": "DEEPSEEK_API_KEY",
        "defaultModel": "deepseek-v4-pro[1m]"
      },
      "deepseek-anthropic": {
        "type": "anthropic_compat",
        "baseURL": "https://api.deepseek.com/anthropic",
        "apiKeyEnv": "DEEPSEEK_API_KEY",
        "apiKeyHeader": "x-api-key",
        "defaultModel": "deepseek-v4-pro[1m]"
      },
      "qwen": {
        "type": "openai_compat",
        "baseURL": "https://your-qwen-compatible-endpoint/v1",
        "apiKeyEnv": "QWEN_API_KEY",
        "apiKeyEnvFallbacks": ["DASHSCOPE_API_KEY"],
        "defaultModel": "qwen-plus"
      },
      "qwen-coding-anthropic": {
        "type": "anthropic_compat",
        "baseURL": "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        "apiKeyEnv": "BAILIAN_CODING_PLAN_API_KEY",
        "apiKeyEnvFallbacks": ["DASHSCOPE_CODING_API_KEY", "QWEN_CODING_API_KEY"],
        "apiKeyHeader": "authorization-bearer",
        "defaultModel": "qwen3.6-plus",
        "billingMode": "subscription"
      },
      "ollama": {
        "type": "openai_compat",
        "baseURL": "http://127.0.0.1:11434/v1",
        "requiresApiKey": false,
        "defaultModel": "llama3.1"
      },
      "mock": {
        "type": "mock",
        "defaultModel": "mock-model"
      }
    }
  }
}
```

## Built-in Profiles

Built-in fallback profiles exist for:

- `anthropic`
- `mock`
- `openai`
- `deepseek`
- `deepseek-anthropic`
- `qwen`
- `qwen-anthropic`
- `qwen-coding-openai`
- `qwen-coding-anthropic`
- `openrouter`
- `nvidia_nim`
- `ollama`
- `lmstudio`
- `llamacpp`

| Profile | Base URL | API key env | Notes |
| --- | --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY` | Uses Chat Completions. |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | OpenAI-compatible path; default model is `deepseek-v4-pro[1m]`. DeepSeek's official API model ids are still bare `deepseek-v4-pro` and `deepseek-v4-flash`; the local `[1m]` suffix is only a Claude Code context-window hint and is stripped before the API request. |
| `deepseek-anthropic` | `https://api.deepseek.com/anthropic` | `DEEPSEEK_API_KEY` | Anthropic Messages-compatible path using `x-api-key`; default model is `deepseek-v4-pro[1m]`. DeepSeek's official API model ids are still bare `deepseek-v4-pro` and `deepseek-v4-flash`; the local `[1m]` suffix is stripped before the API request. |
| `qwen` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `QWEN_API_KEY`, fallback `DASHSCOPE_API_KEY` | Beijing endpoint by default. Change `baseURL` for Singapore, US, Hong Kong, or other Model Studio regions. |
| `qwen-anthropic` | `https://dashscope.aliyuncs.com/apps/anthropic` | `QWEN_API_KEY`, fallback `DASHSCOPE_API_KEY` | Anthropic-compatible Qwen path for the normal DashScope API key. |
| `qwen-coding-openai` | `https://coding.dashscope.aliyuncs.com/v1` | `BAILIAN_CODING_PLAN_API_KEY`, fallback `DASHSCOPE_CODING_API_KEY` or `QWEN_CODING_API_KEY` | Coding Plan OpenAI-compatible path. Requires a Coding Plan key, typically `sk-sp-...`; normal `sk-...` DashScope keys do not work here. Subscription/quota billing: token usage is tracked, dollar cost is shown as n/a/zero. |
| `qwen-coding-anthropic` | `https://coding.dashscope.aliyuncs.com/apps/anthropic` | `BAILIAN_CODING_PLAN_API_KEY`, fallback `DASHSCOPE_CODING_API_KEY` or `QWEN_CODING_API_KEY` | Coding Plan Anthropic-compatible path using bearer auth. Requires a Coding Plan key, typically `sk-sp-...`; normal `sk-...` DashScope keys do not work here. Subscription/quota billing: token usage is tracked, dollar cost is shown as n/a/zero. |
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | Default model is `openrouter/auto`; concrete model ids vary by OpenRouter catalog. |
| `nvidia_nim` | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY`, fallback `NVIDIA_NIM_API_KEY` | Uses OpenAI-compatible Chat Completions. |
| `ollama` | `http://127.0.0.1:11434/v1` | none | Requires a local Ollama server and a pulled model. |
| `lmstudio` | `http://127.0.0.1:1234/v1` | none | Requires LM Studio local server; set the model id to the loaded model. |
| `llamacpp` | `http://127.0.0.1:8080/v1` | none | Requires `llama-server`; set the model id to the served model alias. |

`openai` resolves to:

```json
{
  "type": "openai_compat",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

Local OpenAI-compatible runtimes can disable bearer-token authentication with:

```json
{
  "type": "openai_compat",
  "baseURL": "http://127.0.0.1:11434/v1",
  "requiresApiKey": false,
  "defaultModel": "llama3.1"
}
```

Suggested models are intentionally not exhaustive. Use `/model <profile>:<model>`
for any provider model id that is not listed in the picker, for example:

```text
/model qwen:qwen3.5-plus
/model qwen-coding-anthropic:qwen3.6-plus
/model deepseek-anthropic:deepseek-v4-flash[1m]
/model openrouter:anthropic/claude-sonnet-4.5
/model lmstudio:your-loaded-model-id
```

## Current Scope

The new abstraction is intentionally narrow:

- Anthropic remains the reference implementation.
- `AnthropicClient` wraps the existing Anthropic query paths rather than rewriting them.
- `OpenAICompatibleClient` targets Chat Completions style APIs.
- `AnthropicCompatibleClient` targets provider-hosted Anthropic Messages style APIs.
- `MockClient` exists for deterministic tests and local development.

Current v1 capabilities for `openai_compat`:

- text generation
- streaming main query execution for profiles that do not set `streaming: "disabled"`
- side queries
- tool call mapping through OpenAI-compatible function tools, including streamed tool-use deltas
- DeepSeek-style `reasoning_content` mapping into Claude Code thinking blocks
- prompt-cache hit/miss usage accounting when the provider returns compatible usage fields

Current v1 capabilities for `anthropic_compat`:

- text generation through `/v1/messages`
- streaming main query execution
- side queries
- Anthropic-style tool schema and streamed `tool_use` reconstruction
- token usage accounting when the provider returns Anthropic-compatible usage

The fork does not route OpenAI-compatible traffic through the `free-claude-code`
Python proxy. It borrows provider compatibility ideas natively inside the
TypeScript provider layer so existing `/model`, `/cost`, `/env`, session, and
OpenClaw behavior stay in one process.

## Real Smoke Checks

Use `tools/provider-smoke.ts` for live provider validation. It does not print
API keys.

```bash
DEEPSEEK_API_KEY=... QWEN_API_KEY=... BAILIAN_CODING_PLAN_API_KEY=... bun tools/provider-smoke.ts
bun tools/provider-smoke.ts --profile=deepseek-anthropic --all-models
bun tools/provider-smoke.ts --profile=qwen-coding-anthropic --all-models
```

The smoke runner checks text, streaming, and forced tool-call behavior for each
selected profile/model pair. It is intentionally separate from unit tests
because it spends real provider quota and depends on network availability.
For DeepSeek, the smoke runner uses the provider's official bare model ids; the
user-facing `/model` picker shows `[1m]` variants only to make local context
accounting explicit.

## Known Limitations

- Anthropic-specific capabilities such as adaptive thinking, beta headers, and other Claude-only request fields remain Anthropic-only.
- The API-compatible startup chooser is profile-based, not account-login-based. Custom endpoints with non-default headers are still best configured through `/config`.
- `anthropic_compat` is implemented for providers that document an Anthropic Messages-compatible endpoint. OpenRouter, NVIDIA NIM, Ollama, LM Studio, and llama.cpp remain OpenAI-compatible profiles here until there is a concrete need to add another transport.
- Compatible providers do not all support Anthropic prompt-cache control blocks. The provider paths avoid random prompt mutation, but cache behavior still depends on the provider's API.
- Streaming cost accounting requires provider usage chunks. Built-in cloud profiles request them when known to be supported; local runtimes may stream without usage totals.
- Qwen Coding Plan uses subscription/quota billing. This fork records token usage but does not convert those tokens into dollar cost for the Coding Plan profiles.
- The restored tree still has unrelated TypeScript errors outside the provider path, so whole-repo `tsc` is not a clean acceptance signal.
