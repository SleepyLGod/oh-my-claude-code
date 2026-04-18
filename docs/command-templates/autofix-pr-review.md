---
description: Triage PR feedback and propose fixes without editing code
argument-hint: [PR number, branch, or review scope]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*), Bash(gh:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want PR feedback triage before any edits. Examples: "/autofix-pr-review 123", "/autofix-pr-review current branch", "/autofix-pr-review unresolved review comments".
---

Review and triage pull request feedback for:

$ARGUMENTS

Workflow:
1. Identify the PR or closest available review target.
2. Gather review comments, requested changes, inline comments, and current diff context when available.
3. Separate actionable issues from preferences, duplicates, and already-resolved items.
4. Group the actionable issues into concrete fix tasks.
5. Propose the verification needed for those fixes.
6. Stop at triage. Do not edit files.

Rules:
- Do not edit files.
- If PR review context is unavailable, fall back to the local diff and say so explicitly.
- If a requested change is ambiguous or conflicts with the codebase, explain the conflict instead of guessing.
- Only call something actionable when the code or review context supports it.

Response format:
- Review target
- Actionable items
- Non-actionable or unclear items
- Verification plan
- Risks or open questions
