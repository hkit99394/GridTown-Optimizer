const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-lns-window-ranker-promotion-recheck-${process.pid}`);
const scorecardRoot = path.join(tempRoot, "scorecards");
const outputDir = path.join(tempRoot, "out");
const repeatOutputDir = path.join(tempRoot, "repeat-out");
const sensitivityOutputDir = path.join(tempRoot, "sensitivity-out");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function writeScorecard(name, summaryOverrides) {
  const artifactDir = path.join(scorecardRoot, name);
  fs.mkdirSync(artifactDir, { recursive: true });
  const scorecard = {
    caseCount: 2,
    seedCount: 2,
    comparisonCount: 4,
    seeds: [7, 19],
    selectedCaseNames: [`${name}-a`, `${name}-b`],
    variantSummaries: [
      {
        variantName: "baseline",
        meanPopulationDeltaVsBaseline: 0,
        worstPopulationDeltaVsBaseline: 0,
        improvedCaseCount: 0,
        regressedCaseCount: 0,
        unchangedCaseCount: 4
      },
      {
        variantName: "window-ranker",
        comparisonCount: 4,
        meanPopulationDeltaVsBaseline: 0,
        medianPopulationDeltaVsBaseline: 0,
        worstPopulationDeltaVsBaseline: 0,
        bestPopulationDeltaVsBaseline: 0,
        improvedCaseCount: 0,
        regressedCaseCount: 0,
        unchangedCaseCount: 4,
        rankerDecisionCount: 8,
        rankerOverrideCount: 0,
        rankerFallbackDecisionCount: 8,
        overrideFinalImprovedCaseCount: 0,
        overrideFinalNeutralCaseCount: 0,
        overrideFinalRegressedCaseCount: 0,
        equalPopulationTimeToBestGatePassed: true,
        timeToBestPromotionGatePassed: false,
        medianTimeToBestWallClockRatioVsBaseline: 0.99,
        timeToBestWallClockKnownPairCount: 4,
        timeToBestWallClockUnknownPairCount: 0,
        timeToBestWallClockFaster10PercentCount: 1,
        timeToBestWallClockSlower10PercentCount: 0,
        ...summaryOverrides
      }
    ],
    cases: [
      {
        caseName: `${name}-a`,
        seed: 7,
        variants: [
          { variantName: "baseline" },
          {
            variantName: "window-ranker",
            windowRanker: {
              modelFingerprint: "fnv1a:test-model",
              minScoreDelta: 0.5,
              suppressionModelFingerprint: "fnv1a:test-suppressor",
              suppressionMinScoreDelta: 2
            }
          }
        ]
      }
    ]
  };
  fs.writeFileSync(
    path.join(artifactDir, "lns-window-ranker-online-ablation.json"),
    `${JSON.stringify(scorecard, null, 2)}\n`
  );
  return repoRelative(path.join(artifactDir, "lns-window-ranker-online-ablation.json"));
}

function budgetContainsOnlyRegistrySafeValues(value) {
  if (value === null) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(budgetContainsOnlyRegistrySafeValues);
  if (typeof value === "object") return Object.values(value).every(budgetContainsOnlyRegistrySafeValues);
  return false;
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  const productScorecard = writeScorecard("product", {
    meanPopulationDeltaVsBaseline: 12,
    bestPopulationDeltaVsBaseline: 30,
    improvedCaseCount: 2,
    unchangedCaseCount: 2,
    rankerOverrideCount: 2,
    rankerFallbackDecisionCount: 6,
    overrideFinalImprovedCaseCount: 2,
    equalPopulationTimeToBestGatePassed: false,
    timeToBestPromotionGatePassed: false
  });
  const protectedScorecard = writeScorecard("protected", {
    rankerOverrideCount: 1,
    rankerFallbackDecisionCount: 7,
    overrideFinalNeutralCaseCount: 1,
    equalPopulationTimeToBestGatePassed: false
  });
  const defaultScorecard = writeScorecard("default", {
    meanPopulationDeltaVsBaseline: 8,
    improvedCaseCount: 1,
    unchangedCaseCount: 3,
    rankerOverrideCount: 2,
    rankerFallbackDecisionCount: 6,
    overrideFinalImprovedCaseCount: 1,
    overrideFinalNeutralCaseCount: 1,
    equalPopulationTimeToBestGatePassed: false
  });
  const freshScorecard = writeScorecard("fresh", {
    timeToBestPromotionGatePassed: true,
    medianTimeToBestWallClockRatioVsBaseline: 0.82,
    timeToBestWallClockFaster10PercentCount: 4
  });

  const scriptArgs = [
    "scripts/summarize-lns-window-ranker-promotion-recheck.mjs",
    "--candidate=gate:Gate Candidate",
    `--scorecard=gate:product:${productScorecard}`,
    `--scorecard=gate:protected:${protectedScorecard}`,
    `--scorecard=gate:default:${defaultScorecard}`,
    `--scorecard=gate:fresh:${freshScorecard}`
  ];
  const result = childProcess.spawnSync(
    process.execPath,
    [...scriptArgs, `--artifact-dir=${repoRelative(outputDir)}`],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const repeatResult = childProcess.spawnSync(
    process.execPath,
    [...scriptArgs, `--artifact-dir=${repoRelative(repeatOutputDir)}`],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(repeatResult.status, 0, repeatResult.stderr || repeatResult.stdout);

  const recheck = JSON.parse(fs.readFileSync(path.join(outputDir, "lns-window-ranker-promotion-recheck.json"), "utf8"));
  const repeatRecheck = JSON.parse(
    fs.readFileSync(path.join(repeatOutputDir, "lns-window-ranker-promotion-recheck.json"), "utf8")
  );
  assert.equal(recheck.recheckFingerprint, repeatRecheck.recheckFingerprint);

  const productScorecardPath = path.resolve(repoRoot, productScorecard);
  const updatedProductScorecard = JSON.parse(fs.readFileSync(productScorecardPath, "utf8"));
  updatedProductScorecard.variantSummaries.find(
    (variant) => variant.variantName === "window-ranker"
  ).medianTimeToBestWallClockRatioVsBaseline = 0.74;
  fs.writeFileSync(productScorecardPath, `${JSON.stringify(updatedProductScorecard, null, 2)}\n`);
  const sensitivityResult = childProcess.spawnSync(
    process.execPath,
    [...scriptArgs, `--artifact-dir=${repoRelative(sensitivityOutputDir)}`],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(sensitivityResult.status, 0, sensitivityResult.stderr || sensitivityResult.stdout);
  const sensitivityRecheck = JSON.parse(
    fs.readFileSync(path.join(sensitivityOutputDir, "lns-window-ranker-promotion-recheck.json"), "utf8")
  );
  assert.notEqual(recheck.recheckFingerprint, sensitivityRecheck.recheckFingerprint);

  const repeatRegistryDraft = JSON.parse(
    fs.readFileSync(path.join(repeatOutputDir, "registry-entry-draft.json"), "utf8")
  );
  assert.equal(recheck.summaryMetrics.candidateCount, 1);
  assert.equal(recheck.summaryMetrics.promotionReadyCandidateCount, 0);
  const candidate = recheck.summaryMetrics.candidateSummaries[0];
  assert.equal(candidate.productAxisPassed, true);
  assert.equal(candidate.productTimeToBestPassed, false);
  assert.equal(candidate.protectedAxisPassed, false);
  assert.equal(candidate.freshAxisPassed, false);
  const freshReport = candidate.corpora.find((corpus) => corpus.corpus === "fresh");
  assert.equal(freshReport.timeToBestPromotionGatePassed, true);
  assert.equal(freshReport.timeToBestValue, false);
  assert.equal(freshReport.axisPassed, false);
  assert.deepEqual(candidate.suppressionModelFingerprints, ["fnv1a:test-suppressor"]);
  assert(candidate.blockers.includes("protected-final-neutral-overrides-1"));
  assert(candidate.blockers.includes("default-final-neutral-overrides-1"));
  assert(candidate.blockers.includes("protected-active-value-or-time-to-best-missing"));
  assert(candidate.blockers.includes("fresh-active-value-or-time-to-best-missing"));
  assert(candidate.diagnostics.includes("product-time-to-best-gate-failed"));

  const text = fs.readFileSync(path.join(outputDir, "lns-window-ranker-promotion-recheck.txt"), "utf8");
  assert.match(text, /promotionReady=no/);
  assert.match(text, /productAxis=pass/);
  assert.match(text, /protectedAxis=fail/);

  const telemetry = JSON.parse(fs.readFileSync(path.join(outputDir, "telemetry-manifest.json"), "utf8"));
  assert.equal(telemetry.source, "model-experiment");
  assert.equal(telemetry.metrics.productAxisPassedCandidateCount, 1);

  const registryDraft = JSON.parse(fs.readFileSync(path.join(outputDir, "registry-entry-draft.json"), "utf8"));
  assert.equal(registryDraft.artifactType, "model-experiment");
  assert.deepEqual(registryDraft.caseFamilies, [
    "lns-window-ranker-online-default",
    "lns-window-ranker-online-fresh",
    "lns-window-ranker-online-product",
    "lns-window-ranker-online-protected"
  ]);
  assert.equal(registryDraft.runId, repeatRegistryDraft.runId);
  assert.equal(registryDraft.datasetFingerprint, repeatRegistryDraft.datasetFingerprint);
  assert.equal(registryDraft.budget.scorecardCount, 4);
  assert.equal(budgetContainsOnlyRegistrySafeValues(registryDraft.budget), true);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS window-ranker promotion recheck script tests passed.");
