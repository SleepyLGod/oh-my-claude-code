---
description: Draft a concrete implementation plan or assess a proposed diff without editing code
argument-hint: [plan, issue, or implementation target]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want a decision-complete implementation plan before any code change. Examples: "/implement-plan-draft issue 42", "/implement-plan-draft add provider selector", "/implement-plan-draft current diff".
---

Draft an implementation plan for:

$ARGUMENTS

Workflow:
1. Restate the goal and success criteria.
2. Establish the target scope from the argument.
3. If the target is an existing diff or branch, base the analysis on the changed files and their direct implications only.
4. Inspect the relevant code paths, types, and nearby behavior within that scope.
5. Treat the current changes as the proposed implementation and assess what is already present before listing any remaining work.
6. Identify the minimum correct set of remaining or proposed changes.
7. Call out edge cases, risks, and verification surfaces.
8. Stop at a concrete implementation plan. Do not edit files.

Rules:
- Do not edit files.
- Prefer the smallest correct change set over redesign.
- If key information is missing, say what is missing instead of guessing.
- Distinguish confirmed repo facts from assumptions.
- Do not describe already-present staged or unstaged changes as future work unless you label them as already present.
- If the target is effectively complete, say so and focus on remaining risks and verification.
- If the target is `current diff`, do not pull in unrelated repository history, nearby features, or previously shipped functionality unless a changed file directly makes them relevant.
- Do not use recent commit history unless the user explicitly asks for it or the diff alone is insufficient to explain the plan.
- If the target is `current diff`, do not mention a file, feature, or behavior unless it is confirmed by the current diff, git status, or direct inspection of a changed file.
- If some changed files were not inspected closely enough to support detail, say that the detail is unknown instead of filling it in from repo memory.
- Separate what is already present from what remains to be done. Do not blur current state into future work.

Response format:
- Goal
- Scope considered
- Current state
- Proposed changes or remaining changes
- Verification plan
- Risks or open questions
