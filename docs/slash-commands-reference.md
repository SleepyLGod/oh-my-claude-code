# Slash Commands Reference

This document describes the slash commands currently exposed by the restored CLI.

Status notes:

- `visible`: shown in normal help and available in the current external build
- `hidden`: implemented but intentionally hidden from normal help
- `internal`: only present in internal/ant builds, or restored as stubs
- `gated`: only appears when a feature flag, auth mode, or environment condition enables it

Command kinds:

- `local`: executes locally without generating a prompt
- `local-jsx`: opens a local interactive panel or UI flow
- `prompt`: expands into a prompt/skill request handled by the model

Invocation format:

```text
/command
/command arg
/command arg1 arg2
```

## Built-in Commands

The table below reflects the runtime-visible commands returned by `getCommands()` after bundled skills are registered in the current restored external build.

| Command | Aliases | Args | Kind | Status | Description |
| --- | --- | --- | --- | --- | --- |
| `/update-config` | - | - | `prompt` | `visible` | Configure Claude Code via `settings.json`, including hooks, permissions, env vars, and related troubleshooting. |
| `/debug` | - | `[issue description]` | `prompt` | `visible` | Enable debug logging and inspect the current session’s debug log. |
| `/simplify` | - | - | `prompt` | `visible` | Review changed code for reuse, quality, and efficiency, then fix issues found. |
| `/batch` | - | `<instruction>` | `prompt` | `visible` | Plan and execute large-scale parallel work across many isolated worktree agents. |
| `/add-dir` | - | `<path>` | `local-jsx` | `visible` | Add another working directory to the current session. |
| `/agents` | - | - | `local-jsx` | `visible` | Manage configured agents. |
| `/branch` | `fork` | `[name]` | `local-jsx` | `visible` | Fork the conversation into a new branch. |
| `/buddy` | - | `[status\|hatch\|pet\|mute\|unmute]` | `local` | `visible` | Manage the local companion pet in this fork. |
| `/btw` | - | `<question>` | `local-jsx` | `visible` | Ask a side question without interrupting the main thread. |
| `/clear` | `reset`, `new` | - | `local` | `visible` | Clear the current conversation history. |
| `/color` | - | `<color\|rainbow\|default>` | `local-jsx` | `visible` | Set the prompt bar color for the session. |
| `/compact` | - | `<optional custom summarization instructions>` | `local` | `visible` | Compact history into a summary that stays in context. |
| `/config` | `settings` | - | `local-jsx` | `visible` | Open the config panel. |
| `/copy` | - | - | `local-jsx` | `visible` | Copy Claude’s last response to the clipboard. |
| `/context` | - | - | `local` | `visible` | Show current context usage. |
| `/cost` | - | - | `local` | `visible` | Show session cost and duration. |
| `/diff` | - | - | `local-jsx` | `visible` | View uncommitted changes and per-turn diffs. |
| `/doctor` | - | - | `local-jsx` | `visible` | Diagnose installation and settings issues. |
| `/effort` | - | `[low\|medium\|high\|max\|auto]` | `local-jsx` | `visible` | Set model effort level. |
| `/env` | - | - | `local-jsx` | `visible` | Inspect the current runtime environment, capability state, and degraded integrations. |
| `/exit` | `quit` | - | `local-jsx` | `visible` | Exit the REPL. |
| `/fast` | - | `[on\|off]` | `local-jsx` | `visible` | Toggle fast mode when supported. |
| `/files` | - | - | `local` | `visible` | List the files currently loaded into context. |
| `/help` | - | - | `local-jsx` | `visible` | Show help and command listings. |
| `/ide` | - | `[open]` | `local-jsx` | `visible` | Manage IDE integrations and show status. |
| `/init` | - | - | `prompt` | `visible` | Generate a `CLAUDE.md` file for the repo. |
| `/install-github-app` | - | - | `local-jsx` | `visible` | Set up Claude GitHub Actions for a repository. |
| `/mcp` | - | `[enable\|disable [server-name]]` | `local-jsx` | `visible` | Manage MCP servers. |
| `/memory` | - | - | `local-jsx` | `visible` | Edit Claude memory files. |
| `/mobile` | `ios`, `android` | - | `local-jsx` | `visible` | Show a QR code for the Claude mobile app. |
| `/model` | - | `[profile[:model]\|model]` | `local-jsx` | `visible` | Set the active provider profile and model. |
| `/plugin` | `plugins`, `marketplace` | - | `local-jsx` | `visible` | Manage Claude Code plugins. |
| `/pr-comments` | - | - | `prompt` | `visible` | Pull GitHub PR comments into the current session. |
| `/release-notes` | - | - | `local` | `visible` | Show release notes. |
| `/reload-plugins` | - | - | `local` | `visible` | Activate pending plugin changes in the current session. |
| `/rename` | - | `[name]` | `local-jsx` | `visible` | Rename the current conversation. |
| `/resume` | `continue` | `[conversation id or search term]` | `local-jsx` | `visible` | Resume a previous conversation. |
| `/skills` | - | - | `local-jsx` | `visible` | List available skills. |
| `/stats` | - | - | `local-jsx` | `visible` | Show usage statistics and activity. |
| `/status` | - | - | `local-jsx` | `visible` | Show overall Claude Code status, model, account, connectivity, and tool state. |
| `/statusline` | - | - | `prompt` | `visible` | Set up the status line UI. |
| `/stickers` | - | - | `local` | `visible` | Order Claude Code stickers. |
| `/summary` | - | `[short\|long]` | `local` | `visible` | Summarize the current session’s task, current progress, and next step. |
| `/theme` | - | - | `local-jsx` | `visible` | Change the theme. |
| `/feedback` | `bug` | `[report]` | `local-jsx` | `visible` | Submit product feedback. |
| `/review` | - | - | `prompt` | `visible` | Review a pull request or pending change set. |
| `/rewind` | `checkpoint` | - | `local` | `visible` | Restore code and/or conversation to an earlier point. |
| `/security-review` | - | - | `prompt` | `visible` | Perform a security review of pending branch changes. |
| `/insights` | - | - | `prompt` | `visible` | Generate a session analysis report. |
| `/vim` | - | - | `local` | `visible` | Toggle Vim editing mode. |
| `/permissions` | `allowed-tools` | - | `local-jsx` | `visible` | Manage allow/deny tool permission rules. |
| `/plan` | - | `[open\|<description>]` | `local-jsx` | `visible` | Enable plan mode or inspect the current plan. |
| `/hooks` | - | - | `local-jsx` | `visible` | View hook configuration. |
| `/export` | - | `[filename]` | `local-jsx` | `visible` | Export the current conversation. |
| `/sandbox` | - | `exclude "command pattern"` | `local-jsx` | `visible` | Show or adjust sandbox settings. |
| `/logout` | - | - | `local-jsx` | `visible` | Sign out from Anthropic. |
| `/login` | - | - | `local-jsx` | `visible` | Open the account/provider sign-in flow. |
| `/tasks` | `bashes` | - | `local-jsx` | `visible` | List and manage background tasks. |
| `/tag` | - | `<tag-name>` | `local-jsx` | `visible` | Toggle a searchable tag on the current session. |
| `/version` | - | - | `local` | `visible` | Print the exact version of the running session. |

