# Remote AI Development Plan

This document describes a practical path for working on code that lives on a remote server while keeping model access, credentials, and the main AI agent runtime on a local machine.

It also defines how this fork should continue aligning with upstream Claude Code and selected ideas from `free-claude-code` without turning the project into a proxy-server or bot-framework clone.

## Goals

- Keep AI model credentials on the local machine.
- Edit remote-server projects through a local mirror that the AI assistant can safely inspect and modify.
- Run build, test, and runtime commands on the real remote server.
- Avoid installing model credentials or full AI coding agents on region-restricted or policy-sensitive servers.
- Preserve a simple first version that can be operated with standard tools: SSH, Mutagen, Git, and this Claude Code fork.
- Leave room for a more integrated remote executor later, only if the simple path proves insufficient.

## Non-Goals

- Do not build a full Claude Code client/server protocol as the first version.
- Do not move API keys to the remote server.
- Do not make the remote server the model-calling side.
- Do not copy `free-claude-code` wholesale.
- Do not introduce a Python proxy, Telegram bot, Discord bot, or separate provider daemon unless a concrete limitation proves it is required.
- Do not sync secrets, dependency directories, build artifacts, caches, or `.git` by default.

## Design Principle

Use the local machine as the AI brain and the remote server as the execution environment.

The local machine owns:

- model credentials
- Claude Code, Codex, or other AI CLI runtimes
- the editable mirror of the remote project
- prompt history and local agent state

The remote server owns:

- source-of-truth runtime behavior
- build/test execution
- local services, databases, GPUs, containers, and platform-specific dependencies
- authoritative deployment environment assumptions

This avoids the worst failure mode: an AI agent running on a remote server that cannot legally or reliably call the intended model provider.

## Recommended Baseline: Mutagen + SSH

The recommended first implementation is:

- Mutagen for bidirectional safe file synchronization.
- SSH for remote command execution.
- A local working mirror for AI edits.
- The remote checkout as the authoritative runtime.

This is deliberately not a custom agent protocol. It uses existing operational primitives first, which makes it easier to debug, easier to trust, and easier to replace later.

## Reference Topology

```text
Local machine, allowed model region
  Claude Code / Codex / local AI tools
  API keys and auth state
  local mirror: ~/RemoteWork/my-repo-hk
            |
            | Mutagen file sync
            | SSH command execution
            v
Remote server, coding/runtime region
  real checkout: /home/von/projects/my-repo
  build/test/runtime dependencies
  containers, databases, GPUs, services
```

## Prerequisites

Required locally:

- `ssh`
- `mutagen`
- `git`
- this Claude Code fork or another local AI coding agent

Required remotely:

- SSH access from the local machine
- a project checkout or an empty target directory
- the actual runtime toolchain for that project

Optional:

- `rsync` for bootstrapping a local mirror from an existing remote tree
- SSH port forwarding for browser-based local inspection of remote services

## Bootstrap Variables

Use explicit variables in shell notes or project docs so the setup is repeatable.

```sh
REMOTE=hk
REMOTE_REPO=/home/von/projects/my-repo
LOCAL_MIRROR="$HOME/RemoteWork/my-repo-hk"
SESSION=my-repo-hk
```

`REMOTE` should be an SSH host alias from `~/.ssh/config`, not a hard-coded host string inside project docs.

## Setup Procedure

### 1. Verify SSH

```sh
ssh "$REMOTE" "pwd && hostname && test -d '$REMOTE_REPO' && echo ok"
```

Do not continue until SSH is stable. File sync will not compensate for unreliable SSH.

### 2. Create The Local Mirror

If the remote repo has a normal Git origin, prefer cloning locally from the same origin and branch:

```sh
mkdir -p "$(dirname "$LOCAL_MIRROR")"
git clone <repo-url> "$LOCAL_MIRROR"
```

If the remote tree is not easily cloneable, bootstrap with `rsync` while excluding heavy and sensitive files:

```sh
mkdir -p "$LOCAL_MIRROR"
rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.venv/' \
  --exclude '.env' \
  --exclude '.env.*' \
  "$REMOTE:$REMOTE_REPO/" \
  "$LOCAL_MIRROR/"
```

### 3. Create A Mutagen Session

Use `two-way-safe` first. It is slower than aggressive modes but safer for interactive AI-assisted editing.

```sh
mutagen sync create \
  --name "$SESSION" \
  --sync-mode two-way-safe \
  --ignore-vcs \
  --ignore 'node_modules/' \
  --ignore '.venv/' \
  --ignore '__pycache__/' \
  --ignore '.next/' \
  --ignore 'dist/' \
  --ignore 'build/' \
  --ignore 'coverage/' \
  --ignore '.cache/' \
  --ignore 'tmp/' \
  --ignore '*.log' \
  --ignore '.DS_Store' \
  --ignore '.env' \
  --ignore '.env.*' \
  "$LOCAL_MIRROR" \
  "$REMOTE:$REMOTE_REPO"
```

### 4. Inspect Sync State

```sh
mutagen sync list
mutagen sync monitor "$SESSION"
```

