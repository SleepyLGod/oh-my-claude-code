---
description: Design and run the smallest meaningful verification without editing code
argument-hint: [change, bug, file, or target behavior]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want a focused verification strategy instead of broad test runs. Examples: "/test-focus current diff", "/test-focus session restore", "/test-focus auth token refresh".
---

Create and execute the smallest meaningful verification plan for:

$ARGUMENTS

Workflow:
1. Identify the change or behavior under test.
2. Map it to the nearest useful verification surface: unit, integration, CLI, UI, or targeted manual check.
3. Prefer the narrowest check that can actually fail for the right reason.
4. Run the verification.
5. Report what passed, what failed, and what remains unverified.

Rules:
- Do not edit files.
- Do not default to full test suites when a narrower check is better.
- Do not add tests in this command.
- If no useful automated check exists, say so and propose the best manual verification.
- Do not claim coverage that you did not actually run.

Response format:
- Verification target
- Chosen checks
- Execution results
- Remaining gaps