## Bundled Skills

Bundled skills are slash-invocable prompt helpers registered at startup.

| Command | Args | Status | Description |
| --- | --- | --- | --- |
| `/update-config` | - | `visible` | Settings and hook configuration helper. |
| `/debug` | `[issue description]` | `visible` | Session debug-log investigation helper. |
| `/simplify` | - | `visible` | Review changed code and simplify/fix issues. |
| `/batch` | `<instruction>` | `visible` | Large parallel multi-worktree change execution. |
| `/verify` | - | `gated` | Internal-only verification skill for running the app and checking a change end to end. |
| `/keybindings-help` | - | `gated` | Keybinding help skill. |
| `/remember` | - | `gated` | Memory capture helper. |
| `/stuck` | - | `gated` | Recovery helper for when the session is stuck. |
| `/skillify` | `[description of the process you want to capture]` | `gated` | Turn a repeated process into a reusable skill. |
| `/lorem-ipsum` | `[token_count]` | `gated` | Generate placeholder content. |
| `/claude-api` | - | `gated` | Claude API app-building helper. |
| `/claude-in-chrome` | - | `gated` | Claude in Chrome integration helper. |
| `/loop` | `[interval] <prompt>` | `gated` | Repeated or scheduled prompt execution. |
| `/schedule` | - | `gated` | Schedule remote agents. |
| `/dream` | - | `gated` | Kairos/Dream background-memory helper. |
| `/hunter` | - | `gated` | Review-artifact helper. |