Before every important remote verification:

```sh
mutagen sync flush "$SESSION"
```

### 5. Run Commands On The Remote Server

The AI agent should edit locally but verify remotely:

```sh
ssh "$REMOTE" "cd '$REMOTE_REPO' && git status --short"
ssh "$REMOTE" "cd '$REMOTE_REPO' && bun test"
ssh "$REMOTE" "cd '$REMOTE_REPO' && npm run build"
```

For long-running dev servers, use a remote terminal, `tmux`, or a dedicated process manager on the server.

## AI Agent Operating Contract

When using Claude Code or Codex from the local mirror, start with an explicit instruction like:

```text
Edit files in this local mirror.
Before running tests or project commands, run:
  mutagen sync flush my-repo-hk
  ssh hk "cd /home/von/projects/my-repo && <command>"

Do not store model API keys on the remote server.
Treat the remote checkout as the runtime authority.
Do not modify remote shell profile, secrets, or service configuration unless I explicitly approve it.
```

For this fork, the same policy should apply to remote-aware custom commands:

- local file edits are allowed in the mirror
- remote reads/searches are allowed through SSH
- remote writes outside the synced repo require explicit approval
- environment changes require explicit approval
- secrets must never be copied into the repo or sync session

## Git Authority Model

Pick one authority model per project.

Recommended first model:

- Remote checkout is the Git authority.
- Local mirror is an edit cache.
- Mutagen does not sync `.git`.
- Commits happen on the remote server after sync and verification.

Alternative model:

- Local mirror is the Git authority.
- Remote server is only an execution target.
- Mutagen still does not sync `.git`.
- Code is pushed from local and pulled remotely, or files are synced only for test execution.

Do not mix both models in the same session. Mixing them makes `git status`, conflict recovery, and rollback ambiguous.

## Synchronization Ignore Policy

Ignore by default:

- `.git/`
- `.env`
- `.env.*`
- dependency directories such as `node_modules/`, `.venv/`, `vendor/bundle/`
- build outputs such as `dist/`, `build/`, `.next/`, `coverage/`
- caches such as `.cache/`, `__pycache__/`
- logs and temp directories
- OS files such as `.DS_Store`

Add project-specific ignores when generated files cause sync churn.

If a generated file is required for remote execution, prefer regenerating it on the remote server rather than syncing it from local.

## Verification Workflow

Use this loop:

1. AI edits local files.
2. Run `mutagen sync flush "$SESSION"`.
3. Inspect remote diff or status.
4. Run the nearest meaningful remote check.
5. Fix locally.
6. Flush again.
7. Re-run remote check.
8. Commit on the chosen Git authority side.

Example:

```sh
mutagen sync flush "$SESSION"
ssh "$REMOTE" "cd '$REMOTE_REPO' && git diff --stat"
ssh "$REMOTE" "cd '$REMOTE_REPO' && bun test src/foo.test.ts"
```

Local tests are only authoritative if the local mirror intentionally matches the remote runtime. Otherwise they are fast smoke checks, not proof.

## Port Forwarding

For browser-based apps, keep the app running remotely and forward the port locally:

```sh
ssh -L 3000:127.0.0.1:3000 "$REMOTE"
```

Then open `http://127.0.0.1:3000` locally.

For multiple services:

```sh
ssh \
  -L 3000:127.0.0.1:3000 \
  -L 8080:127.0.0.1:8080 \
  "$REMOTE"
```

Avoid exposing remote dev services publicly unless the project explicitly requires it.

## Failure Handling

If remote tests see old code:

```sh
mutagen sync flush "$SESSION"
mutagen sync list
ssh "$REMOTE" "cd '$REMOTE_REPO' && git diff --stat"
```

If Mutagen reports conflicts:

- stop editing
- inspect `mutagen sync list`
- choose the local or remote version manually
- flush after resolving
- rerun the remote check

If sync becomes slow:

- find generated files or large directories
- add ignore rules
- recreate the session if the ignore policy changed significantly

If local and remote Git states diverge:

- decide which side is authoritative
- avoid syncing `.git`
- repair with normal Git operations on the authority side

If remote commands require secrets:

- configure secrets on the remote server through its normal secret-management path
- do not sync local `.env` files unless explicitly approved for that project

## Security Boundaries

Hard rules:

- API keys for Claude, OpenAI, DeepSeek, Qwen, Codex, or other model providers stay local unless explicitly approved.
- Remote server shell profiles should not be modified by an AI agent without confirmation.
- SSH config should use aliases; project docs should not embed sensitive hostnames or tokens.
- Sync rules must exclude secrets by default.
- The AI agent should ask before making persistent infrastructure changes.

For shared or production-like servers, use a dedicated remote user or containerized workspace when practical.

## Why Not Run Full Claude Code Remotely?

Running full Claude Code on the remote server is simpler only when the remote server is allowed to call the selected model provider.

When the remote server is region-restricted, policy-restricted, or credential-restricted, full remote Claude Code creates these problems:

- model calls may fail
- API keys must be copied to the server
- local Codex or Claude subscriptions may not be usable
- audit boundaries become unclear
- remote prompts and transcripts may persist where they should not

