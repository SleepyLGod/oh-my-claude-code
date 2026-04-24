# LLM Provider Profiles

This restored tree now supports a provider abstraction at the API boundary:

- `anthropic`
- `openai_compat`
- `mock`

The active profile is resolved from:

1. `CLAUDE_CODE_LLM_PROFILE`
2. `settings.json` → `llm.providerProfile`
3. built-in default profile `anthropic`

## Startup Chooser

Interactive startup now separates two different concepts:

- `Claude via 3rd-party cloud`
  - For Claude models on Amazon Bedrock, Microsoft Foundry, or Vertex AI
- `OpenAI-compatible provider`
  - For `openai`, `deepseek`, `qwen`, and any custom `openai_compat` profile

The OpenAI-compatible startup path does not use Claude OAuth. It checks the
selected profile's `apiKeyEnv`, writes `llm.providerProfile`, and continues
when credentials are already present in the environment.

If you already know which provider you want, you can still launch directly:

- `CLAUDE_CODE_LLM_PROFILE=deepseek bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=qwen bun run dev --bare`
- `CLAUDE_CODE_LLM_PROFILE=openai bun run dev --bare`
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
        "defaultModel": "gpt-4.1"
      },
      "deepseek": {
        "type": "openai_compat",
        "baseURL": "https://api.deepseek.com",
        "apiKeyEnv": "DEEPSEEK_API_KEY",
        "defaultModel": "deepseek-v4-pro"
      },
      "qwen": {
        "type": "openai_compat",
        "baseURL": "https://your-qwen-compatible-endpoint/v1",
        "apiKeyEnv": "QWEN_API_KEY",
        "defaultModel": "qwen-plus"
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
- `qwen`

`openai` resolves to:

```json
{
  "type": "openai_compat",
  "baseURL": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

## Current Scope

The new abstraction is intentionally narrow:

- Anthropic remains the reference implementation.
- `AnthropicClient` wraps the existing Anthropic query paths rather than rewriting them.
- `OpenAICompatibleClient` targets Chat Completions style APIs.
- `MockClient` exists for deterministic tests and local development.

Current v1 capabilities for `openai_compat`:

- text generation
- non-stream fallback-style main query execution
- side queries
- tool call mapping through OpenAI-compatible function tools

## Known Limitations

- Anthropic-specific capabilities such as adaptive thinking, beta headers, and other Claude-only request fields remain Anthropic-only.
- The OpenAI-compatible startup chooser is profile-based, not account-login-based. Custom endpoints with non-default headers are still best configured through `/config`.
- The restored tree still has unrelated TypeScript errors outside the provider path, so whole-repo `tsc` is not a clean acceptance signal.
