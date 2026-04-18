# Command Templates

This directory contains project-side reference templates for a user-first command pack.

Important distinction:

- Active personal commands live in `~/.claude/commands/`
- Files in this directory are documentation templates only

The command pack is intentionally split into:

- read-only analysis commands
- explicit mutation commands

This mirrors the official Claude Code guidance to separate exploration and planning from implementation. The goal is stability first: a command that is meant to diagnose, review, or plan should not rely on prompt wording alone to avoid edits.

Why not place the same files in `.claude/commands/`?

- Claude Code supports both user-level and project-level custom commands.
- If the same command names are active at both levels, they can shadow or conflict with each other.
- This repository therefore keeps shareable copies in `docs/command-templates/` and leaves the active versions in the user scope.

Recommended usage:

1. Keep your primary versions in `~/.claude/commands/`
2. Use the files here as reference or seed templates
3. If you want project-specific active versions, copy a template into `.claude/commands/` and rename it or adapt the semantics so it does not collide with your user-level command of the same name

Sync helper:

- `sync-active-commands.sh` copies the repo templates into `~/.claude/commands/` for the current user
- Review the template diffs first, then run the script explicitly when you want the user-level active commands updated
- The script only updates files that already exist in this template pack

Read-only templates:

- `summarize-diff.md`
- `codebase-map.md`
- `hard-review.md`
- `deep-debug.md`
- `test-focus.md`
- `implement-plan-draft.md`
- `refactor-safely-analyze.md`
- `autofix-pr-review.md`

Mutation templates:

- `deep-fix.md`
- `implement-plan.md`
- `refactor-safely.md`
- `autofix-pr.md`
