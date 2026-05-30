#!/usr/bin/env node

import path from "node:path";
import url from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_PATH = "scripts/generate-candidate-evaluator-validity.mjs";
const VALIDITY_FILE = "candidate-evaluator-validity.json";
const VALIDITY_TEXT_FILE = "candidate-evaluator-validity.txt";
const TELEMETRY_FILE = "telemetry-manifest.json";
const REGISTRY_FILE = "registry-entry-draft.json";
const MANIFEST_FILE = "manifest.json";

function usage() {
  return [
    `Usage: node ${SCRIPT_PATH} --artifact-dir=<dir> --candidate-id=<id> [options]`,
    "",
    "Runs selected product-workflow cases for a candidate's affected modes,",
    "then validates every final solution with the core evaluator.",
    "",
    "Options:",
    "  --cases=<csv>               Product workflow case names. Default: full product workflow corpus.",
    "  --modes=<csv>               Modes. Default: auto,greedy,lns,cp-sat.",
    "  --budgets=<csv>             Wall-clock budgets. Default: 1.",
    "  --seeds=<csv>               Seeds. Default: 7.",
    "  --run-id=<id>               Registry draft run id.",
    "  --decision=<text>           Registry draft decision. Default: candidate-evaluator-validity.",
    "  --summary=<text>            Registry draft summary.",
    "  --fresh-holdout-note=<text> Registry split note for fresh holdout nominations.",
    "  --cp-sat-no-overlap2d       Run CP-SAT modes with the experimental NoOverlap2D occupancy encoding.",
    "  --force-artifact-dir        Reuse an existing artifact directory."
  ].join("\n");
}

function repoRoot() {
  return path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
}

function loadDistModule(modulePath, missingMessage) {
  const distModulePath = path.join(repoRoot(), ...modulePath);
  return import(url.pathToFileURL(distModulePath).href).catch((error) => {
    if (error?.code === "ERR_MODULE_NOT_FOUND") throw new Error(missingMessage);
    throw error;
  });
}

function parseCsv(value, label) {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parsed.length === 0) throw new Error(`${label} must contain at least one value.`);
  return [...new Set(parsed)];
}

function parseNumberList(value, label) {
  const parsed = parseCsv(value, label).map((entry) => Number(entry));
  if (parsed.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    throw new Error(`${label} must contain positive finite numbers.`);
  }
  return [...new Set(parsed)];
}

function parseArgs(argv) {
  const args = {
    budgets: [1],
    cases: undefined,
    decision: "candidate-evaluator-validity",
    cpSatUseNoOverlap2d: false,
    forceArtifactDir: false,
    freshHoldoutNote: undefined,
    modes: ["auto", "greedy", "lns", "cp-sat"],
    seeds: [7]
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--force-artifact-dir") {
      args.forceArtifactDir = true;
      continue;
    }
    if (arg === "--cp-sat-no-overlap2d") {
      args.cpSatUseNoOverlap2d = true;
      continue;
    }
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator === -1) throw new Error(`Unknown argument '${arg}'.`);
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    if (name === "artifact-dir") args.artifactDir = value;
    else if (name === "budgets") args.budgets = parseNumberList(value, "--budgets");
    else if (name === "candidate-id") args.candidateId = value.trim();
    else if (name === "cases") args.cases = parseCsv(value, "--cases");
    else if (name === "decision") args.decision = value;
    else if (name === "fresh-holdout-note") args.freshHoldoutNote = value;
    else if (name === "modes") args.modes = parseCsv(value, "--modes");
    else if (name === "run-id") args.runId = value;
    else if (name === "seeds") args.seeds = parseNumberList(value, "--seeds");
    else if (name === "summary") args.summary = value;
    else throw new Error(`Unknown argument '${arg}'.`);
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required.");
  if (!args.candidateId) throw new Error("--candidate-id is required.");
  return args;
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function caseNamesBySplit(corpus) {
  const bySplit = { development: [], holdout: [] };
  for (const benchmarkCase of corpus) {
    bySplit[benchmarkCase.split ?? "development"].push(benchmarkCase.name);
  }
  bySplit.development.sort();
  bySplit.holdout.sort();
  return bySplit;
}

function summarizeRows(rows, filter = () => true) {
  const selected = rows.filter(filter);
  const populationMismatches = selected.filter((row) => row.populationDeltaFromEvaluator !== 0);
  return {
    rowCount: selected.length,
    validCount: selected.filter((row) => row.valid).length,
    invalidCount: selected.filter((row) => !row.valid).length,
    populationMismatchCount: populationMismatches.length,
    maxAbsPopulationDeltaFromEvaluator: selected.length
      ? Math.max(...selected.map((row) => Math.abs(row.populationDeltaFromEvaluator)))
      : 0,
    totalPopulation: selected.reduce((sum, row) => sum + row.reportedPopulation, 0),
    recomputedTotalPopulation: selected.reduce((sum, row) => sum + row.recomputedTotalPopulation, 0),
    meanWallClockSeconds:
      selected.length === 0 ? null : selected.reduce((sum, row) => sum + row.wallClockSeconds, 0) / selected.length
  };
}

