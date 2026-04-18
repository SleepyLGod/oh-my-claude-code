---
description: Diagnose a bug from evidence to likely root cause without editing code
argument-hint: [bug, symptom, error, or failing test]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when a bug, failing test, crash, or confusing behavior needs full diagnosis before any fix is attempted. Examples: "/deep-debug flaky login test", "/deep-debug API returns 500 in staging logs", "/deep-debug TypeError in session restore".
---

Diagnose this issue end to end:

$ARGUMENTS

Required workflow:
1. Restate the failure precisely.
2. State whether the failure is currently reproduced, indirectly supported, or still unproven.
3. If the failure is unproven, stop trying to explain the cause and instead identify the next exact reproduction or observation step.
4. If the failure is reproduced or materially supported, narrow the scope to the smallest plausible subsystem.
5. Inspect nearby code, configuration, recent changes, and logs or tests only as they relate to that failure.
6. Form a short list of concrete hypotheses.
7. Test the hypotheses with direct evidence and note any evidence against them.
8. Identify the most likely root cause only if one hypothesis is materially better supported than the rest.
9. Propose the smallest safe fix, but do not implement it.
10. State the best verification to run after a future fix.

Rules:
- Do not edit files.
- Do not jump to implementation before the failure is understood.
- Prefer direct evidence over intuition.
- Keep the proposed fix scoped to the diagnosed cause.
- If you cannot establish a confident root cause, say so instead of guessing.
- Do not choose an environmental cause unless the environment state is directly supported by command output, configuration, or the exercised code path.
- If multiple hypotheses remain plausible, present the top candidates instead of forcing a single answer.
- If the issue turns out to be environmental or external, say that clearly instead of forcing a code change.
- Do not use the mere presence of staged code changes as evidence that those changes are the cause.
- If inspection shows the mechanism is currently working, say that the failure is not yet reproduced and move to next-step evidence gathering.
- Do not list more than 3 hypotheses.
- Do not introduce generic fallback hypotheses such as UI caching, permissions, registration issues, or config filtering unless the inspected code path or command output points there directly.
- If your own checks show the mechanism currently works, the diagnosis must center on what remains unproven, not on speculative downstream causes.
- If reproduction status is `unproven`, do not provide a root cause section, do not rank hypotheses, and do not propose a code fix. Provide only the next evidence-gathering step and any constraints observed.

Response format:
- Observed failure
- Reproduction status
- Most likely root cause or top hypotheses
- Evidence
- Smallest safe fix
- Verification plan
- Residual risk
