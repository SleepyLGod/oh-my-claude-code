---
description: Implement a scoped plan or spec end to end
argument-hint: [plan, issue, or implementation target]
disable-model-invocation: true
allowed-tools: Read, Edit, MultiEdit, Grep, Glob, LS, Bash(*)
context: fork
agent: general-purpose
model: inherit
when_to_use: Use when you already know what should be built and want focused implementation with verification. Examples: "/implement-plan add provider selector", "/implement-plan apply the approved refactor spec", "/implement-plan issue 42".
---

Implement this scoped plan:

$ARGUMENTS

Workflow:
1. Restate the goal and the success criteria.
2. Inspect the relevant code paths, types, configuration, and nearby behavior.
3. Identify the minimum correct set of changes.
4. Implement the change end to end across the relevant call chain.
5. Remove only the dead code your change creates.
6. Run the nearest meaningful verification.
7. Summarize what changed and what remains unverified.

Rules:
- Do not redesign the system unless correctness requires it.
- Do not add speculative flexibility or unrelated cleanup.
- Keep the implementation aligned with the stated plan, not your preferred architecture.
- If the plan conflicts with code reality, surface the conflict and choose the smallest correct adjustment.
- Do not claim completion unless you report concrete verification that actually ran.

Response format:
- Implemented scope
- Key changes
- Verification
- Remaining risks or follow-ups