## Hidden Commands

These commands are implemented in the restored external build but hidden from normal help.

| Command | Kind | Notes |
| --- | --- | --- |
| `/heapdump` | `local` | Dump the JS heap to `~/Desktop`. |
| `/output-style` | `local-jsx` | Deprecated. Use `/config` instead. |
| `/terminal-setup` | `local-jsx` | Hidden when the terminal already supports the required key binding behavior. |
| `/passes` | `local-jsx` | Invite/share-a-week flow. |

Other commands such as `/session`, `/remote-control`, `/voice`, `/desktop`, `/advisor`, `/context` non-interactive variants, and several bridge/remote helpers are implemented in source but are feature-gated, auth-gated, environment-gated, or hidden by current runtime conditions, so they do not appear in the standard external command list above.

## Gated Commands

These commands are implemented in the tree but only appear when account type,
provider, runtime mode, feature flags, or platform support allow them.

| Command | Kind | Status | Notes |
| --- | --- | --- | --- |
| `/advisor` | `local` | `gated` | Available only when advisor support is enabled for the current Anthropic-compatible setup. |
| `/desktop` | `local-jsx` | `gated` | Claude Desktop handoff. Requires `claude-ai` availability and a supported desktop platform. |
| `/extra-usage` | `local-jsx` / `local` | `gated` | Extra-usage provisioning UI and non-interactive variant. Only available when overage provisioning is allowed. |
| `/install-slack-app` | `local` | `gated` | Slack app installation flow. Requires `claude-ai` availability. |
| `/keybindings` | `local` | `gated` | Opens the user keybindings file when keybinding customization is enabled. |
| `/privacy-settings` | `local-jsx` | `gated` | Consumer privacy controls UI. Requires a qualifying subscriber account. |
| `/remote-env` | `local-jsx` | `gated` | Configure the default remote environment. Requires remote-session policy access. |
| `/session` | `local-jsx` | `gated` | Shows the remote session URL and QR code. Only appears in remote mode. |
| `/upgrade` | `local-jsx` | `gated` | Upgrade flow for Claude subscription plans. Requires `claude-ai` availability. |
| `/usage` | `local-jsx` | `gated` | Usage limits/settings UI. Requires `claude-ai` availability. |
| `/voice` | `local` | `gated` | Voice mode toggle. Requires the feature gate and supported voice runtime conditions. |

## Restoration and Compatibility Notes

This repository is a modified restored tree. A command being visible in the CLI
means the command object is wired into `getCommands()`, not that every
downstream dependency is the original upstream implementation.

The table below only calls out limitations that are explicit in the current
source tree.

| Command / Area | Current state | Notes |
| --- | --- | --- |
| `/model` | usable, modified | Provider-aware in this fork. Supports switching provider profiles and models, not just Anthropic model aliases. |
| `/login` | usable, modified | The interactive flow now includes Anthropic account login, Claude via supported cloud platforms, and API-compatible provider profile selection for OpenAI-compatible and Anthropic-compatible profiles. |
| `/buddy` | usable, modified | Fork-specific local command that exposes the existing companion subsystem. Hatch, pet, and mute state are local and deterministic; no model call is used. |
| `/mcp` | usable as a manager | The management UI is present, but some specific MCP backends in this tree are restored compatibility shims rather than original implementations. |
| `/chrome` | partial | The Claude in Chrome MCP backend is a restored compatibility shim. Browser actions are explicitly unavailable in this workspace. |
| `computer-use` integrations | partial | The Computer Use MCP stack preserves tool wiring and permission flows, but native desktop execution is explicitly unavailable or reduced in the restored shims. |
| `/voice` | environment-dependent | Voice mode depends on native audio capture. On Linux it can fall back to `rec` or `arecord`; otherwise it requires the native module to load successfully. |
| deep link handling | environment-dependent | macOS URL event handling depends on `url-handler-napi`. If the native module is unavailable, the handler returns `null`. |
| modifier-key detection | environment-dependent | Modifier state detection depends on `modifiers-napi`. If the native module is unavailable, it degrades to empty or `false` results. |

