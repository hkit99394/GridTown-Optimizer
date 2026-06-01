#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultRoadmapDir = path.join(repoRoot, "docs", "roadmaps");

function usage() {
  return [
    "Usage: node scripts/scaffold-candidate-trigger.mjs --trigger-id=<id> --candidate-id=<id> --source=<text> [options]",
    "",
    "Prints a trigger-ledger record plus an M9 candidate intake draft that satisfies the M15/M16 intake gate.",
    "",
    "Options:",
    "  --artifact-path=<path>       Current artifact or evidence path for the trigger.",
    "  --budgets=<csv>              Budget list. Default: 1.",
    "  --candidate-class=<text>     Candidate class. Default: diagnostics.",
    "  --cases=<csv>                Case list. Default: <name current cases>.",
    "  --date=<YYYY-MM-DD>          Record date. Default: current UTC date.",
    "  --force                      Allow overwriting --write-intake output.",
    "  --modes=<csv>                Mode list. Default: auto.",
    "  --objective=<text>           Primary objective. Default: population.",
    "  --out-dir=<path>             Intake output directory. Default: docs/roadmaps.",
    "  --owner=<text>               Owner. Default: Solver roadmap.",
    "  --seeds=<csv>                Seed list. Default: 7,19,37.",
    "  --splits=<csv>               Split list. Default: development,holdout,fresh holdout.",
    "  --workflow-tags=<csv>        Workflow tags. Default: <name relevant workflow tags>.",
    "  --write-intake               Write the intake draft to docs/roadmaps/M9_CANDIDATE_INTAKE_<ID>.md.",
    "  --json                       Print machine-readable output.",
    "  --help                       Show this help."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    artifactPath: "artifacts/<family>/<date>/<run-id>",
    budgets: "1",
    candidateClass: "diagnostics",
    cases: "<name current cases>",
    date: new Date().toISOString().slice(0, 10),
    force: false,
    json: false,
    modes: "auto",
    objective: "population",
    outDir: defaultRoadmapDir,
    owner: "Solver roadmap",
    seeds: "7,19,37",
    source: undefined,
    splits: "development,holdout,fresh holdout",
    triggerId: undefined,
    candidateId: undefined,
    workflowTags: "<name relevant workflow tags>",
    writeIntake: false
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--write-intake") {
      args.writeIntake = true;
      continue;
    }
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator === -1) {
      throw new Error(`Unknown argument '${arg}'.`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (name === "artifact-path") args.artifactPath = value;
    else if (name === "budgets") args.budgets = value;
    else if (name === "candidate-class") args.candidateClass = value;
    else if (name === "candidate-id") args.candidateId = slug(value);
    else if (name === "cases") args.cases = value;
    else if (name === "date") args.date = value;
    else if (name === "modes") args.modes = value;
    else if (name === "objective") args.objective = value;
    else if (name === "out-dir") args.outDir = path.resolve(repoRoot, value);
    else if (name === "owner") args.owner = value;
    else if (name === "seeds") args.seeds = value;
    else if (name === "source") args.source = value;
    else if (name === "splits") args.splits = value;
    else if (name === "trigger-id") args.triggerId = slug(value);
    else if (name === "workflow-tags") args.workflowTags = value;
    else throw new Error(`Unknown argument '${arg}'.`);
  }

  if (!args.triggerId) throw new Error("--trigger-id is required.");
  if (!args.candidateId) throw new Error("--candidate-id is required.");
  if (!args.source) throw new Error("--source is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("--date must use YYYY-MM-DD.");
  return args;
}

function slug(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error(`Cannot build slug from '${value}'.`);
  return normalized;
}

function displayCsv(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(", ");
}

function intakeFileName(candidateId) {
  return `M9_CANDIDATE_INTAKE_${candidateId.toUpperCase().replaceAll("-", "_")}.md`;
}

function ledgerRecord(args) {
  return `### ${args.triggerId}

Status: nominated
Date: ${args.date}
Owner: ${args.owner}
Source: ${args.source}

Current artifact or issue:

- Artifact path: ${args.artifactPath}
- Issue or product requirement: ${args.source}
- Command: <record current reproducer command>

Observed signal:

- Case(s): ${displayCsv(args.cases)}
- Split(s): ${displayCsv(args.splits)}
- Workflow tag(s): ${displayCsv(args.workflowTags)}
- Mode(s): ${displayCsv(args.modes)}
- Budget(s): ${displayCsv(args.budgets)}
- Seed(s): ${displayCsv(args.seeds)}
- Baseline behavior: <record current baseline behavior>
- Why this is outside current noise or repeat envelope: <record repeat-envelope reason>

Candidate class:

- ${args.candidateClass}

Objective:

- ${args.objective}

Required before M9 intake:

- Same-slice baseline-repeat: required.
- Candidate-specific evaluator-validity: required when final layouts can change.
- Replay or saved-layout gate: required for replay or saved-layout workflows.
- CPU/time-to-best interpretation: required before promotion claims.
- Artifact storage preflight: run \`npm run artifact-hygiene:status\`.
- Fresh holdout coverage: required for promotion-grade work.

Decision:

- Open M9 intake: pending admission.
- Keep parked: yes until the admission rule is satisfied.
- Close: no.
- Rationale: Trigger nomination created by \`npm run candidate-trigger:scaffold\`.
`;
}

function intakeDraft(args) {
  return `# Solver Candidate Intake: ${args.candidateId}

Date: ${args.date}

Owner: ${args.owner}

Status: proposed

Candidate type: ${args.candidateClass}

Runtime default change proposed now: no

## Trigger

Trigger source:

- [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md): ${args.triggerId} is nominated from ${args.source}.

Trigger-ledger record:

- [MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md](MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md): ${args.triggerId}

Observed problem:

- Case(s): ${displayCsv(args.cases)}
- Split(s): ${displayCsv(args.splits)}
- Workflow tag(s): ${displayCsv(args.workflowTags)}
- Budget(s): ${displayCsv(args.budgets)}
- Seed(s): ${displayCsv(args.seeds)}
- Mode(s): ${displayCsv(args.modes)}
- Current behavior: <record current baseline behavior and why it is outside the repeat envelope>
- Artifact path(s): ${args.artifactPath}
- Command(s): <record exact reproducer command>

Why this is worth investigating now:

- The trigger has a current source and should be admitted or parked before solver implementation starts.

## Hypothesis

Candidate hypothesis:

- If we change: <candidate behavior>
- Then expected solver behavior: <expected ${args.objective} signal>
- Because: <mechanism>

Primary objective:

- ${args.objective}

Secondary objectives:

- First feasible:
- Time to best:
- Wall-clock:
- CPU budget:
- Replay compatibility:
- Evaluator validity:

Non-goals:

- No runtime default change without promotion gates and decision closeout.

## Scope

Affected modes:

- \`auto\`:
- \`greedy\`:
- \`lns\`:
- \`cp-sat\`:
- \`cp-sat-portfolio\`:

Affected code or policy surfaces:

- Solver params:
- Budget policy:
- Seed policy:
- Repair policy:
- Exact solver settings:
- Learned/runtime model:
- Planner/API surface:

Feature flag or opt-in guard:

- Required before implementation.

Runtime-default risk:

- none | low | medium | high
- Explanation:

## Evidence Plan

Development cases:

- <development cases>

Protected holdout cases:

- <protected holdout cases>

Fresh holdout plan:

- Fresh cases exist now: yes | no
- If no, how fresh cases will be nominated:
- Tuning leakage guard:

Workflow tags covered:

- ${displayCsv(args.workflowTags)}

Modes to run:

- ${displayCsv(args.modes)}

Budgets:

- Default promotion matrix: \`1,5,30,120\`
- Candidate-specific focused budgets: ${displayCsv(args.budgets)}
- Exception rationale:

Seeds:

- Default promotion seeds: \`7,19,37\`
- Focused or additional seeds: ${displayCsv(args.seeds)}
- Exception rationale:

Baseline controls:

- Baseline freshness command: \`npm run benchmark:scorecard -- <same cases, modes, budgets, seeds>\`
- Baseline-repeat command: same command with a new artifact directory and \`baseline-repeat\` run id before interpreting deltas.
- Candidate same-slice command: same cases, budgets, seeds, hardware, and command shape with the candidate enabled.
- Focused row rerun command: narrow to the first row with outside-envelope movement.

Evaluator and replay gates:

- Final-layout evaluator-validity plan: \`npm run evidence:candidate-evaluator-validity -- --candidate-id=${args.candidateId}\`
- Replay workflow plan: replay rows must keep zero validation errors and zero evaluator population delta.
- CP-SAT readiness or setup dependency:

CPU and timing gates:

- Wall-clock fields to compare:
- Time-to-first-feasible fields to compare:
- Time-to-best fields to compare:
- CPU-budget fields to compare:
- Observed-CPU coverage expectation:

Artifact hygiene preflight:

- \`npm run artifact-hygiene:status\` result: record before broad evidence.
- Externalization required before broad evidence: yes | no

## Expected Signal

Promotion target:

- Median population delta:
- Worst-decile population delta:
- Worst-row population delta:
- Regression rate:
- Equal-population time-to-best improvement:
- CPU-budget efficiency floor:
- First-feasible behavior:
- Replay/evaluator-validity result:

Minimum signal to continue after smoke:

Minimum signal to continue after development split:

Minimum signal to continue after protected holdout:

What result closes this as diagnostics-only:

What result blocks the candidate:

## Artifact Policy

Artifact root:

- artifacts/product-corpus/${args.date}/${args.candidateId}-<run-stamp>
- artifacts/candidate-evaluator-validity/${args.date}/${args.candidateId}-<run-stamp>

Expected files to keep in git when small:

- Summary text: yes.
- Evidence summary: yes.
- Telemetry manifest: yes.
- Workflow replay files: yes when small.
- Registry entry draft: yes.

Expected files to move to release/external storage if large:

- Raw scorecard JSON: yes.
- Budget ablation JSON: yes.
- Decision trace JSONL: yes.
- Replay labels: yes.
- Solve logs: yes.

Registry plan:

- Registry entry required: yes for decision-grade runs.
- Registry command: \`npm run experiment-registry -- check\`.
- Decision metadata to include: trigger id, candidate id, exact command, split metadata, evaluator-validity summary, CPU/time-to-best interpretation, artifact hygiene status, and runtime-default status.

## Review Checklist

- Trigger is real and current.
- Trigger-ledger record is linked.
- \`npm run candidate-intake:check\` passes.
- Hypothesis is testable.
- Case list covers development, protected holdout, and candidate-relevant fresh holdout.
- Fresh holdout is present for promotion-grade work or explicitly planned for diagnostics-only work.
- Baseline-repeat control is same-slice.
- Budgets and seeds match the promotion matrix or exceptions are justified.
- Expected signal is measurable and has stop conditions.
- Evaluator-validity and replay gates are named.
- CPU and time-to-best interpretation follows the M8 review.
- Artifact policy is clear before large bundles are produced.
- Runtime default remains unchanged until promotion gates are met.
`;
}

function outputPacket(args, triggerRecord, intake) {
  return `# Candidate Trigger Nomination Packet

## Trigger Ledger Record

Paste this into docs/roadmaps/MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER.md after updating any placeholders.

${triggerRecord}
## Candidate Intake Draft

${intake}`;
}

function writeIntake(args, intake) {
  fs.mkdirSync(args.outDir, { recursive: true });
  const intakePath = path.join(args.outDir, intakeFileName(args.candidateId));
  if (!args.force && fs.existsSync(intakePath)) {
    throw new Error(`Refusing to overwrite ${path.relative(repoRoot, intakePath)}; pass --force to replace it.`);
  }
  fs.writeFileSync(intakePath, intake);
  return intakePath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const triggerRecord = ledgerRecord(args);
  const intake = intakeDraft(args);
  const intakePath = args.writeIntake ? writeIntake(args, intake) : undefined;
  const payload = {
    triggerId: args.triggerId,
    candidateId: args.candidateId,
    intakePath: intakePath ? path.relative(repoRoot, intakePath).replaceAll(path.sep, "/") : undefined,
    triggerRecord,
    intake
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    if (intakePath) {
      process.stdout.write(`Wrote ${path.relative(repoRoot, intakePath).replaceAll(path.sep, "/")}\n\n`);
    }
    process.stdout.write(outputPacket(args, triggerRecord, intake));
  }
}

main();