The Mutagen + SSH approach keeps model interaction local while still using the remote runtime for real verification.

## Future Path: Thin Remote Executor

If Mutagen + SSH is not enough, the next step should be a thin executor, not a full agent server.

A thin executor would provide:

- remote command execution
- remote file read/search helpers
- optional streaming logs
- explicit working-directory binding
- permission checks before writes outside the repo
- no model provider credentials

Possible transports:

- SSH command wrapper
- reverse SSH tunnel
- WebSocket over localhost tunnel
- OpenClaw ACP bridge, if already available in the user's environment

The executor should not own conversation history. The local Claude Code session should remain the session authority.

## Alignment With Upstream Claude Code

Continue tracking upstream concepts that improve this fork directly:

- command surface quality
- context compaction behavior
- session and transcript handling
- memory retrieval and persistence boundaries
- model/provider capability metadata
- terminal UI correctness
- plugin and skill semantics where they are useful

When upstream has Anthropic-specific behavior, preserve that path if it still works, and add compatible provider support next to it rather than replacing it blindly.

Provider-compatible paths should be explicit about what they support:

- text generation
- streaming
- tool calls
- thinking/reasoning blocks
- token usage
- prompt cache usage
- context length
- local endpoint requirements

## Alignment With free-claude-code

`free-claude-code` is useful as a source of implementation ideas, but it has a different architecture.

Borrow selectively:

- provider smoke-test matrix
- provider capability inventory
- OpenAI-compatible and Anthropic-compatible conversion patterns
- thinking/reasoning tag parsing where providers emit `<think>...</think>`
- text fallback tool-call parsing where structured `tool_calls` are absent
- robust streaming error cleanup
- clear skip behavior for missing API keys or missing local endpoints

Do not copy by default:

- full proxy server
- separate bot framework
- Python provider daemon
- Claude CLI subprocess wrapper
- unrelated command surface
- broad rate-limit/concurrency framework before real smoke failures require it

Reasoning:

This fork is already an in-process Claude Code fork. It should improve provider compatibility inside the TypeScript provider layer. Adding another proxy layer makes debugging harder and duplicates state that Claude Code already owns.

## Provider Compatibility Roadmap

Short-term:

- keep DeepSeek and Qwen real smoke tests passing
- keep provider model IDs distinct from local display/context hints
- keep `/login` as a provider profile selector, not a secret manager
- document missing credentials and skipped smoke checks honestly

Medium-term:

- verify OpenRouter, NVIDIA NIM, Ollama, LM Studio, and llama.cpp through `tools/provider-smoke.ts`
- add provider-specific notes only after real smoke results
- harden streaming parser cleanup for malformed events and unclosed content/tool/reasoning blocks
- keep fallback parsers opt-in by condition, not always-on

Long-term:

- consider rate limiting only if provider errors prove it is necessary
- consider concurrency controls only if local or provider backpressure requires it
- consider a proxy only if in-process provider compatibility cannot express a required behavior cleanly

## Remote Development Roadmap

Stage 0: Manual baseline

- Mutagen sync
- SSH remote commands
- local AI edits
- remote verification

Stage 1: Documented project profile

- project-local notes for `REMOTE`, `REMOTE_REPO`, `LOCAL_MIRROR`, and `SESSION`
- standard sync ignores
- standard verification commands
- explicit Git authority choice

Stage 2: Local helper command

- one command to flush sync and run a remote command
- one command to show sync status and remote git status
- no remote model calls
- no secret management

Stage 3: Thin remote executor

- structured remote command API
- streaming logs
- permission policy
- optional file search/read helpers
- still no model credentials remotely

Stage 4: Integrated remote mode

- Claude Code command surface understands the remote profile
- local transcript remains authoritative
- remote execution is explicit and inspectable
- file sync and verification are first-class operations

## Acceptance Criteria

The baseline is successful when:

- local AI can edit the mirror
- Mutagen reliably syncs changes to the remote checkout
- remote tests run against the changed files
- no model API keys are present on the remote server
- Git status is understandable and has one authority
- conflicts are visible instead of silently overwritten
- the workflow is explainable to another engineer in under five minutes

The next stage should not be built until the current stage fails in a specific, reproducible way.

## Daily Cheat Sheet

Start or inspect sync:

```sh
mutagen sync list
mutagen sync monitor "$SESSION"
```

Flush before verification:

```sh
mutagen sync flush "$SESSION"
```

Run remote status:

```sh
ssh "$REMOTE" "cd '$REMOTE_REPO' && git status --short"
```

Run remote tests:

```sh
ssh "$REMOTE" "cd '$REMOTE_REPO' && bun test"
```

Forward a web app:

```sh
ssh -L 3000:127.0.0.1:3000 "$REMOTE"
```

Pause a sync session:

```sh
mutagen sync pause "$SESSION"
```

Resume a sync session:

```sh
mutagen sync resume "$SESSION"
```

Terminate a sync session when the project is done:

```sh
mutagen sync terminate "$SESSION"
```

