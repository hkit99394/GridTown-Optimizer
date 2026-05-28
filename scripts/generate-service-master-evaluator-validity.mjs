#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT_PATH = "scripts/generate-service-master-evaluator-validity.mjs";
const VALIDITY_FILE = "service-master-evaluator-validity.json";
const VALIDITY_TEXT_FILE = "service-master-evaluator-validity.txt";
const TELEMETRY_FILE = "telemetry-manifest.json";
const REGISTRY_FILE = "registry-entry-draft.json";
const MANIFEST_FILE = "manifest.json";

function usage() {
  return [
    `Usage: node ${SCRIPT_PATH} --artifact-dir=<dir> [options]`,
    "",
    "Reruns Greedy baseline and opt-in service-master shortlist rows over the product workflow corpus,",
    "then validates every final solution with the core evaluator.",
    "",
    "Options:",
    "  --budgets=<csv>              Wall-clock budgets. Default: 5,30.",
    "  --seeds=<csv>                Seeds. Default: 7,19,37.",
    "  --run-id=<id>                Registry draft run id.",
    "  --decision=<text>            Registry draft decision. Default: diagnostics-only-no-default-promotion.",
    "  --summary=<text>             Registry draft summary.",
    "  --force-artifact-dir         Reuse an existing artifact directory."
  ].join("\n");
}

function repoRoot() {
  return path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
}

function loadDistModule(modulePath, missingMessage) {
  const distModulePath = path.join(repoRoot(), ...modulePath);
  if (!fs.existsSync(distModulePath)) throw new Error(missingMessage);
  return import(url.pathToFileURL(distModulePath).href);
}

function parseNumberList(value, label) {
  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => !Number.isNaN(entry));
  if (parsed.length === 0 || parsed.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    throw new Error(`${label} must contain positive finite numbers.`);
  }
  return [...new Set(parsed)];
}

function parseArgs(argv) {
  const args = {
    budgets: [5, 30],
    seeds: [7, 19, 37],
    forceArtifactDir: false,
    decision: "diagnostics-only-no-default-promotion"
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
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator === -1) throw new Error(`Unknown argument '${arg}'.`);
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    if (name === "artifact-dir") args.artifactDir = value;
    else if (name === "budgets") args.budgets = parseNumberList(value, "--budgets");
    else if (name === "seeds") args.seeds = parseNumberList(value, "--seeds");
    else if (name === "run-id") args.runId = value;
    else if (name === "decision") args.decision = value;
    else if (name === "summary") args.summary = value;
    else throw new Error(`Unknown argument '${arg}'.`);
  }
  if (!args.artifactDir) throw new Error("--artifact-dir is required.");
  return args;
}

function cloneGrid(grid) {
  return grid.map((row) => [...row]);
}