## Restored Stub Commands

The restored tree still contains several command names that resolve to
intentional stubs. These should not be treated as usable features.

| Command | Status | Notes |
| --- | --- | --- |
| `/autofix-pr` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/issue` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/backfill-sessions` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/teleport` | `stub` | Official Claude Code uses this to pull a Claude Code on the web session into the local terminal. This fork keeps the command disabled. |
| `/break-cache` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/perf-issue` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/reset-limits` | `stub` | Exported as a disabled hidden stub for both interactive and non-interactive variants. |

## Internal Commands

These are declared in `INTERNAL_ONLY_COMMANDS` and are only available in internal/ant builds or restored selectively.

| Command | Kind | Status | Description |
| --- | --- | --- | --- |
| `/commit` | `prompt` | `internal` | Create a git commit. |
| `/commit-push-pr` | `prompt` | `internal` | Commit, push, and open a pull request. |
| `/init-verifiers` | `prompt` | `internal` | Create verifier skills for automated change verification. |
| `/bridge-kick` | `local` | `internal` | Inject bridge failure states for recovery testing. |

The restored tree also contains additional internal placeholders/stubs beyond
the table above. Those should not be treated as usable commands.

## Notes

- Command availability is dynamic. `getCommands()` filters on auth state, provider requirements, feature flags, and `isEnabled()` callbacks.
- Some descriptions are runtime-dependent. `/model`, `/sandbox`, and fast-mode related commands can vary their text based on the current environment.
- This repository is a restored source tree. A command being listed here means a command object exists and is wired into the CLI, not that every downstream dependency is fully restored.
- This repository also ships non-active reference templates for a user command pack under `docs/command-templates/`. The active copies for this fork are intended to live in `~/.von-claude/commands/`, not `.claude/commands/`, to avoid name collisions between user and project custom commands.

## User Command Pack

This fork also uses a user-level custom command pack outside the repository:

- Active fork user commands: `~/.von-claude/commands/`
- Project reference templates: `docs/command-templates/`

The repository copies are documentation templates only. They are not meant to
be activated alongside same-name user commands, because user-level and
project-level custom commands can shadow each other.

To sync the current template pack into `~/.von-claude/commands/`, run:

```bash
./docs/command-templates/sync-active-commands.sh
```

The pack is intentionally split into:

- read-only analysis commands
- explicit mutation commands

This follows the official Claude Code guidance to separate exploration and
planning from implementation, instead of relying on prompt wording like "do
not edit yet" inside a mutation-oriented command.

All commands in the pack are intended to be `disable-model-invocation: true`,
so they run only when the user explicitly invokes them.

### Read-only commands

These commands are designed to diagnose, review, summarize, or plan without
editing files. Heavy commands should run in a forked context with a read-only
agent such as `Explore`.

| Command | Purpose |
| --- | --- |
| `/summarize-diff` | Summarize the current diff for status, commit, PR, or changelog use. |
| `/codebase-map` | Map a subsystem, its files, flow, and likely change points. |
| `/hard-review` | Perform a findings-first review without editing files. |
| `/deep-debug` | Diagnose a bug to a likely root cause and proposed fix without editing. |
| `/test-focus` | Choose and run the smallest meaningful verification without editing files. |
| `/implement-plan-draft` | Draft a concrete implementation plan without editing files. |
| `/refactor-safely-analyze` | Define a safe refactor boundary and verification plan without editing. |
| `/autofix-pr-review` | Triage PR feedback and propose fixes without editing. |

### Mutation commands

These commands are the only commands in the pack that are intended to modify
code. They should use explicit mutation-oriented names and must report concrete
verification.

| Command | Purpose |
| --- | --- |
| `/deep-fix` | Apply the smallest correct fix for a diagnosed issue and verify it. |
| `/implement-plan` | Implement a scoped, already-clear plan and verify it. |
| `/refactor-safely` | Perform a behavior-preserving refactor and verify it. |
| `/autofix-pr` | Apply actionable PR-review fixes and verify them. |

If you want to reuse one of the templates as a project-specific active command,
copy it into `.claude/commands/` and rename it or adapt its semantics so it
does not collide with an active command of the same name in `~/.von-claude/commands/`.
