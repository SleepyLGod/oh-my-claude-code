---
description: Behavior-preserving refactor with tight scope and verification
argument-hint: [module, subsystem, or refactor target]
disable-model-invocation: true
allowed-tools: Read, Edit, MultiEdit, Grep, Glob, LS, Bash(*)
context: fork
agent: general-purpose
model: inherit
when_to_use: Use when you want a cleanup or refactor while preserving behavior. Examples: "/refactor-safely auth reducer", "/refactor-safely large view component", "/refactor-safely duplicate config parsing".
---

Refactor this target while preserving behavior:

$ARGUMENTS

Workflow:
1. Define the behavior that must remain unchanged.
2. Inspect the current implementation and identify the minimum safe refactor.
3. Make the code easier to read, reason about, or maintain without expanding scope.
4. Preserve public behavior, data flow, and side effects unless explicitly instructed otherwise.
5. Run the closest verification that demonstrates behavior still matches expectations.
6. Summarize the refactor and any remaining risk.

Rules:
- No feature additions.
- No speculative abstraction.
- No unrelated cleanup.
- If behavior is unclear, establish current behavior before changing structure.
- Keep diffs surgical.
- Do not claim behavior preservation unless you report the concrete check that supports it.

Response format:
- Refactor goal
- What changed
- Behavior-preservation evidence
- Residual risk
