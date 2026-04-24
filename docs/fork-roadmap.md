# Fork Roadmap

This fork should prefer small, fork-native improvements over broad upstream
feature imitation.

## Current priorities

1. Command surface that matches the fork's real needs
   - `/issue`: local-first issue workflows
   - continue tightening `/context` as the official-aligned context inspector
   - keep `/env` focused on runtime capability and degraded-integration reporting
   - keep `/summary` focused on current-session recovery, not repo-wide status

2. Input-system cleanup
   - finish the remaining `handleKeyDown` migration paths
   - remove backward-compat input bridges once the real handlers are wired

3. Honest capability boundaries
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
