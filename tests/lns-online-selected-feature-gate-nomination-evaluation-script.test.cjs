const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(
  repoRoot,
  "artifacts",
  `tmp-lns-online-selected-feature-gate-nomination-evaluation-${process.pid}`
);
const discoveryDir = path.join(tempRoot, "discovery");
const outputDir = path.join(tempRoot, "out");
const freshOutputDir = path.join(tempRoot, "fresh-out");
const obsoleteModelDir = path.join(tempRoot, "obsolete-model");
const obsoleteOutputDir = path.join(tempRoot, "obsolete-model-out");
const fakeRunnerPath = path.join(tempRoot, "fake-lns-benchmark-runner.cjs");
const fakeSuppressionModel = "artifacts/fake-suppression-model.json";

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function writeFakeRunner() {
  fs.writeFileSync(
    fakeRunnerPath,
    `
const fs = require("node:fs");
const path = require("node:path");

function argValue(name) {
  const prefix = name + "=";
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const artifactDir = argValue("--window-ranker-artifact-dir");
const gate = argValue("--window-ranker-selected-feature-gate-groups") ?? "";
if (!artifactDir) throw new Error("missing artifact dir");
fs.mkdirSync(path.resolve(process.cwd(), artifactDir), { recursive: true });

function summaryForGate(value) {
  const base = {
    variantName: "window-ranker",
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 2,
    medianPopulationDeltaVsBaseline: 0,
    unchangedCaseCount: 0,
    rankerDecisionCount: 6,
    overrideImprovedOutcomeCount: 0,
    overrideNeutralOutcomeCount: 0,
    overrideFinalImprovedCaseCount: 0,
    overrideFinalNeutralCaseCount: 0,
    overrideFinalRegressedCaseCount: 0,
    equalPopulationTimeToBestGatePassed: true,
    medianTimeToBestWallClockRatioVsBaseline: 0.9,
    timeToBestWallClockFaster10PercentCount: 2,
    timeToBestWallClockSlower10PercentCount: 0
  };
  if (value.includes("goodGate")) {
    return {
      ...base,
      meanPopulationDeltaVsBaseline: 10,
      worstPopulationDeltaVsBaseline: 0,
      improvedCaseCount: 2,
      regressedCaseCount: 0,
      rankerOverrideCount: 4,
      rankerFallbackDecisionCount: 2,
      overrideImprovedOutcomeCount: 4,
      overrideFinalImprovedCaseCount: 2,
      equalPopulationTimeToBestGatePassed: false,
      timeToBestPromotionGatePassed: false
    };
  }
  if (value.includes("badGate")) {
    return {
      ...base,
      meanPopulationDeltaVsBaseline: -2,
      worstPopulationDeltaVsBaseline: -5,
      improvedCaseCount: 0,
      regressedCaseCount: 1,
      unchangedCaseCount: 1,
      rankerOverrideCount: 2,
      rankerFallbackDecisionCount: 4,
      overrideFinalRegressedCaseCount: 1,
      timeToBestPromotionGatePassed: false
    };
  }
  if (value.includes("neutralGate")) {
    return {
      ...base,
      meanPopulationDeltaVsBaseline: 8,
      worstPopulationDeltaVsBaseline: 0,
      improvedCaseCount: 1,
      regressedCaseCount: 0,
      unchangedCaseCount: 1,
      rankerOverrideCount: 3,
      rankerFallbackDecisionCount: 3,
      overrideImprovedOutcomeCount: 2,
      overrideNeutralOutcomeCount: 1,
      overrideFinalImprovedCaseCount: 1,
      overrideFinalNeutralCaseCount: 1,
      timeToBestPromotionGatePassed: false
    };
  }
  return {
    ...base,
    meanPopulationDeltaVsBaseline: 0,
    worstPopulationDeltaVsBaseline: 0,
    improvedCaseCount: 0,
    regressedCaseCount: 0,
    unchangedCaseCount: 2,
    rankerOverrideCount: 0,
    rankerFallbackDecisionCount: 6,
    timeToBestPromotionGatePassed: false
  };
}

const scorecard = {
  caseCount: 2,
  seedCount: 2,
  comparisonCount: 2,
  variantSummaries: [
    {
      variantName: "baseline",
      meanPopulationDeltaVsBaseline: 0,
      worstPopulationDeltaVsBaseline: 0,
      improvedCaseCount: 0,
      regressedCaseCount: 0,
      unchangedCaseCount: 2
    },
    summaryForGate(gate)
  ],
  cases: [
    {
      caseName: "fake-case",
      seed: 5,
      variants: [
        { variantName: "baseline" },
        {
          variantName: "window-ranker",
          windowRanker: {
            suppressionModelFingerprint: "fnv1a:fake-suppression",
            suppressionMinScoreDelta: 1.25
          }
        }
      ]
    }
  ],
};
fs.writeFileSync(path.resolve(process.cwd(), artifactDir, "lns-window-ranker-online-ablation.json"), JSON.stringify(scorecard, null, 2) + "\\n");
fs.writeFileSync(path.resolve(process.cwd(), artifactDir, "runner-args.json"), JSON.stringify({ args: process.argv.slice(2), gate }, null, 2) + "\\n");
console.log(JSON.stringify({ artifactDir, gate }));
`,
    "utf8"
  );
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  fs.mkdirSync(discoveryDir, { recursive: true });
  writeFakeRunner();
  fs.writeFileSync(
    path.join(discoveryDir, "online-selected-feature-gate-discovery.json"),
    JSON.stringify(
      {
        schemaVersion: 2,
        discoveryFingerprint: "fnv1a:test-discovery",
        target: "final-improved",
        topCandidates: [
          {
            cliArg: "goodGate>=1",
            gates: [{ feature: "goodGate", minValue: 1 }],
            selected: 3,
            targetImproved: 1,
            selectionImproved: 1,
            terminalFinalImproved: 1,
            safetyRegressed: 0,
            neutral: 2,
            safeNoRegression: true,
            validation: {
              selected: 1,
              targetImproved: 1,
              safetyRegressed: 0,
              neutral: 0,
              safeNoRegression: true
            }
          },
          {
            cliArg: "neutralGate>=1",
            gates: [{ feature: "neutralGate", minValue: 1 }],
            selected: 2,
            targetImproved: 1,
            selectionImproved: 1,
            terminalFinalImproved: 1,
            safetyRegressed: 0,
            neutral: 1,
            safeNoRegression: true
          },
          {
            gates: [{ feature: "badGate", minValue: 1 }],
            selected: 2,
            targetImproved: 1,
            selectionImproved: 1,
            terminalFinalImproved: 1,
            safetyRegressed: 0,
            neutral: 1,
            safeNoRegression: true
          }
        ],
        greedySelectedGateGroups: {
          cliArg: "greedyGate>=1",
          selectedFeatureGateGroups: [[{ feature: "greedyGate", minValue: 1 }]],
          selected: 2,
          targetImproved: 1,
          safetyRegressed: 0,
          neutral: 1,
          safeNoRegression: true
        },
        validationGreedySelectedGateGroups: {
          cliArg: "goodGate>=1",
          selectedFeatureGateGroups: [[{ feature: "goodGate", minValue: 1 }]],
          selected: 1,
          targetImproved: 1,
          safetyRegressed: 0,
          neutral: 0,
          safeNoRegression: true
        }
      },
      null,
      2
    )
  );

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/evaluate-lns-online-selected-feature-gates.mjs",
      `--discovery-artifact=${repoRelative(discoveryDir)}`,
      `--artifact-dir=${repoRelative(outputDir)}`,
      `--runner=${repoRelative(fakeRunnerPath)}`,
      "--window-ranker-model=artifacts/fake-model.json",
      "--window-ranker-product-promotion-holdout",
      "--window-ranker-min-score-delta=0",
      `--window-ranker-suppression-model=${fakeSuppressionModel}`,
      "--window-ranker-suppression-min-score-delta=1.25",
      "--seeds=5,7",
      "--lns-iterations=2",
      "--candidate-source=top-and-greedy",
      "--candidate-count=3"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const evaluation = JSON.parse(
    fs.readFileSync(path.join(outputDir, "lns-online-selected-feature-gate-nomination-evaluation.json"), "utf8")
  );
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.discoveryFingerprint, "fnv1a:test-discovery");
  assert.equal(evaluation.candidateSource, "top-and-greedy");
  assert.equal(evaluation.evaluatedCandidateCount, 4);
  assert.equal(evaluation.bestCandidate.cliArg, "goodGate>=1");
  assert.equal(evaluation.bestCandidate.summary.meanPopulationDeltaVsBaseline, 10);
  assert.equal(evaluation.bestCandidate.summary.promotionCandidate, true);
  assert.equal(evaluation.bestCandidate.summary.suppressionModelFingerprint, "fnv1a:fake-suppression");
  assert.equal(evaluation.bestCandidate.summary.suppressionMinScoreDelta, 1.25);
  assert.equal(evaluation.benchmark.productPromotionHoldout, true);
  assert.equal(evaluation.benchmark.protectedHoldout, false);
  assert.equal(evaluation.benchmark.protectedCorpus, "product-promotion-holdout");
  assert.equal(evaluation.benchmark.windowRankerSuppressionModel, fakeSuppressionModel);
  assert.equal(evaluation.benchmark.windowRankerSuppressionMinScoreDelta, 1.25);
  assert.equal(evaluation.candidates[1].cliArg, "neutralGate>=1");
  assert.equal(evaluation.candidates[1].summary.valuePositive, true);
  assert.equal(evaluation.candidates[1].summary.finalNeutralOverrideClean, false);
  assert.equal(evaluation.candidates[1].summary.promotionCandidate, false);
  assert.equal(evaluation.candidates[2].cliArg, "badGate>=1");
  assert.equal(evaluation.candidates[2].summary.regressedCaseCount, 1);
  assert.equal(evaluation.candidates[3].cliArg, "greedyGate>=1");
  assert.equal(evaluation.candidates[3].summary.allFallback, true);
  assert.equal(
    evaluation.candidates[0].command.some((arg) => arg === "--window-ranker-selected-feature-gate-groups=goodGate>=1"),
    true
  );
  assert.equal(
    evaluation.candidates[0].command.some((arg) => arg === "--window-ranker-product-promotion-holdout"),
    true
  );
  assert.equal(
    evaluation.candidates[0].command.some((arg) => arg === `--window-ranker-suppression-model=${fakeSuppressionModel}`),
    true
  );

  const telemetry = JSON.parse(fs.readFileSync(path.join(outputDir, "telemetry-manifest.json"), "utf8"));
  assert.equal(telemetry.protectedCorpus, "product-promotion-holdout");
  assert.equal(telemetry.windowRankerSuppressionModel, fakeSuppressionModel);
  assert.equal(telemetry.windowRankerSuppressionMinScoreDelta, 1.25);
  assert.equal(telemetry.metrics.evaluatedCandidateCount, 4);
  assert.equal(telemetry.metrics.productPromotionHoldout, true);
  assert.equal(telemetry.metrics.protectedCorpus, "product-promotion-holdout");
  assert.equal(telemetry.metrics.safeCandidateCount, 3);
  assert.equal(telemetry.metrics.activeOverrideCandidateCount, 3);
  assert.equal(telemetry.metrics.valuePositiveCandidateCount, 2);
  assert.equal(telemetry.metrics.promotionCandidateCount, 1);
  assert.equal(telemetry.metrics.bestCandidateCliArg, "goodGate>=1");
  assert.equal(telemetry.metrics.bestCandidateSuppressionModelFingerprint, "fnv1a:fake-suppression");
  assert.equal(telemetry.metrics.bestCandidateSuppressionMinScoreDelta, 1.25);

  const registry = JSON.parse(fs.readFileSync(path.join(outputDir, "registry-entry-draft.json"), "utf8"));
  assert.equal(registry.splitStatus.candidateCount, 4);
  assert.equal(registry.splitStatus.protectedCorpus, "product-promotion-holdout");
  assert.equal(registry.budget.productPromotionHoldout, true);
  assert.equal(registry.budget.protectedCorpus, "product-promotion-holdout");
  assert.equal(registry.model.windowRankerSuppressionModel, fakeSuppressionModel);
  assert.equal(registry.model.suppressionModelFingerprint, "fnv1a:fake-suppression");
  assert.equal(registry.summaryMetrics.bestCandidateCliArg, "goodGate>=1");

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(manifest.benchmark.productPromotionHoldout, true);
  assert.equal(manifest.benchmark.protectedCorpus, "product-promotion-holdout");
  assert.equal(manifest.benchmark.windowRankerSuppressionModel, fakeSuppressionModel);
  assert.equal(manifest.candidateArtifacts.length, 4);
  for (const candidateArtifact of manifest.candidateArtifacts) {
    assert.equal(fs.existsSync(path.join(repoRoot, candidateArtifact.scorecardPath)), true);
  }
  assert.match(
    fs.readFileSync(path.join(outputDir, "lns-online-selected-feature-gate-nomination-evaluation.txt"), "utf8"),
    /best-candidate=1 goodGate>=1/
  );

  const freshResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/evaluate-lns-online-selected-feature-gates.mjs",
      `--discovery-artifact=${repoRelative(discoveryDir)}`,
      `--artifact-dir=${repoRelative(freshOutputDir)}`,
      `--runner=${repoRelative(fakeRunnerPath)}`,
      "--window-ranker-model=artifacts/fake-model.json",
      "--window-ranker-fresh-pressure-holdout",
      "--window-ranker-min-score-delta=0",
      "--seeds=5,7",
      "--lns-iterations=2",
      "--candidate-source=validation-greedy"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(freshResult.status, 0, freshResult.stderr || freshResult.stdout);

  const freshEvaluation = JSON.parse(
    fs.readFileSync(path.join(freshOutputDir, "lns-online-selected-feature-gate-nomination-evaluation.json"), "utf8")
  );
  assert.equal(freshEvaluation.benchmark.freshPressureHoldout, true);
  assert.equal(freshEvaluation.benchmark.productPromotionHoldout, false);
  assert.equal(freshEvaluation.benchmark.protectedHoldout, false);
  assert.equal(freshEvaluation.benchmark.protectedCorpus, "fresh-pressure-holdout");
  assert.equal(
    freshEvaluation.candidates[0].command.some((arg) => arg === "--window-ranker-fresh-pressure-holdout"),
    true
  );

  const freshTelemetry = JSON.parse(fs.readFileSync(path.join(freshOutputDir, "telemetry-manifest.json"), "utf8"));
  assert.equal(freshTelemetry.protectedCorpus, "fresh-pressure-holdout");
  assert.equal(freshTelemetry.metrics.freshPressureHoldout, true);

  const freshRegistry = JSON.parse(fs.readFileSync(path.join(freshOutputDir, "registry-entry-draft.json"), "utf8"));
  assert.equal(freshRegistry.splitStatus.protectedCorpus, "fresh-pressure-holdout");
  assert.equal(freshRegistry.budget.freshPressureHoldout, true);

  fs.mkdirSync(obsoleteModelDir, { recursive: true });
  fs.writeFileSync(path.join(obsoleteModelDir, "OBSOLETE.md"), "Quarantined test model.\n");
  fs.writeFileSync(path.join(obsoleteModelDir, "model.json"), JSON.stringify({ weights: { area: 1 } }, null, 2));
  const obsoleteModelResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/evaluate-lns-online-selected-feature-gates.mjs",
      `--discovery-artifact=${repoRelative(discoveryDir)}`,
      `--artifact-dir=${repoRelative(obsoleteOutputDir)}`,
      `--runner=${repoRelative(fakeRunnerPath)}`,
      `--window-ranker-model=${repoRelative(path.join(obsoleteModelDir, "model.json"))}`,
      "--window-ranker-fresh-pressure-holdout",
      "--window-ranker-min-score-delta=0",
      "--seeds=5,7",
      "--lns-iterations=2",
      "--candidate-source=validation-greedy"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.notEqual(obsoleteModelResult.status, 0);
  assert.match(obsoleteModelResult.stderr, /--window-ranker-model points to obsolete artifact bundle/);

  const rejectedResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/evaluate-lns-online-selected-feature-gates.mjs",
      `--discovery-artifact=${repoRelative(discoveryDir)}`,
      `--artifact-dir=${repoRelative(outputDir)}`,
      `--runner=${repoRelative(fakeRunnerPath)}`,
      "--window-ranker-model=artifacts/fake-model.json",
      "--window-ranker-protected-holdout",
      "--window-ranker-product-promotion-holdout",
      "--window-ranker-fresh-pressure-holdout"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.notEqual(rejectedResult.status, 0);
  assert.match(rejectedResult.stderr, /Use only one of --window-ranker-protected-holdout/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS online selected-feature gate nomination evaluation script tests passed.");