function buildText(validity) {
  const lines = [];
  lines.push("=== Candidate Evaluator Validity ===");
  lines.push(`Generated: ${validity.generatedAt}`);
  lines.push(`Candidate: ${validity.candidateId}`);
  lines.push(`Cases: ${validity.caseCount}`);
  lines.push(`Modes: ${validity.modes.join(", ")}`);
  lines.push(`Budgets: ${validity.budgetsSeconds.join(", ")}s`);
  lines.push(`Seeds: ${validity.seeds.join(", ")}`);
  lines.push(
    `Coverage: rows=${validity.summary.rowCount} valid=${validity.summary.validCount} invalid=${validity.summary.invalidCount} population-mismatches=${validity.summary.populationMismatchCount} max-abs-delta=${validity.summary.maxAbsPopulationDeltaFromEvaluator}`
  );
  if (validity.freshHoldoutNote) lines.push(`Fresh holdout note: ${validity.freshHoldoutNote}`);
  lines.push("");
  for (const mode of validity.modeSummaries) {
    lines.push(
      `- mode=${mode.mode}: rows=${mode.rowCount} valid=${mode.validCount} invalid=${mode.invalidCount} population-mismatches=${mode.populationMismatchCount} mean-wall=${mode.meanWallClockSeconds?.toFixed(3) ?? "n/a"}s`
    );
  }
  lines.push("");
  for (const split of validity.splitSummaries) {
    lines.push(
      `- split=${split.split}: rows=${split.rowCount} valid=${split.validCount} invalid=${split.invalidCount} population-mismatches=${split.populationMismatchCount}`
    );
  }
  lines.push("");
  for (const budget of validity.budgetSummaries) {
    lines.push(
      `- budget=${budget.budgetSeconds}s rows=${budget.rowCount} valid=${budget.validCount} invalid=${budget.invalidCount} population-mismatches=${budget.populationMismatchCount}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildRegistryEntry(validity, artifacts, options, command) {
  return {
    schemaVersion: 1,
    runId:
      options.runId ?? `candidate-evaluator-validity-${slug(options.candidateId)}-${validity.generatedAt.slice(0, 10)}`,
    artifactType: "ablation-gate",
    generatedAt: validity.generatedAt,
    commands: [command],
    artifactPaths: [
      artifacts.artifactPath(VALIDITY_FILE),
      artifacts.artifactPath(VALIDITY_TEXT_FILE),
      artifacts.artifactPath(TELEMETRY_FILE)
    ],
    cases: validity.casesBySplit,
    caseFamilies: validity.workflowTags,
    seeds: [...validity.seeds],
    splitStatus: {
      splitField: "CrossModeBenchmarkCase.split",
      protectedHoldout: validity.casesBySplit.holdout.length > 0,
      caseCount: validity.caseCount,
      casesBySplit: validity.casesBySplit,
      freshHoldoutNote: validity.freshHoldoutNote ?? null,
      leakage:
        validity.freshHoldoutNote === null
          ? "product-workflow-development-holdout-splits"
          : "candidate-specific-fresh-holdout-nomination",
      notes:
        "Candidate evaluator validity validates final layouts for the named candidate, modes, cases, budgets, and seeds. It is an evidence gate only and does not promote solver defaults."
    },
    budget: {
      wallClockBudgetsSeconds: [...validity.budgetsSeconds],
      modes: [...validity.modes],
      caseCount: validity.caseCount,
      seedCount: validity.seeds.length,
      validationRowCount: validity.summary.rowCount,
      validRowCount: validity.summary.validCount,
      invalidRowCount: validity.summary.invalidCount,
      observedWallClockSeconds: validity.observedWallClockSeconds
    },
    model: validity.candidateOptions,
    decision: options.decision,
    summary:
      options.summary ??
      `Candidate evaluator validity for ${validity.candidateId}: ${validity.summary.validCount}/${validity.summary.rowCount} rows valid with ${validity.summary.populationMismatchCount} population mismatches.`,
    summaryMetrics: {
      summary: validity.summary,
      modeSummaries: validity.modeSummaries,
      splitSummaries: validity.splitSummaries,
      budgetSummaries: validity.budgetSummaries
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const benchmarkApi = await loadDistModule(
    ["dist", "benchmarkApi.js"],
    "Missing dist/benchmarkApi.js. Run npm run build before generating candidate evaluator validity."
  );
  const solverApi = await loadDistModule(
    ["dist", "solverApi.js"],
    "Missing dist/solverApi.js. Run npm run build before generating candidate evaluator validity."
  );
  const artifactHelpers = await loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before generating candidate evaluator validity."
  );

  const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
    force: options.forceArtifactDir
  });
  const command = artifactHelpers.defaultCliReplayCommand(SCRIPT_PATH, process.argv.slice(2));
  const corpus =
    options.cases === undefined
      ? [...benchmarkApi.DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS]
      : benchmarkApi.selectBenchmarkCasesByName(
          benchmarkApi.DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS,
          options.cases,
          {
            caseLabel: "candidate evaluator-validity case",
            corpusLabel: "Product workflow corpus"
          }
        );
  const startedAt = performance.now();
  const rows = [];
  const candidateOptions = {
    cpSatUseNoOverlap2d: options.cpSatUseNoOverlap2d
  };

  for (const benchmarkCase of corpus) {
    for (const budgetSeconds of options.budgets) {
      for (const seed of options.seeds) {
        for (const mode of options.modes) {
          const params = benchmarkApi.buildCrossModeBenchmarkParams(benchmarkCase, mode, {
            budgetSeconds,
            cpSat: options.cpSatUseNoOverlap2d ? { useNoOverlap2d: true } : undefined,
            seeds: [seed]
          });
          const rowStartedAt = performance.now();
          const solution = await solverApi.solveAsync(cloneGrid(benchmarkCase.grid), params);
          const rowFinishedAt = performance.now();
          const validation = solverApi.validateSolution({
            grid: cloneGrid(benchmarkCase.grid),
            params,
            solution
          });
          rows.push({
            caseName: benchmarkCase.name,
            split: benchmarkCase.split ?? "development",
            workflowTags: [...(benchmarkCase.workflowTags ?? [])],
            mode,
            optimizer: params.optimizer ?? mode,
            budgetSeconds,
            seed,
            valid: validation.valid,
            validationErrorCount: validation.errors.length,
            errors: validation.errors,
            reportedPopulation: solution.totalPopulation,
            recomputedTotalPopulation: validation.recomputedTotalPopulation,
            populationDeltaFromEvaluator: validation.recomputedTotalPopulation - solution.totalPopulation,
            roadCount: solution.roads.size,
            serviceCount: solution.services.length,
            residentialCount: solution.residentials.length,
            cpSatStatus: solution.cpSatStatus ?? null,
            lnsStopReason: solution.lnsTelemetry?.stopReason ?? null,
            autoStopReason: solution.autoStage?.stopReason ?? null,
            stoppedByUser: Boolean(solution.stoppedByUser),
            wallClockSeconds: (rowFinishedAt - rowStartedAt) / 1000
          });
        }
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const validity = {
    schemaVersion: 1,
    generatedAt,
    command,
    candidateId: options.candidateId,
    candidateOptions,
    freshHoldoutNote: options.freshHoldoutNote ?? null,
    git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
    hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
    caseCount: corpus.length,
    casesBySplit: caseNamesBySplit(corpus),
    workflowTags: uniqueSorted(corpus.flatMap((benchmarkCase) => benchmarkCase.workflowTags ?? [])),
    modes: [...options.modes],
    budgetsSeconds: [...options.budgets],
    seeds: [...options.seeds],
    observedWallClockSeconds: (performance.now() - startedAt) / 1000,
    summary: summarizeRows(rows),
    modeSummaries: options.modes.map((mode) => ({
      mode,
      ...summarizeRows(rows, (row) => row.mode === mode)
    })),
    splitSummaries: ["development", "holdout"].map((split) => ({
      split,
      ...summarizeRows(rows, (row) => row.split === split)
    })),
    budgetSummaries: options.budgets.map((budgetSeconds) => ({
      budgetSeconds,
      ...summarizeRows(rows, (row) => row.budgetSeconds === budgetSeconds)
    })),
    rows
  };
  const telemetryManifest = {
    schemaVersion: 1,
    source: "candidate-evaluator-validity",
    generatedAt,
    command,
    candidateId: validity.candidateId,
    candidateOptions: validity.candidateOptions,
    freshHoldoutNote: validity.freshHoldoutNote,
    git: validity.git,
    hardware: validity.hardware,
    suite: {
      caseCount: validity.caseCount,
      modes: validity.modes,
      budgetsSeconds: validity.budgetsSeconds,
      seeds: validity.seeds,
      rowCount: validity.summary.rowCount,
      validCount: validity.summary.validCount,
      invalidCount: validity.summary.invalidCount,
      populationMismatchCount: validity.summary.populationMismatchCount
    },
    rows
  };
  const registryEntryDraft = buildRegistryEntry(validity, artifacts, options, command);
  const manifest = {
    artifactDir: artifacts.artifactDir,
    artifactPaths: {
      validityJson: artifacts.artifactPath(VALIDITY_FILE),
      validityText: artifacts.artifactPath(VALIDITY_TEXT_FILE),
      telemetryManifestJson: artifacts.artifactPath(TELEMETRY_FILE),
      registryEntryDraftJson: artifacts.artifactPath(REGISTRY_FILE)
    },
    runId: registryEntryDraft.runId,
    candidateId: validity.candidateId,
    candidateOptions: validity.candidateOptions,
    generatedAt,
    rowCount: validity.summary.rowCount,
    validCount: validity.summary.validCount,
    invalidCount: validity.summary.invalidCount,
    populationMismatchCount: validity.summary.populationMismatchCount
  };

  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(VALIDITY_FILE), validity, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeTextArtifact(artifacts.absoluteArtifactPath(VALIDITY_TEXT_FILE), buildText(validity), {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(TELEMETRY_FILE), telemetryManifest, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(REGISTRY_FILE), registryEntryDraft, {
    force: options.forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(MANIFEST_FILE), manifest, {
    force: options.forceArtifactDir
  });

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
