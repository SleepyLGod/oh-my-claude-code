---
description: Analyze a refactor boundary and verification plan without editing code
argument-hint: [module, subsystem, or refactor target]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want to define a safe refactor before any edits. Examples: "/refactor-safely-analyze auth reducer", "/refactor-safely-analyze config loader", "/refactor-safely-analyze current diff".
---

Analyze this refactor target:

$ARGUMENTS

Workflow:
1. Define the behavior that must remain unchanged.
2. Inspect the current implementation and identify the smallest safe refactor boundary.
3. Call out hidden dependencies, risky side effects, and likely regressions.
4. Propose the verification needed to prove behavior is preserved.
5. Stop at analysis. Do not edit files.

Rules:
- Do not edit files.
- No feature additions.
- No speculative abstraction.
- If current behavior is unclear, say what must be established first.

Response format:
- Refactor target
- Behavior that must remain unchanged
- Safe refactor boundary
- Verification plan
- Residual risk
