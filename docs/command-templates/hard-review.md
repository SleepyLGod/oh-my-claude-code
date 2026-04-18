---
description: High-rigor review for complex diffs, branches, or pull requests
argument-hint: [review target, PR number, or focus area]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*), Bash(gh:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you want a deep code review of the current diff, a branch, or a PR. Examples: "/hard-review", "/hard-review current diff", "/hard-review PR 123", "/hard-review auth changes".
---

Perform a high-rigor code review for:

$ARGUMENTS

Review workflow:
1. Identify the review target from the argument, current repo state, or both.
2. Gather the relevant diff and changed files. Use recent commit context only when the diff itself is insufficient to understand behavior.
3. If the target is a PR and GitHub context is available, inspect the PR metadata and review comments.
4. Read the changed executable logic and enough nearby context to evaluate behavior.
5. Look first for correctness bugs, regressions, invalid assumptions, edge-case failures, and materially missing verification.
6. Include security, data-loss, migration, and API contract risks only when the changed logic directly implicates them.
7. Stop once you have the highest-signal findings. It is acceptable to return no findings.

Rules:
- Do not edit files.
- Do not optimize for approval; optimize for catching real problems.
- Prefer concrete findings over style commentary.
- If confidence is limited by missing context, say so explicitly.
- If there are no findings, say that clearly and note any residual risk or test gaps.
- Only report a finding when the code, diff, or command output supports it directly.
- Use high or critical severity only when the failure mode is concrete and likely, not merely arguable.
- Do not pad the review with speculative or low-value findings.
- Do not treat missing rationale, removed gating, or policy changes as findings unless you can show a concrete correctness, security, privacy, or user-visible behavior risk.
- Prioritize newly modified executable logic over documentation churn, naming changes, or process concerns.
- Treat missing tests as a finding only when the changed logic is risky enough that the lack of verification materially lowers confidence.
- Do not report more than 5 findings.
- Prefer "open question" or "residual risk" over a formal finding when the evidence does not show a likely defect.
- Do not escalate command exposure or internal-only changes into security findings unless the changed code exposes specific sensitive data or bypasses a real access check.
- Review implementation correctness in the fork's intended context, not hypothetical upstream policy.
- A finding must describe a likely defect, regression, or materially missing verification, not merely a governance concern.
- Ignore documentation-only churn, branding changes, and deliberate productization unless they create a concrete broken path or user-visible mismatch.
- Treat deliberate exposure of previously gated commands as non-findings by default in this fork. Only raise them if the changed implementation now leaks specific sensitive data, breaks an existing user path, or removes a real runtime guard beyond simple visibility.
- Do not lead with access-control or policy concerns when changed executable logic presents stronger correctness issues.
- If a change appears user-requested or deliberately productized in this fork, do not report it as a finding unless the implementation is concretely broken.
- Before claiming a missing symbol, invalid config key, or undefined theme/token, verify it with direct code search in the current tree.
- Prefer one strong, evidence-backed finding over several arguable ones.

Response format:
- Findings first, ordered by severity.
- Include file references whenever possible.
- Then list open questions or residual risks.
- Keep the summary brief.
