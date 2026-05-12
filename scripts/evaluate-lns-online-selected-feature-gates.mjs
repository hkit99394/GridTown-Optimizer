#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/evaluate-lns-online-selected-feature-gates.mjs";
const DISCOVERY_FILE = "online-selected-feature-gate-discovery.json";
const SCORECARD_FILE = "lns-window-ranker-online-ablation.json";
const EVALUATION_FILE = "lns-online-selected-feature-gate-nomination-evaluation.json";
const EVALUATION_TEXT_FILE = "lns-online-selected-feature-gate-nomination-evaluation.txt";
const EVALUATION_SCHEMA_VERSION = 1;
const TELEMETRY_MANIFEST_SCHEMA_VERSION = 1;
const REGISTRY_ENTRY_SCHEMA_VERSION = 1;
const CANDIDATE_SOURCES = new Set(["top-candidates", "greedy", "validation-greedy", "top-and-greedy"]);

function usage() {
  return [
    "Usage: node scripts/evaluate-lns-online-selected-feature-gates.mjs --discovery-artifact=<dir> --artifact-dir=<dir> --window-ranker-model=<path> [options]",
    "",
    "Runs selected-feature gate candidates through the online LNS window-ranker benchmark and summarizes nomination-aware outcomes.",
    "",
    "Options:",
    "  --discovery-artifact=<dir>        Discovery artifact dir containing online-selected-feature-gate-discovery.json.",
    "  --discovery-json=<path>           Direct discovery JSON path.",
    "  --artifact-dir=<dir>              Evaluation artifact bundle output directory under artifacts/.",
    "  --candidate-source=<name>         top-candidates, greedy, validation-greedy, or top-and-greedy. Default: top-candidates.",
    "  --candidate-count=<n>             Number of top candidates to evaluate. Default: 5.",
    "  --runner=<path>                   Benchmark runner script. Default: dist/lnsBenchmarkCli.js.",
    "  --window-ranker-model=<path>      Model path passed to the benchmark runner.",
    "  --window-ranker-min-score-delta=<n>",
    "                                   Min score delta passed to the benchmark runner. Default: 0.",
    "  --window-ranker-suppression-model=<path>",
    "                                   Suppression model path passed to the benchmark runner.",
    "  --window-ranker-suppression-min-score-delta=<n>",
    "                                   Suppression veto margin passed to the benchmark runner.",
    "  --seeds=<csv>                     Seeds passed to the benchmark runner.",
    "  --lns-iterations=<n>              LNS iteration count passed to the benchmark runner.",
    "  --window-ranker-protected-holdout Use the protected online holdout corpus.",
    "  --window-ranker-product-promotion-holdout",
    "                                   Use the product-promotion online holdout corpus.",
    "  --window-ranker-fresh-pressure-holdout",
    "                                   Use the fresh pressure online holdout corpus.",
    "  --benchmark-arg=<arg>             Extra raw argument passed to the benchmark runner. Repeatable.",
    "  --run-id-prefix=<text>            Prefix for per-candidate benchmark run ids.",
    "  --decision=<text>                 Decision string for per-candidate benchmark artifacts.",
    "  --summary=<text>                  Summary string for per-candidate benchmark artifacts.",
    "  --force-artifact-dir              Replace existing evaluation and per-candidate artifact directories."
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

function loadBenchmarkApi() {
  return loadDistModule(
    ["dist", "benchmarkApi.js"],
    "Missing dist/benchmarkApi.js. Run npm run build before evaluating online selected-feature gates."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before evaluating online selected-feature gates."
  );
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return parsed;
}

function parseArgs(argv) {
  let discoveryArtifact;
  let discoveryJson;
  let artifactDir;
  let candidateSource = "top-candidates";
  let candidateCount = 5;
  let runner = "dist/lnsBenchmarkCli.js";
  let windowRankerModel;
  let windowRankerMinScoreDelta = 0;
  let windowRankerSuppressionModel;
  let windowRankerSuppressionMinScoreDelta;
  let seeds;
  let lnsIterations;
  let protectedHoldout = false;
  let productPromotionHoldout = false;
  let freshPressureHoldout = false;
  let runIdPrefix;
  let decision = "online-lns-window-ranker-selected-feature-gate-nomination-evaluation";
  let summary = "Nomination-aware online selected-feature gate evaluation; no solver default changed.";
  const benchmarkArgs = [];
  let forceArtifactDir = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--force-artifact-dir") {
      forceArtifactDir = true;
      continue;
    }
    if (arg === "--window-ranker-protected-holdout" || arg === "--protected-holdout") {
      protectedHoldout = true;
      continue;
    }
    if (arg === "--window-ranker-product-promotion-holdout") {
      productPromotionHoldout = true;
      continue;
    }
    if (arg === "--window-ranker-fresh-pressure-holdout") {
      freshPressureHoldout = true;
      continue;
    }
    if (arg.startsWith("--discovery-artifact=")) {
      discoveryArtifact = arg.slice("--discovery-artifact=".length);
      continue;
    }
    if (arg.startsWith("--discovery-json=")) {
      discoveryJson = arg.slice("--discovery-json=".length);
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = arg.slice("--artifact-dir=".length);
      continue;
    }
    if (arg.startsWith("--candidate-source=")) {
      candidateSource = arg.slice("--candidate-source=".length);
      if (!CANDIDATE_SOURCES.has(candidateSource)) {
        throw new Error("--candidate-source must be top-candidates, greedy, validation-greedy, or top-and-greedy.");
      }
      continue;
    }
    if (arg.startsWith("--candidate-count=")) {
      candidateCount = parsePositiveInteger(arg.slice("--candidate-count=".length), "--candidate-count");
      continue;
    }
    if (arg.startsWith("--runner=")) {
      runner = arg.slice("--runner=".length);
      continue;
    }
    if (arg.startsWith("--window-ranker-model=")) {
      windowRankerModel = arg.slice("--window-ranker-model=".length);
      continue;
    }
    if (arg.startsWith("--window-ranker-min-score-delta=")) {
      windowRankerMinScoreDelta = parseNonNegativeNumber(
        arg.slice("--window-ranker-min-score-delta=".length),
        "--window-ranker-min-score-delta"
      );
      continue;
    }
    if (arg.startsWith("--window-ranker-suppression-model=")) {
      windowRankerSuppressionModel = arg.slice("--window-ranker-suppression-model=".length);
      continue;
    }
    if (arg.startsWith("--window-ranker-suppression-min-score-delta=")) {
      windowRankerSuppressionMinScoreDelta = parseNonNegativeNumber(
        arg.slice("--window-ranker-suppression-min-score-delta=".length),
        "--window-ranker-suppression-min-score-delta"
      );
      continue;
    }
    if (arg.startsWith("--seeds=")) {
      seeds = arg.slice("--seeds=".length);
      continue;
    }
    if (arg.startsWith("--lns-iterations=")) {
      lnsIterations = parsePositiveInteger(arg.slice("--lns-iterations=".length), "--lns-iterations");
      continue;
    }
    if (arg.startsWith("--benchmark-arg=")) {
      benchmarkArgs.push(arg.slice("--benchmark-arg=".length));
      continue;
    }
    if (arg.startsWith("--run-id-prefix=")) {
      runIdPrefix = arg.slice("--run-id-prefix=".length);
      continue;
    }
    if (arg.startsWith("--decision=")) {
      decision = arg.slice("--decision=".length);
      continue;
    }
    if (arg.startsWith("--summary=")) {
      summary = arg.slice("--summary=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!artifactDir) throw new Error("--artifact-dir=<dir> is required.");
  if (!windowRankerModel) throw new Error("--window-ranker-model=<path> is required.");
  const protectedCorpusSelectorCount = [protectedHoldout, productPromotionHoldout, freshPressureHoldout].filter(
    Boolean
  ).length;
  if (protectedCorpusSelectorCount > 1) {
    throw new Error(
      "Use only one of --window-ranker-protected-holdout, --window-ranker-product-promotion-holdout, or --window-ranker-fresh-pressure-holdout."
    );
  }
  if (windowRankerSuppressionMinScoreDelta !== undefined && windowRankerSuppressionModel === undefined) {
    throw new Error("--window-ranker-suppression-min-score-delta requires --window-ranker-suppression-model.");
  }
  if ((discoveryArtifact ? 1 : 0) + (discoveryJson ? 1 : 0) !== 1) {
    throw new Error("Provide exactly one of --discovery-artifact=<dir> or --discovery-json=<path>.");
  }
  return {
    discoveryArtifact,
    discoveryJson,
    artifactDir,
    candidateSource,
    candidateCount,
    runner,
    windowRankerModel,
    windowRankerMinScoreDelta,
    windowRankerSuppressionModel,
    windowRankerSuppressionMinScoreDelta,
    seeds,
    lnsIterations,
    protectedHoldout,
    productPromotionHoldout,
    freshPressureHoldout,
    runIdPrefix,
    decision,
    summary,
    benchmarkArgs,
    forceArtifactDir
  };
}

function normalizeRepoRelativePath(inputPath) {
  const root = repoRoot();
  const absolutePath = path.resolve(root, inputPath);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath === "" || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Path must stay inside the repository: ${inputPath}`);
  }
  return relativePath.split(path.sep).join(path.posix.sep);
}

function absoluteRepoPath(repoRelativePath) {
  return path.join(repoRoot(), repoRelativePath);
}

function optionalRepoRelativePath(inputPath) {
  return inputPath === undefined ? null : normalizeRepoRelativePath(inputPath);
}

function readJson(repoRelativePath) {
  return JSON.parse(fs.readFileSync(absoluteRepoPath(repoRelativePath), "utf8"));
}

function discoveryPath(options) {
  return options.discoveryJson
    ? normalizeRepoRelativePath(options.discoveryJson)
    : path.posix.join(normalizeRepoRelativePath(options.discoveryArtifact), DISCOVERY_FILE);
}

function protectedCorpus(options) {
  if (options.productPromotionHoldout) return "product-promotion-holdout";
  if (options.freshPressureHoldout) return "fresh-pressure-holdout";
  if (options.protectedHoldout) return "standard-protected-holdout";
  return null;
}

function stableNumberKey(value) {
  return Number.isInteger(value) ? String(value) : value.toString();
}

function gateCliArg(gate) {
  return gate.minValue === undefined
    ? `${gate.feature}<=${stableNumberKey(gate.maxValue)}`
    : `${gate.feature}>=${stableNumberKey(gate.minValue)}`;
}

function gatesCliArg(gates) {
  return gates.map(gateCliArg).join(",");
}

function safeCliArg(candidate) {
  if (typeof candidate.cliArg === "string" && candidate.cliArg.length > 0) return candidate.cliArg;
  if (Array.isArray(candidate.gates)) return gatesCliArg(candidate.gates);
  return "";
}

function candidateMetricProjection(candidate) {
  return {
    selected: candidate.selected ?? null,
    targetImproved: candidate.targetImproved ?? null,
    selectionImproved: candidate.selectionImproved ?? null,
    terminalFinalImproved: candidate.terminalFinalImproved ?? null,
    safetyRegressed: candidate.safetyRegressed ?? null,
    neutral: candidate.neutral ?? null,
    safeNoRegression: candidate.safeNoRegression ?? null,
    validation: candidate.validation
      ? {
          selected: candidate.validation.selected ?? null,
          targetImproved: candidate.validation.targetImproved ?? null,
          safetyRegressed: candidate.validation.safetyRegressed ?? null,
          neutral: candidate.validation.neutral ?? null,
          safeNoRegression: candidate.validation.safeNoRegression ?? null
        }
      : null
  };
}

function collectCandidates(discovery, options) {
  const candidates = [];
  const addCandidate = (source, sourceRank, candidate) => {
    if (!candidate) return;
    const cliArg = safeCliArg(candidate);
    if (!cliArg) return;
    candidates.push({
      source,
      sourceRank,
      cliArg,
      gates: candidate.gates ?? candidate.selectedFeatureGateGroups ?? null,
      discoveryMetrics: candidateMetricProjection(candidate)
    });
  };
  if (options.candidateSource === "top-candidates" || options.candidateSource === "top-and-greedy") {
    for (const [index, candidate] of (discovery.topCandidates ?? []).slice(0, options.candidateCount).entries()) {
      addCandidate("top-candidates", index + 1, candidate);
    }
  }
  if (options.candidateSource === "greedy" || options.candidateSource === "top-and-greedy") {
    addCandidate("greedy", 1, discovery.greedySelectedGateGroups);
  }
  if (options.candidateSource === "validation-greedy" || options.candidateSource === "top-and-greedy") {
    addCandidate("validation-greedy", 1, discovery.validationGreedySelectedGateGroups);
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.cliArg)) continue;
    seen.add(candidate.cliArg);
    unique.push({ ...candidate, evaluationIndex: unique.length + 1 });
  }
  return unique;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function padIndex(index) {
  return String(index).padStart(3, "0");
}

function benchmarkArgv(candidate, candidateArtifactDir, options, runIdPrefix) {
  const argv = [
    "--window-ranker-online-ablation",
    ...(options.protectedHoldout ? ["--window-ranker-protected-holdout"] : []),
    ...(options.productPromotionHoldout ? ["--window-ranker-product-promotion-holdout"] : []),
    ...(options.freshPressureHoldout ? ["--window-ranker-fresh-pressure-holdout"] : []),
    ...(options.seeds ? [`--seeds=${options.seeds}`] : []),
    ...(options.lnsIterations === undefined ? [] : [`--lns-iterations=${options.lnsIterations}`]),
    `--window-ranker-model=${normalizeRepoRelativePath(options.windowRankerModel)}`,
    `--window-ranker-min-score-delta=${options.windowRankerMinScoreDelta}`,
    ...(options.windowRankerSuppressionModel === undefined
      ? []
      : [`--window-ranker-suppression-model=${normalizeRepoRelativePath(options.windowRankerSuppressionModel)}`]),
    ...(options.windowRankerSuppressionMinScoreDelta === undefined
      ? []
      : [`--window-ranker-suppression-min-score-delta=${options.windowRankerSuppressionMinScoreDelta}`]),
    `--window-ranker-selected-feature-gate-groups=${candidate.cliArg}`,
    `--window-ranker-artifact-dir=${candidateArtifactDir}`,
    `--window-ranker-run-id=${runIdPrefix}-candidate-${padIndex(candidate.evaluationIndex)}`,
    `--window-ranker-decision=${options.decision}`,
    `--window-ranker-summary=${options.summary}`,
    "--json",
    ...options.benchmarkArgs
  ];
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return argv;
}

function candidateVariant(scorecard) {
  return scorecard.cases?.[0]?.variants?.find((variant) => variant.variantName === "window-ranker") ?? null;
}

function scorecardSummary(scorecard) {
  const summary = (scorecard.variantSummaries ?? []).find((variant) => variant.variantName === "window-ranker");
  if (!summary) throw new Error("Candidate scorecard is missing a window-ranker variant summary.");
  const variant = candidateVariant(scorecard);
  const windowRankerMetadata = variant?.windowRanker ?? {};
  const mean = summary.meanPopulationDeltaVsBaseline ?? 0;
  const worst = summary.worstPopulationDeltaVsBaseline ?? 0;
  const regressed = summary.regressedCaseCount ?? 0;
  const improved = summary.improvedCaseCount ?? 0;
  const overrides = summary.rankerOverrideCount ?? 0;
  const fallbacks = summary.rankerFallbackDecisionCount ?? 0;
  const finalNeutralOverrides = summary.overrideFinalNeutralCaseCount ?? 0;
  const safetyPassed = regressed === 0 && worst >= 0;
  const valuePositive = improved > 0 && mean > 0;
  const finalNeutralOverrideClean = finalNeutralOverrides === 0;
  const equalPopulationSpeedPositive =
    overrides > 0 &&
    summary.equalPopulationTimeToBestGatePassed === true &&
    summary.timeToBestPromotionGatePassed === true;
  const promotionCandidate =
    safetyPassed && finalNeutralOverrideClean && overrides > 0 && (valuePositive || equalPopulationSpeedPositive);
  return {
    caseCount: scorecard.caseCount ?? summary.caseCount ?? null,
    seedCount: scorecard.seedCount ?? summary.seedCount ?? null,
    comparisonCount: scorecard.comparisonCount ?? summary.comparisonCount ?? null,
    meanPopulationDeltaVsBaseline: mean,
    medianPopulationDeltaVsBaseline: summary.medianPopulationDeltaVsBaseline ?? null,
    worstPopulationDeltaVsBaseline: worst,
    improvedCaseCount: improved,
    regressedCaseCount: regressed,
    unchangedCaseCount: summary.unchangedCaseCount ?? null,
    rankerDecisionCount: summary.rankerDecisionCount ?? null,
    rankerOverrideCount: overrides,
    rankerFallbackDecisionCount: fallbacks,
    overrideImprovedOutcomeCount: summary.overrideImprovedOutcomeCount ?? null,
    overrideNeutralOutcomeCount: summary.overrideNeutralOutcomeCount ?? null,
    overrideFinalImprovedCaseCount: summary.overrideFinalImprovedCaseCount ?? null,
    overrideFinalNeutralCaseCount: finalNeutralOverrides,
    overrideFinalRegressedCaseCount: summary.overrideFinalRegressedCaseCount ?? null,
    equalPopulationTimeToBestGatePassed: summary.equalPopulationTimeToBestGatePassed ?? null,
    timeToBestPromotionGatePassed: summary.timeToBestPromotionGatePassed ?? null,
    medianTimeToBestWallClockRatioVsBaseline: summary.medianTimeToBestWallClockRatioVsBaseline ?? null,
    timeToBestWallClockFaster10PercentCount: summary.timeToBestWallClockFaster10PercentCount ?? null,
    timeToBestWallClockSlower10PercentCount: summary.timeToBestWallClockSlower10PercentCount ?? null,
    suppressionModelFingerprint:
      summary.suppressionModelFingerprint ?? windowRankerMetadata.suppressionModelFingerprint ?? null,
    suppressionMinScoreDelta: summary.suppressionMinScoreDelta ?? windowRankerMetadata.suppressionMinScoreDelta ?? null,
    safetyPassed,
    valuePositive,
    finalNeutralOverrideClean,
    equalPopulationSpeedPositive,
    activeOverride: overrides > 0,
    allFallback: overrides === 0 && fallbacks > 0,
    promotionCandidate
  };
}

function compareEvaluatedCandidates(left, right) {
  if (left.summary.promotionCandidate !== right.summary.promotionCandidate) {
    return right.summary.promotionCandidate ? 1 : -1;
  }
  const leftSafePositive = left.summary.safetyPassed && left.summary.valuePositive && left.summary.activeOverride;
  const rightSafePositive = right.summary.safetyPassed && right.summary.valuePositive && right.summary.activeOverride;
  if (leftSafePositive !== rightSafePositive) return rightSafePositive ? 1 : -1;
  if (left.summary.regressedCaseCount !== right.summary.regressedCaseCount) {
    return left.summary.regressedCaseCount - right.summary.regressedCaseCount;
  }
  if (left.summary.worstPopulationDeltaVsBaseline !== right.summary.worstPopulationDeltaVsBaseline) {
    return right.summary.worstPopulationDeltaVsBaseline - left.summary.worstPopulationDeltaVsBaseline;
  }
  if (left.summary.meanPopulationDeltaVsBaseline !== right.summary.meanPopulationDeltaVsBaseline) {
    return right.summary.meanPopulationDeltaVsBaseline - left.summary.meanPopulationDeltaVsBaseline;
  }
  if ((left.summary.overrideFinalNeutralCaseCount ?? 0) !== (right.summary.overrideFinalNeutralCaseCount ?? 0)) {
    return (left.summary.overrideFinalNeutralCaseCount ?? 0) - (right.summary.overrideFinalNeutralCaseCount ?? 0);
  }
  if (left.summary.rankerOverrideCount !== right.summary.rankerOverrideCount) {
    return right.summary.rankerOverrideCount - left.summary.rankerOverrideCount;
  }
  return left.evaluationIndex - right.evaluationIndex;
}

function runCandidate(candidate, artifacts, options, runnerPath, runIdPrefix) {
  const candidateArtifactDir = path.posix.join(
    artifacts.artifactDir,
    `candidate-${padIndex(candidate.evaluationIndex)}-${slug(candidate.cliArg) || "gate"}`
  );
  const argv = benchmarkArgv(candidate, candidateArtifactDir, options, runIdPrefix);
  const result = childProcess.spawnSync(process.execPath, [absoluteRepoPath(runnerPath), ...argv], {
    cwd: repoRoot(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Candidate ${candidate.evaluationIndex} benchmark failed with status ${result.status}.`,
        result.stderr.trim(),
        result.stdout.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  const scorecardPath = path.posix.join(candidateArtifactDir, SCORECARD_FILE);
  if (!fs.existsSync(absoluteRepoPath(scorecardPath))) {
    throw new Error(`Candidate ${candidate.evaluationIndex} did not write ${scorecardPath}.`);
  }
  const scorecard = readJson(scorecardPath);
  return {
    ...candidate,
    candidateArtifactDir,
    scorecardPath,
    command: ["node", runnerPath, ...argv],
    stdout: result.stdout.trim(),
    summary: scorecardSummary(scorecard)
  };
}

function commandString(defaultCliReplayCommand, options) {
  const argv = [
    ...(options.discoveryArtifact
      ? [`--discovery-artifact=${normalizeRepoRelativePath(options.discoveryArtifact)}`]
      : []),
    ...(options.discoveryJson ? [`--discovery-json=${normalizeRepoRelativePath(options.discoveryJson)}`] : []),
    `--artifact-dir=${options.artifactDir}`,
    `--candidate-source=${options.candidateSource}`,
    `--candidate-count=${options.candidateCount}`,
    `--runner=${normalizeRepoRelativePath(options.runner)}`,
    `--window-ranker-model=${normalizeRepoRelativePath(options.windowRankerModel)}`,
    `--window-ranker-min-score-delta=${options.windowRankerMinScoreDelta}`,
    ...(options.windowRankerSuppressionModel === undefined
      ? []
      : [`--window-ranker-suppression-model=${normalizeRepoRelativePath(options.windowRankerSuppressionModel)}`]),
    ...(options.windowRankerSuppressionMinScoreDelta === undefined
      ? []
      : [`--window-ranker-suppression-min-score-delta=${options.windowRankerSuppressionMinScoreDelta}`]),
    ...(options.seeds ? [`--seeds=${options.seeds}`] : []),
    ...(options.lnsIterations === undefined ? [] : [`--lns-iterations=${options.lnsIterations}`]),
    ...(options.protectedHoldout ? ["--window-ranker-protected-holdout"] : []),
    ...(options.productPromotionHoldout ? ["--window-ranker-product-promotion-holdout"] : []),
    ...(options.freshPressureHoldout ? ["--window-ranker-fresh-pressure-holdout"] : []),
    ...(options.runIdPrefix ? [`--run-id-prefix=${options.runIdPrefix}`] : []),
    `--decision=${options.decision}`,
    `--summary=${options.summary}`,
    ...options.benchmarkArgs.map((arg) => `--benchmark-arg=${arg}`),
    ...(options.forceArtifactDir ? ["--force-artifact-dir"] : [])
  ];
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

function identityPayload(payload) {
  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    discoveryJson: payload.discoveryJson,
    discoveryFingerprint: payload.discoveryFingerprint,
    candidateSource: payload.candidateSource,
    candidateCountRequested: payload.candidateCountRequested,
    benchmark: payload.benchmark,
    candidates: payload.candidates.map((candidate) => ({
      evaluationIndex: candidate.evaluationIndex,
      source: candidate.source,
      sourceRank: candidate.sourceRank,
      cliArg: candidate.cliArg,
      discoveryMetrics: candidate.discoveryMetrics,
      summary: candidate.summary
    }))
  };
}

function reportIdentityPayload(payload, command, outputArtifacts) {
  return {
    schemaVersion: REGISTRY_ENTRY_SCHEMA_VERSION,
    source: "lns-online-selected-feature-gate-nomination-evaluation",
    evaluationFingerprint: payload.evaluationFingerprint,
    command,
    outputArtifacts,
    bestCandidate: payload.bestCandidate
      ? {
          evaluationIndex: payload.bestCandidate.evaluationIndex,
          cliArg: payload.bestCandidate.cliArg,
          summary: payload.bestCandidate.summary
        }
      : null
  };
}

function formatEvaluation(evaluation) {
  const lines = [
    "LNS online selected-feature gate nomination evaluation",
    `generatedAt=${evaluation.generatedAt}`,
    `discoveryJson=${evaluation.discoveryJson}`,
    `candidateSource=${evaluation.candidateSource}`,
    `candidates=${evaluation.evaluatedCandidateCount}/${evaluation.candidateCountRequested}`,
    `evaluationFingerprint=${evaluation.evaluationFingerprint}`,
    "",
    evaluation.bestCandidate
      ? `best-candidate=${evaluation.bestCandidate.evaluationIndex} ${evaluation.bestCandidate.cliArg}`
      : "best-candidate=none",
    evaluation.bestCandidate
      ? `best-summary mean=${evaluation.bestCandidate.summary.meanPopulationDeltaVsBaseline} worst=${evaluation.bestCandidate.summary.worstPopulationDeltaVsBaseline} improved=${evaluation.bestCandidate.summary.improvedCaseCount} regressed=${evaluation.bestCandidate.summary.regressedCaseCount} overrides=${evaluation.bestCandidate.summary.rankerOverrideCount} fallbacks=${evaluation.bestCandidate.summary.rankerFallbackDecisionCount} all-fallback=${evaluation.bestCandidate.summary.allFallback} promotion=${evaluation.bestCandidate.summary.promotionCandidate}`
      : null,
    "",
    "candidates:"
  ].filter((line) => line !== null);
  for (const candidate of evaluation.candidates) {
    lines.push(
      `- ${candidate.evaluationIndex} ${candidate.cliArg}: mean=${candidate.summary.meanPopulationDeltaVsBaseline} worst=${candidate.summary.worstPopulationDeltaVsBaseline} improved=${candidate.summary.improvedCaseCount} regressed=${candidate.summary.regressedCaseCount} overrides=${candidate.summary.rankerOverrideCount} fallbacks=${candidate.summary.rankerFallbackDecisionCount} active=${candidate.summary.activeOverride} all-fallback=${candidate.summary.allFallback} value=${candidate.summary.valuePositive} promotion=${candidate.summary.promotionCandidate}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function artifactPathsFor(artifacts) {
  return {
    evaluationJson: artifacts.artifactPath(EVALUATION_FILE),
    evaluationText: artifacts.artifactPath(EVALUATION_TEXT_FILE),
    telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
    registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
    manifestJson: artifacts.artifactPath("manifest.json")
  };
}

const options = parseArgs(process.argv.slice(2));
const artifactHelpers = await loadArtifactBundleHelpers();
const benchmarkApi = await loadBenchmarkApi();
const runnerPath = normalizeRepoRelativePath(options.runner);
if (!fs.existsSync(absoluteRepoPath(runnerPath))) throw new Error(`Runner does not exist: ${runnerPath}`);
const sourceDiscoveryJson = discoveryPath(options);
const discovery = readJson(sourceDiscoveryJson);
const candidates = collectCandidates(discovery, options);
if (candidates.length === 0) throw new Error("No selected-feature gate candidates found to evaluate.");

const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
  force: options.forceArtifactDir
});
const runIdPrefix =
  options.runIdPrefix ??
  `lns-online-selected-feature-gate-nomination-${path.basename(artifacts.artifactDir).replace(/[^A-Za-z0-9_.-]/g, "-")}`;
const evaluatedCandidates = candidates.map((candidate) =>
  runCandidate(candidate, artifacts, options, runnerPath, runIdPrefix)
);
const rankedCandidates = evaluatedCandidates.slice().sort(compareEvaluatedCandidates);
const bestCandidate = rankedCandidates[0] ?? null;
const generatedAt = new Date().toISOString();
const benchmarkProtectedCorpus = protectedCorpus(options);
const windowRankerSuppressionModel = optionalRepoRelativePath(options.windowRankerSuppressionModel);
const benchmark = {
  runner: runnerPath,
  protectedHoldout: options.protectedHoldout,
  productPromotionHoldout: options.productPromotionHoldout,
  freshPressureHoldout: options.freshPressureHoldout,
  protectedCorpus: benchmarkProtectedCorpus,
  seeds: options.seeds ?? null,
  lnsIterations: options.lnsIterations ?? null,
  windowRankerModel: normalizeRepoRelativePath(options.windowRankerModel),
  windowRankerMinScoreDelta: options.windowRankerMinScoreDelta,
  windowRankerSuppressionModel,
  windowRankerSuppressionMinScoreDelta: options.windowRankerSuppressionMinScoreDelta ?? null,
  benchmarkArgs: options.benchmarkArgs
};
const payload = {
  schemaVersion: EVALUATION_SCHEMA_VERSION,
  generatedAt,
  source: "lns-online-selected-feature-gate-nomination-evaluation",
  discoveryJson: sourceDiscoveryJson,
  discoveryFingerprint: discovery.discoveryFingerprint ?? null,
  inputFingerprint: benchmarkApi.buildModelExperimentFingerprint({
    discoveryJson: sourceDiscoveryJson,
    discoveryFingerprint: discovery.discoveryFingerprint ?? null,
    benchmark
  }),
  candidateSource: options.candidateSource,
  candidateCountRequested: options.candidateCount,
  evaluatedCandidateCount: evaluatedCandidates.length,
  benchmark,
  candidates: evaluatedCandidates,
  bestCandidate
};
const evaluationFingerprint = benchmarkApi.buildModelExperimentFingerprint(identityPayload(payload));
const evaluation = {
  ...payload,
  evaluationFingerprint
};
const artifactPaths = artifactPathsFor(artifacts);
const outputArtifacts = Object.entries(artifactPaths)
  .filter(([name]) => name !== "registryEntryDraftJson")
  .map(([, artifactPath]) => artifactPath);
const command = commandString(artifactHelpers.defaultCliReplayCommand, options);
const reportFingerprint = benchmarkApi.buildModelExperimentFingerprint(
  reportIdentityPayload(evaluation, command, outputArtifacts)
);
const telemetryManifest = {
  schemaVersion: TELEMETRY_MANIFEST_SCHEMA_VERSION,
  source: "lns-online-selected-feature-gate-nomination-evaluation",
  command,
  generatedAt,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  diagnosticsOnly: true,
  discoveryJson: sourceDiscoveryJson,
  discoveryFingerprint: discovery.discoveryFingerprint ?? null,
  protectedCorpus: benchmarkProtectedCorpus,
  windowRankerSuppressionModel,
  windowRankerSuppressionMinScoreDelta: options.windowRankerSuppressionMinScoreDelta ?? null,
  inputFingerprint: evaluation.inputFingerprint,
  evaluationFingerprint,
  reportFingerprint,
  outputArtifacts,
  metrics: {
    candidateSource: evaluation.candidateSource,
    candidateCountRequested: evaluation.candidateCountRequested,
    evaluatedCandidateCount: evaluation.evaluatedCandidateCount,
    protectedHoldout: options.protectedHoldout,
    productPromotionHoldout: options.productPromotionHoldout,
    freshPressureHoldout: options.freshPressureHoldout,
    protectedCorpus: benchmarkProtectedCorpus,
    windowRankerSuppressionModel,
    windowRankerSuppressionMinScoreDelta: options.windowRankerSuppressionMinScoreDelta ?? null,
    safeCandidateCount: evaluation.candidates.filter((candidate) => candidate.summary.safetyPassed).length,
    activeOverrideCandidateCount: evaluation.candidates.filter((candidate) => candidate.summary.activeOverride).length,
    valuePositiveCandidateCount: evaluation.candidates.filter((candidate) => candidate.summary.valuePositive).length,
    promotionCandidateCount: evaluation.candidates.filter((candidate) => candidate.summary.promotionCandidate).length,
    bestCandidateIndex: bestCandidate?.evaluationIndex ?? null,
    bestCandidateCliArg: bestCandidate?.cliArg ?? null,
    bestCandidateMeanDelta: bestCandidate?.summary.meanPopulationDeltaVsBaseline ?? null,
    bestCandidateWorstDelta: bestCandidate?.summary.worstPopulationDeltaVsBaseline ?? null,
    bestCandidateImprovedCount: bestCandidate?.summary.improvedCaseCount ?? null,
    bestCandidateRegressedCount: bestCandidate?.summary.regressedCaseCount ?? null,
    bestCandidateOverrideCount: bestCandidate?.summary.rankerOverrideCount ?? null,
    bestCandidateFallbackCount: bestCandidate?.summary.rankerFallbackDecisionCount ?? null,
    bestCandidateAllFallback: bestCandidate?.summary.allFallback ?? null,
    bestCandidatePromotionCandidate: bestCandidate?.summary.promotionCandidate ?? null,
    bestCandidateSuppressionModelFingerprint: bestCandidate?.summary.suppressionModelFingerprint ?? null,
    bestCandidateSuppressionMinScoreDelta: bestCandidate?.summary.suppressionMinScoreDelta ?? null
  },
  notes:
    "Diagnostics-only nomination-aware selected-feature gate evaluation over online LNS window-ranker benchmark runs; no solver default changed."
};
const registryEntryDraft = {
  schemaVersion: REGISTRY_ENTRY_SCHEMA_VERSION,
  runId: `lns-online-selected-feature-gate-nomination-${reportFingerprint.slice(-8)}`,
  artifactType: "ablation-gate",
  generatedAt,
  commands: [command],
  artifactPaths: outputArtifacts,
  cases: ["lns-window-ranker-online"],
  caseFamilies: ["lns-window-ranker-online"],
  seeds: options.seeds
    ? options.seeds
        .split(",")
        .map((seed) => Number(seed.trim()))
        .filter(Number.isFinite)
    : [],
  inputFingerprint: evaluation.inputFingerprint,
  datasetFingerprint: evaluation.evaluationFingerprint,
  reportFingerprint,
  splitStatus: {
    diagnosticsOnly: true,
    source: "online-lns-window-ranker-gated-candidate-reruns",
    candidateSource: evaluation.candidateSource,
    candidateCount: evaluation.evaluatedCandidateCount,
    protectedCorpus: benchmarkProtectedCorpus
  },
  budget: {
    candidateCountRequested: evaluation.candidateCountRequested,
    evaluatedCandidateCount: evaluation.evaluatedCandidateCount,
    protectedHoldout: options.protectedHoldout,
    productPromotionHoldout: options.productPromotionHoldout,
    freshPressureHoldout: options.freshPressureHoldout,
    protectedCorpus: benchmarkProtectedCorpus,
    seeds: options.seeds ?? null,
    lnsIterations: options.lnsIterations ?? null,
    windowRankerSuppressionModel,
    windowRankerSuppressionMinScoreDelta: options.windowRankerSuppressionMinScoreDelta ?? null
  },
  hardware: telemetryManifest.hardware,
  model: {
    trained: false,
    diagnosticsOnly: true,
    gateKind: "online-selected-feature-gate-nomination-evaluation",
    windowRankerModel: benchmark.windowRankerModel,
    windowRankerMinScoreDelta: benchmark.windowRankerMinScoreDelta,
    windowRankerSuppressionModel,
    windowRankerSuppressionMinScoreDelta: options.windowRankerSuppressionMinScoreDelta ?? null,
    suppressionModelFingerprint: bestCandidate?.summary.suppressionModelFingerprint ?? null,
    suppressionMinScoreDelta: bestCandidate?.summary.suppressionMinScoreDelta ?? null
  },
  decision: "diagnostics-only",
  summary:
    "Online LNS window-ranker selected-feature gate candidates rerun through nomination-aware benchmark scoring; no solver default changed.",
  summaryMetrics: telemetryManifest.metrics
};
const manifest = {
  artifactDir: artifacts.artifactDir,
  artifactPaths,
  command,
  generatedAt,
  discoveryJson: sourceDiscoveryJson,
  discoveryFingerprint: discovery.discoveryFingerprint ?? null,
  inputFingerprint: evaluation.inputFingerprint,
  evaluationFingerprint,
  reportFingerprint,
  benchmark,
  candidateArtifacts: evaluation.candidates.map((candidate) => ({
    evaluationIndex: candidate.evaluationIndex,
    cliArg: candidate.cliArg,
    artifactDir: candidate.candidateArtifactDir,
    scorecardPath: candidate.scorecardPath
  })),
  generator: {
    script: SCRIPT_PATH,
    requiresBuild: true,
    command
  }
};

artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(EVALUATION_FILE), evaluation, {
  force: options.forceArtifactDir
});
artifactHelpers.writeTextArtifact(artifacts.absoluteArtifactPath(EVALUATION_TEXT_FILE), formatEvaluation(evaluation), {
  force: options.forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
  force: options.forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
  force: options.forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, {
  force: options.forceArtifactDir
});

console.log(`Wrote LNS online selected-feature gate nomination evaluation to ${artifacts.artifactDir}`);