function commandFromArgs(argv) {
  return ["node", SCRIPT_PATH, ...argv.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(" ");
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

function summarizeRows(rows, filter) {
  const selected = rows.filter(filter);
  const validRows = selected.filter((row) => row.valid);
  const populationMismatches = selected.filter((row) => row.populationDeltaFromEvaluator !== 0);
  return {
    rowCount: selected.length,
    validCount: validRows.length,
    invalidCount: selected.length - validRows.length,
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
  lines.push("=== Service-Master Evaluator Validity ===");
  lines.push(`Generated: ${validity.generatedAt}`);
  lines.push(`Cases: ${validity.caseCount}`);
  lines.push(`Budgets: ${validity.budgetsSeconds.join(", ")}s`);
  lines.push(`Seeds: ${validity.seeds.join(", ")}`);
  lines.push(
    `Coverage: rows=${validity.summary.rowCount} valid=${validity.summary.validCount} invalid=${validity.summary.invalidCount} population-mismatches=${validity.summary.populationMismatchCount} max-abs-delta=${validity.summary.maxAbsPopulationDeltaFromEvaluator}`
  );
  lines.push("");
  for (const policy of validity.policySummaries) {
    lines.push(
      `- ${policy.policyName}: rows=${policy.rowCount} valid=${policy.validCount} invalid=${policy.invalidCount} population-mismatches=${policy.populationMismatchCount} max-abs-delta=${policy.maxAbsPopulationDeltaFromEvaluator} mean-wall=${policy.meanWallClockSeconds?.toFixed(3) ?? "n/a"}s`
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
    runId: options.runId ?? `service-master-evaluator-validity-${validity.generatedAt.slice(0, 10)}`,
    artifactType: "ablation-gate",
    generatedAt: validity.generatedAt,
    commands: [command],
    artifactPaths: [
      artifacts.artifactPath(VALIDITY_FILE),
      artifacts.artifactPath(VALIDITY_TEXT_FILE),
      artifacts.artifactPath(TELEMETRY_FILE)
    ],
    cases: validity.casesBySplit,
    caseFamilies: ["service-master-evaluator-validity", "product-workflow"],
    seeds: [...validity.seeds],
    splitStatus: {
      splitField: "CrossModeBenchmarkCase.split",
      protectedHoldout: true,
      caseCount: validity.caseCount,
      casesBySplit: validity.casesBySplit,
      leakage: "product-workflow-development-holdout-splits",
      notes:
        "Evaluator validity reruns Greedy baseline and opt-in service-master rows over product workflow development/holdout cases; it does not promote solver defaults."
    },
    budget: {
      wallClockBudgetsSeconds: [...validity.budgetsSeconds],
      caseCount: validity.caseCount,
      seedCount: validity.seeds.length,
      policyCount: validity.policies.length,
      validationRowCount: validity.summary.rowCount,
      validRowCount: validity.summary.validCount,
      invalidRowCount: validity.summary.invalidCount,
      observedWallClockSeconds: validity.observedWallClockSeconds
    },
    model: null,
    decision: options.decision,
    summary:
      options.summary ??
      `Service-master evaluator validity over ${validity.summary.rowCount} Greedy rows: ${validity.summary.validCount} valid, ${validity.summary.invalidCount} invalid.`,
    summaryMetrics: {
      summary: validity.summary,
      policySummaries: validity.policySummaries,
      splitSummaries: validity.splitSummaries,
      budgetSummaries: validity.budgetSummaries
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const benchmarkApi = await loadDistModule(
    ["dist", "benchmarkApi.js"],
    "Missing dist/benchmarkApi.js. Run npm run build before generating service-master evaluator validity."
  );
  const solverApi = await loadDistModule(
    ["dist", "solverApi.js"],
    "Missing dist/solverApi.js. Run npm run build before generating service-master evaluator validity."
  );
  const artifactHelpers = await loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before generating service-master evaluator validity."
  );

  const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
    force: options.forceArtifactDir
  });
  const command = commandFromArgs(process.argv.slice(2));
  const serviceMasterPolicy = benchmarkApi.OPTIONAL_CROSS_MODE_BUDGET_ABLATION_POLICIES.find(
    (policy) => policy.name === "service-master-shortlist"
  );
  if (!serviceMasterPolicy) throw new Error("Missing service-master-shortlist budget ablation policy.");

  const policies = [
    { name: "baseline", label: "baseline", budgetAblationPolicy: { name: "baseline", description: "Baseline." } },
    {
      name: "service-master-shortlist",
      label: "service-master-shortlist",
      budgetAblationPolicy: serviceMasterPolicy
    }
  ];
  const startedAt = performance.now();
  const rows = [];
  for (const benchmarkCase of benchmarkApi.DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS) {
    for (const budgetSeconds of options.budgets) {
      for (const seed of options.seeds) {
        for (const policy of policies) {
          const grid = cloneGrid(benchmarkCase.grid);
          const params = benchmarkApi.buildCrossModeBenchmarkParams(benchmarkCase, "greedy", {
            budgetSeconds,
            seeds: [seed],
            budgetAblationPolicy: policy.budgetAblationPolicy
          });
          const rowStartedAt = performance.now();
          const solution = solverApi.solveGreedy(grid, params);
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
            budgetSeconds,
            seed,
            policyName: policy.name,
            serviceMasterDecomposition: params.greedy?.serviceMasterDecomposition === true,
            valid: validation.valid,
            validationErrorCount: validation.errors.length,
            errors: validation.errors,
            reportedPopulation: solution.totalPopulation,
            recomputedTotalPopulation: validation.recomputedTotalPopulation,
            populationDeltaFromEvaluator: validation.recomputedTotalPopulation - solution.totalPopulation,
            roadCount: solution.roads.size,
            serviceCount: solution.services.length,
            residentialCount: solution.residentials.length,
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
    git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
    hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
    caseCount: benchmarkApi.DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS.length,
    casesBySplit: caseNamesBySplit(benchmarkApi.DEFAULT_CROSS_MODE_PRODUCT_WORKFLOW_CORPUS),
    budgetsSeconds: [...options.budgets],
    seeds: [...options.seeds],
    policies: policies.map((policy) => policy.name),
    observedWallClockSeconds: (performance.now() - startedAt) / 1000,
    summary: summarizeRows(rows, () => true),
    policySummaries: policies.map((policy) => ({
      policyName: policy.name,
      ...summarizeRows(rows, (row) => row.policyName === policy.name)
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
    source: "service-master-evaluator-validity",
    generatedAt,
    command,
    git: validity.git,
    hardware: validity.hardware,
    suite: {
      caseCount: validity.caseCount,
      budgetsSeconds: validity.budgetsSeconds,
      seeds: validity.seeds,
      policies: validity.policies,
      rowCount: validity.summary.rowCount,
      validCount: validity.summary.validCount,
      invalidCount: validity.summary.invalidCount
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
    generatedAt,
    rowCount: validity.summary.rowCount,
    validCount: validity.summary.validCount,
    invalidCount: validity.summary.invalidCount
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
