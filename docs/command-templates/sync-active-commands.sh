#!/bin/zsh
set -euo pipefail

repo_dir="/Users/von/Projects/claude-code/docs/command-templates"
target_dir="${CLAUDE_CONFIG_DIR:-$HOME/.von-claude}/commands"

mkdir -p "$target_dir"

for name in \
  summarize-diff.md \
  codebase-map.md \
  hard-review.md \
  deep-debug.md \
  test-focus.md \
  implement-plan-draft.md \
  refactor-safely-analyze.md \
  autofix-pr-review.md \
  deep-fix.md \
  implement-plan.md \
  refactor-safely.md \
  autofix-pr.md
do
  cp "$repo_dir/$name" "$target_dir/$name"
done

echo "Synced command templates to $target_dir"
