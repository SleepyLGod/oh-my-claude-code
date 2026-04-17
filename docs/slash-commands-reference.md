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
| `/btw` | - | `<question>` | `local-jsx` | `visible` | Ask a side question without interrupting the main thread. |
| `/clear` | `reset`, `new` | - | `local` | `visible` | Clear the current conversation history. |
| `/color` | - | `<color\|default>` | `local-jsx` | `visible` | Set the prompt bar color for the session. |
| `/compact` | - | `<optional custom summarization instructions>` | `local` | `visible` | Compact history into a summary that stays in context. |
| `/config` | `settings` | - | `local-jsx` | `visible` | Open the config panel. |
| `/copy` | - | - | `local-jsx` | `visible` | Copy Claude’s last response to the clipboard. |
| `/context` | - | - | `local` | `visible` | Show current context usage. |
| `/cost` | - | - | `local` | `visible` | Show session cost and duration. |
| `/diff` | - | - | `local-jsx` | `visible` | View uncommitted changes and per-turn diffs. |
| `/doctor` | - | - | `local-jsx` | `visible` | Diagnose installation and settings issues. |
| `/effort` | - | `[low\|medium\|high\|max\|auto]` | `local-jsx` | `visible` | Set model effort level. |
| `/exit` | `quit` | - | `local-jsx` | `visible` | Exit the REPL. |
| `/fast` | - | `[on\|off]` | `local-jsx` | `visible` | Toggle fast mode when supported. |
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

## Restoration and Compatibility Notes

This repository is a modified restored tree. A command being visible in the CLI
means the command object is wired into `getCommands()`, not that every
downstream dependency is the original upstream implementation.

The table below only calls out limitations that are explicit in the current
source tree.

| Command / Area | Current state | Notes |
| --- | --- | --- |
| `/model` | usable, modified | Provider-aware in this fork. Supports switching provider profiles and models, not just Anthropic model aliases. |
| `/login` | usable, modified | The interactive flow now includes Anthropic account login, Claude via supported cloud platforms, and OpenAI-compatible provider profile selection. |
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
| `/teleport` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/ctx_viz` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
| `/env` | `stub` | Declared as `isEnabled: false`, `isHidden: true`. |
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
| `/version` | `local` | `internal` | Print the exact running session version. |

The restored tree also contains additional internal placeholders/stubs beyond
the table above. Those should not be treated as usable commands.

## Notes

- Command availability is dynamic. `getCommands()` filters on auth state, provider requirements, feature flags, and `isEnabled()` callbacks.
- Some descriptions are runtime-dependent. `/model`, `/sandbox`, and fast-mode related commands can vary their text based on the current environment.
- This repository is a restored source tree. A command being listed here means a command object exists and is wired into the CLI, not that every downstream dependency is fully restored.
