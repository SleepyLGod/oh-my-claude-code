---
description: Summarize the current diff for commit, PR, or status updates
argument-hint: [commit|pr|changelog|status]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want a concise explanation of the current diff. Examples: "/summarize-diff", "/summarize-diff commit", "/summarize-diff pr", "/summarize-diff status".
---

Summarize the current diff for:

$ARGUMENTS

Workflow:
1. Inspect the current git status, changed files, and diff.
2. Determine the most likely summary shape from the argument:
   - `commit`: concise commit-message style summary
   - `pr`: PR summary with user-facing impact
   - `changelog`: release-note style summary
   - `status` or no arg: plain engineering summary
3. Explain what changed, using only facts supported by the current diff and git status.
4. Include notable risk or follow-up only when it is visible from the current diff.

Rules:
- Do not edit files.
- Do not invent motivation that is not supported by the current diff, git status, or an explicitly provided argument.
- Do not use recent commit history unless the user explicitly asks for it.
- If the current diff does not show why a change was made, say that the motivation is not established.
- Prefer grouped behavioral summary over file-by-file narration.
- Call out risky or incomplete areas if visible from the diff.
- If a fact is uncertain, label it as an inference instead of stating it as settled.
- Do not mention unrelated repository features, previously shipped work, or nearby modules unless a changed file directly makes them relevant.

Response format:
- Requested summary
- Risks or open questions
