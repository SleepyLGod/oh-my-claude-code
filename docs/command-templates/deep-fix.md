---
description: Apply the smallest correct fix for a diagnosed issue and verify it
argument-hint: [bug, symptom, error, or failing test]
disable-model-invocation: true
allowed-tools: Read, Edit, MultiEdit, Grep, Glob, LS, Bash(*)
context: fork
agent: general-purpose
model: inherit
when_to_use: Use when the issue is already diagnosed or clear enough to fix directly. Examples: "/deep-fix flaky login test", "/deep-fix TypeError in session restore", "/deep-fix provider switch footer state".
---

Fix this issue with the smallest correct change:

$ARGUMENTS

Workflow:
1. Restate the issue and the expected behavior.
2. Inspect the relevant code path and gather the minimum evidence needed to confirm the likely cause.
3. Implement the smallest correct fix.
4. Run the nearest meaningful verification.
5. Summarize what changed and what remains unverified.

Rules:
- Keep the fix scoped to the diagnosed cause.
- Do not perform unrelated cleanup.
- If the cause is still unclear, stop and say so instead of forcing a fix.
- Do not claim success without reporting concrete verification.

Response format:
- Fixed scope
- Key changes
- Verification
- Remaining risks or follow-ups
