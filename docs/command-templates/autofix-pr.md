---
description: Triage and address actionable pull request review feedback
argument-hint: [PR number, branch, or review scope]
disable-model-invocation: true
allowed-tools: Read, Edit, MultiEdit, Grep, Glob, LS, Bash(*)
context: fork
agent: general-purpose
model: inherit
when_to_use: Use when you want to address PR review comments or requested changes. Examples: "/autofix-pr 123", "/autofix-pr current branch", "/autofix-pr unresolved review comments".
---

Address pull request feedback for:

$ARGUMENTS

Workflow:
1. Identify the PR or closest available review target.
2. Gather review comments, requested changes, inline comments, and current diff context when available.
3. Separate actionable issues from preference-only comments, duplicates, and already-resolved items.
4. Group the remaining issues into concrete fix tasks.
5. Implement the highest-value fixes directly in code.
6. Run the closest useful verification after meaningful changes.
7. Summarize what was addressed, what remains open, and why.

Rules:
- Prioritize correctness, regressions, security, and missing tests.
- Do not silently change unrelated code.
- If PR review context is unavailable, fall back to the local diff and say so explicitly.
- If a requested change is ambiguous or conflicts with reality in the codebase, explain the conflict instead of guessing.
- Do not claim comments are addressed unless the resulting code actually does it.
- Do not claim readiness for commit unless verification actually ran.

Response format:
- Addressed items
- Remaining items
- Verification
- Risks or open questions
