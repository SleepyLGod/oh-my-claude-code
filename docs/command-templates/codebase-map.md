---
description: Map a subsystem, its files, data flow, and likely change points
argument-hint: [subsystem, feature, module, or question]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, LS, Bash(git:*)
context: fork
agent: Explore
model: inherit
when_to_use: Use when you need to understand a subsystem before changing it. Examples: "/codebase-map auth flow", "/codebase-map command loading", "/codebase-map provider config path".
---

Create a practical map of this codebase area:

$ARGUMENTS

Workflow:
1. Identify the relevant entrypoints, modules, and types.
2. Read enough code to explain responsibilities and boundaries.
3. Trace the main data flow or control flow.
4. Call out extension points, invariants, and likely change points.
5. Note the main risks, hidden dependencies, and useful verification surfaces.

Rules:
- Optimize for implementation usefulness, not encyclopedic completeness.
- Prefer concrete file and symbol references when they matter.
- Distinguish confirmed behavior from inference.
- Do not edit files.

Response format:
- Overview
- Key files and responsibilities
- Data or control flow
- Change points and risks
