---
name: project-multi-agent-workflow
description: Run this repository's planner/worker/reviewer workflow for substantial codebase tasks. Use when the user explicitly asks for planner, worker, reviewer, sub-agents, parallel agents, or "$project-multi-agent-workflow"; also use as a local planning and review checklist for larger TranStation3.Resource changes that touch solver logic, planner web flows, tests, roadmaps, benchmarks, or deployment scripts.
---

# Project Multi Agent Workflow

## Overview

Coordinate medium and large changes in this City Builder repository through three roles: planner for context and approach, worker for scoped implementation, and reviewer for risk-focused verification. Prefer the repository's existing TypeScript, Node test harness, Python CP-SAT bridge, docs, and benchmark conventions over new machinery.

## Invocation Rules

- Spawn actual sub-agents only when the current user request explicitly asks for sub-agents, delegation, parallel agents, planner/worker/reviewer agents, or this skill by name.
- For ordinary substantial tasks where sub-agents were not explicitly requested, apply the same planner/worker/reviewer phases locally in one thread.
- Skip the full workflow for tiny edits, direct questions, or single-command requests.
- Keep at most one role on the immediate critical path. Delegate sidecar work only when it can run in parallel without blocking the next local step.
- Tell worker agents they are not alone in the codebase, must not revert edits made by others, and must list changed paths.

## Project Context

- The project is a City Builder optimizer with `auto`, `greedy`, `lns`, and `cp-sat` solver modes plus a local web planner.
- Core references are `README.md`, `docs/requirements/SPEC.md`, `docs/design/ALGORITHM.md`, `docs/design/PLANNER_ARCHITECTURE.md`, and the active roadmaps in `docs/roadmaps/`.
- Primary TypeScript sources live in `src/`; web UI assets live in `web/`; tests live in `tests/`; Python OR-Tools support lives in `python/`.
- Useful commands from `package.json`: `npm run build`, `npm test`, `npm run test:acceptance`, `npm run web`, and focused benchmark scripts such as `npm run benchmark:greedy`, `npm run benchmark:lns`, `npm run benchmark:cp-sat`, and `npm run benchmark:scorecard`.

## Planner Role

Use the planner role to turn the request into a small execution map.

- Inspect `git status --short` before edits and preserve unrelated user changes.
- Read the smallest useful slice of repo context first: package scripts, relevant source modules, nearby tests, and the related design or roadmap doc.
- Identify the critical path, optional sidecar investigations, expected write scope, and verification commands.
- For solver changes, name the affected mode (`auto`, `greedy`, `lns`, `cp-sat`), feasibility or scoring invariant, and test/benchmark guardrail.
- For web planner changes, name the affected route, UI state, API shape, and browser or route tests to run.

## Worker Role

Use the worker role to make tightly scoped changes.

- Follow existing module boundaries and public solution shapes. Avoid broad refactors unless they directly reduce risk for the requested change.
- Add or adjust tests near the behavior being changed. Prefer current `node:assert` CommonJS test style unless a nearby file uses something else.
- Keep docs and roadmaps accurate when behavior, commands, or solver status changes.
- Run targeted checks while iterating; finish with `npm run build` or `npm test` when the blast radius justifies it.
- If CP-SAT setup or OR-Tools availability blocks local validation, report the exact command and failure.

## Reviewer Role

Use the reviewer role after implementation.

- Review the diff first for behavioral regressions, missing validation, stale docs, brittle tests, and accidental churn.
- Lead with actionable findings only. If there are no findings, say so and name residual risk or unrun checks.
- For solver work, re-check feasibility, road connectivity, service/residential scoring, deterministic seeds, and benchmark artifact stability.
- For web/API work, re-check request validation, saved layout compatibility, cancel/poll behavior, and frontend state transitions.
- Ask the worker to patch only concrete issues. Avoid style-only churn unless it matches an existing project convention.

## Sub-Agent Prompts

When actual sub-agents are explicitly requested and available, keep prompts bounded.

Planner prompt:

```text
You are the planner for this repo task. Inspect only the relevant files, preserve unrelated worktree changes, and return a concise implementation plan with likely write scope, risks, and verification commands. Do not edit files.
```

Worker prompt:

```text
You are the worker for this repo task. You are not alone in the codebase: do not revert edits made by others, and adapt to any concurrent changes you see. Own only the assigned files/modules, make the requested change, run relevant checks, and list changed paths plus verification results.
```

Reviewer prompt:

```text
You are the reviewer for this repo task. Review the final diff for bugs, regressions, missing tests, stale docs, and project-convention mismatches. Lead with findings ordered by severity, with file and line references. Do not edit files unless asked.
```

## Final Response

Report the outcome plainly: what changed, what checks ran, and any remaining risks. If git staging, commits, pushes, or PRs were requested and completed, include the appropriate app directive in the final response.
