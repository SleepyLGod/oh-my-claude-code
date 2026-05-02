# Fork Roadmap

This fork should prefer small, fork-native improvements over broad upstream
feature imitation.

## Current priorities

1. Command surface that matches the fork's real needs
   - `/issue`: local-first issue workflows
   - continue tightening `/context` as the official-aligned context inspector
   - keep `/env` focused on runtime capability and degraded-integration reporting
   - keep `/summary` focused on current-session recovery, not repo-wide status

2. Provider compatibility without proxy sprawl
   - keep API-compatible providers native to this TypeScript tree
   - support OpenAI-compatible and Anthropic-compatible transports where the
     provider documents both
   - avoid routing through extra Python proxy or bot layers unless explicitly needed
   - preserve stable request payloads so provider-side prompt caching is not defeated by local randomness
   - verify provider/model support with real smoke checks before treating a
     model list as complete
   - keep provider proxy, provider-side rate limiting, and concurrency controls
     as explicit TODOs until a real smoke failure shows they are needed

3. Input-system cleanup
   - finish the remaining `handleKeyDown` migration paths
   - remove backward-compat input bridges once the real handlers are wired

4. Honest capability boundaries
   - either implement minimal real versions of memory/context-collapse support
   - or continue to degrade them explicitly instead of implying they are live

## Design constraints

- Do not duplicate `/status`.
  `/env` should focus on runtime facts and capability checks:
  provider profile, model, sandbox, MCP, native integrations, remote-control
  state, and other environment-dependent behavior.

- Do not treat the existing away-summary mechanism as a user command.
  The current recap logic is an internal "while you were away" summary trigger,
  not a complete `/summary` command design.

- Prefer local-first commands.
  New commands should work without private internal services wherever possible.

- Do not expose "fake" commands as complete features.
  If a capability is still degraded or shim-backed, the UI and command output
  should say so clearly.

## Provider TODO

- DeepSeek V4 picker/context cleanup is done: user-facing model lists show the
  local `[1m]` variants while provider smoke checks use the official bare model
  ids. Keep real smoke coverage current across text, streaming, and tool calls.
- Qwen Coding: verify `qwen3.6-plus`, `qwen3.5-plus`, and coder models on both
  OpenAI-compatible and Anthropic-compatible paths.
- OpenRouter, NVIDIA NIM, Ollama, LM Studio, and llama.cpp: keep them as
  OpenAI-compatible profiles until there is a concrete need and documented
  support for another transport. They are now part of the smoke matrix, but
  local profiles still require a running local OpenAI-compatible server.
- Model discovery: `/model` now appends provider `/models` results for profiles
  that opt in via `supportsModelList`; keep the static suggestions as the
  curated safe defaults.
- Anthropic-compatible thinking controls: `[no-thinking]` is a local model
  suffix for provider profiles where thinking may be enabled; it is stripped
  before API requests.
- Provider runtime hardening: proxy support, profile-level rate limits, and
  concurrency controls remain intentionally unimplemented until a concrete
  provider requires them.
- `/cost`: continue separating token usage from dollar cost for subscription
  or local providers.
