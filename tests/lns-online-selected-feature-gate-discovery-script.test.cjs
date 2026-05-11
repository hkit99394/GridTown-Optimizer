const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");
const tempRoot = path.join(repoRoot, "artifacts", `tmp-lns-online-selected-feature-gate-discovery-${process.pid}`);
const sourceDir = path.join(tempRoot, "source");
const topReportingSourceDir = path.join(tempRoot, "source-top-reporting");
const selectionCapSourceDir = path.join(tempRoot, "source-selection-cap");
const conjunctionCapSourceDir = path.join(tempRoot, "source-conjunction-cap");
const tripleConjunctionCapSourceDir = path.join(tempRoot, "source-triple-conjunction-cap");
const closeNumericSourceDir = path.join(tempRoot, "source-close-numeric");
const perFeatureCapSourceDir = path.join(tempRoot, "source-per-feature-cap");
const perFeatureConjunctionSourceDir = path.join(tempRoot, "source-per-feature-conjunction-cap");
const multiTraceSourceDir = path.join(tempRoot, "source-multi-trace");
const duplicateCaseSourceDir = path.join(tempRoot, "source-duplicate-case");
const renamedCaseSourceDir = path.join(tempRoot, "source-renamed-case");
const reportExampleSourceDir = path.join(tempRoot, "source-report-example");
const safetySourceDir = path.join(tempRoot, "source-final-safety");
const outputDir = path.join(tempRoot, "out");
const topReportingOutputDirTop1 = path.join(tempRoot, "out-top-reporting-top1");
const topReportingOutputDirTop5 = path.join(tempRoot, "out-top-reporting-top5");
const selectionCapOutputDir = path.join(tempRoot, "out-selection-cap");
const conjunctionCapOutputDir = path.join(tempRoot, "out-conjunction-cap");
const tripleConjunctionCapOutputDir = path.join(tempRoot, "out-triple-conjunction-cap");
const closeNumericOutputDir = path.join(tempRoot, "out-close-numeric");
const reservationStarvationOutputDir = path.join(tempRoot, "out-reservation-starvation");
const perFeatureCapOutputDir = path.join(tempRoot, "out-per-feature-cap");
const perFeatureConjunctionOutputDir = path.join(tempRoot, "out-per-feature-conjunction-cap");
const multiTraceOutputDir = path.join(tempRoot, "out-multi-trace");
const duplicateCaseOutputDir = path.join(tempRoot, "out-duplicate-case");
const renamedCaseOutputDir = path.join(tempRoot, "out-renamed-case");
const reportExampleOutputDir = path.join(tempRoot, "out-report-example");
const finalTargetOutputDir = path.join(tempRoot, "out-final-target");
const finalTargetSafetyOutputDir = path.join(tempRoot, "out-final-target-safety");

function repoRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

function trace({ status, area, operatorScore }) {
  return {
    selectionStatus: "override",
    outcomeStatus: status,
    iteration: 0,
    transition: "weak-service->sliding",
    selectedOperator: "sliding",
    selectedFeatures: {
      area,
      operatorScore,
      selectedByBaseline: 0
    }
  };
}

function variant({ finalStatus, finalDelta, traceStatus, area, operatorScore }) {
  return {
    variantName: "window-ranker",
    seed: 7,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: [trace({ status: traceStatus, area, operatorScore })]
  };
}

function variantWithFeatures({ finalStatus, finalDelta, selectedFeatures }) {
  return {
    variantName: "window-ranker",
    seed: 11,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: [
      {
        selectionStatus: "override",
        outcomeStatus: "neutral",
        iteration: 0,
        transition: "weak-service->sliding",
        selectedOperator: "sliding",
        selectedFeatures
      }
    ]
  };
}

function variantWithSelectionOutcomeFeatures({
  finalStatus = "neutral",
  finalDelta = 0,
  outcomeStatus,
  selectedFeatures,
  seed = 11
}) {
  return {
    variantName: "window-ranker",
    seed,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: [
      {
        selectionStatus: "override",
        outcomeStatus,
        iteration: 0,
        transition: "weak-service->sliding",
        selectedOperator: "sliding",
        selectedFeatures
      }
    ]
  };
}

function variantWithTraceFeatures({ finalStatus, finalDelta, traceFeatures }) {
  return {
    variantName: "window-ranker",
    seed: 13,
    populationDeltaVsBaseline: finalDelta,
    finalOutcome: {
      status: finalStatus,
      populationDeltaVsBaseline: finalDelta
    },
    selectionTrace: traceFeatures.map((entry, iteration) =>
      entry.selectionStatus
        ? entry
        : {
            selectionStatus: "override",
            outcomeStatus: "neutral",
            iteration,
            transition: iteration === 0 ? "weak-service->sliding" : "sliding->random",
            selectedOperator: iteration === 0 ? "sliding" : "random",
            selectedFeatures: entry
          }
    )
  };
}

function variantWithWindowedSelectionFeatures({ outcomeStatus, selectedWindow, selectedFeatures, seed = 23 }) {
  return {
    variantName: "window-ranker",
    seed,
    populationDeltaVsBaseline: 0,
    finalOutcome: {
      status: "neutral",
      populationDeltaVsBaseline: 0
    },
    selectionTrace: [
      {
        selectionStatus: "override",
        outcomeStatus,
        iteration: 0,
        transition: "weak-service->sliding",
        selectedOperator: "sliding",
        selectedWindow,
        selectedFeatures
      }
    ]
  };
}

fs.rmSync(tempRoot, { recursive: true, force: true });

try {
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "good-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({
                finalStatus: "improved",
                finalDelta: 50,
                traceStatus: "improved",
                area: 0.6,
                operatorScore: 9.74
              })
            ]
          },
          {
            name: "bad-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({
                finalStatus: "regressed",
                finalDelta: -50,
                traceStatus: "neutral",
                area: 0.45,
                operatorScore: 9.86
              })
            ]
          },
          {
            name: "neutral-pocket",
            pressureFamily: "service-pressure",
            seed: 7,
            variants: [
              variant({ finalStatus: "neutral", finalDelta: 0, traceStatus: "neutral", area: 0.45, operatorScore: 7.5 })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const result = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(sourceDir)}`,
      `--artifact-dir=${repoRelative(outputDir)}`,
      "--feature-allowlist=area,operatorScore",
      "--max-group-size=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const discovery = JSON.parse(
    fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(discovery.schemaVersion, 2);
  assert.equal(discovery.target, "selection-improved");
  assert.equal(discovery.v2DeprecatedMetricAliases.aliases.finalRegressed, "terminalFinalRegressed");
  assert.match(discovery.v2DeprecatedMetricAliases.note, /schema-v1 artifacts/);
  assert.match(discovery.metricSemantics.safetyRegressed, /every selected trace/);
  assert.equal(discovery.rowSummary.overrideTraceCount, 3);
  assert.equal(discovery.rowSummary.targetImproved, 1);
  assert.equal(discovery.rowSummary.selectionImproved, 1);
  assert.equal(discovery.rowSummary.selectionRegressed, 0);
  assert.equal(discovery.rowSummary.terminalFinalRegressed, 1);
  assert.equal(discovery.rowSummary.finalRegressed, 1);
  assert.equal(discovery.rowSummary.safetyRegressed, 1);
  assert.equal(discovery.greedySelectedGateGroups.safeNoRegression, true);
  assert.equal(discovery.greedySelectedGateGroups.selectionImproved, 1);
  assert.equal(discovery.greedySelectedGateGroups.finalRegressed, 0);
  assert.equal(discovery.greedySelectedGateGroups.safetyRegressed, 0);
  assert.match(discovery.greedySelectedGateGroups.cliArg, /area>=0\.6|area<=0\.6/);
  assert.match(
    fs.readFileSync(path.join(outputDir, "online-selected-feature-gate-discovery.txt"), "utf8"),
    /safety-regressed=/
  );
  const telemetry = JSON.parse(fs.readFileSync(path.join(outputDir, "telemetry-manifest.json"), "utf8"));
  assert.equal(telemetry.schemaVersion, 2);
  assert.equal(telemetry.metrics.terminalFinalRegressed, 1);
  assert.equal(telemetry.v2DeprecatedMetricAliases.aliases.finalRegressed, "terminalFinalRegressed");
  assert.match(telemetry.v2DeprecatedMetricAliases.note, /schema-v1 artifacts/);
  const registry = JSON.parse(fs.readFileSync(path.join(outputDir, "registry-entry-draft.json"), "utf8"));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(
    registry.splitStatus.metricSemantics.terminalFinalRegressed,
    discovery.metricSemantics.terminalFinalRegressed
  );
  assert.match(registry.splitStatus.v2DeprecatedMetricAliases.note, /schema-v1 artifacts/);

  fs.mkdirSync(topReportingSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(topReportingSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "top-reporting-positive-a",
            seed: 16,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { topA: 1, topB: 0, selectedByBaseline: 0 },
                seed: 16
              })
            ]
          },
          {
            name: "top-reporting-positive-b",
            seed: 16,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { topA: 0, topB: 1, selectedByBaseline: 0 },
                seed: 16
              })
            ]
          },
          {
            name: "top-reporting-broad-regression",
            seed: 16,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { topA: 0, topB: 0, selectedByBaseline: 0 },
                seed: 16
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  for (const [top, output] of [
    [1, topReportingOutputDirTop1],
    [5, topReportingOutputDirTop5]
  ]) {
    const topReportingResult = childProcess.spawnSync(
      process.execPath,
      [
        "scripts/discover-lns-online-selected-feature-gates.mjs",
        `--source-artifact=${repoRelative(topReportingSourceDir)}`,
        `--artifact-dir=${repoRelative(output)}`,
        "--feature-allowlist=topA,topB",
        "--max-group-size=1",
        `--top=${top}`
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(topReportingResult.status, 0, topReportingResult.stderr || topReportingResult.stdout);
  }
  function readTopReportingArtifacts(output) {
    return {
      discovery: JSON.parse(fs.readFileSync(path.join(output, "online-selected-feature-gate-discovery.json"), "utf8")),
      text: fs.readFileSync(path.join(output, "online-selected-feature-gate-discovery.txt"), "utf8"),
      telemetry: JSON.parse(fs.readFileSync(path.join(output, "telemetry-manifest.json"), "utf8")),
      registry: JSON.parse(fs.readFileSync(path.join(output, "registry-entry-draft.json"), "utf8"))
    };
  }
  const topReportingTop1 = readTopReportingArtifacts(topReportingOutputDirTop1);
  const topReportingTop5 = readTopReportingArtifacts(topReportingOutputDirTop5);
  const topReportingTop1Discovery = topReportingTop1.discovery;
  const topReportingTop5Discovery = topReportingTop5.discovery;
  const topReportingGreedyMetricNames = [
    "selected",
    "cliArg",
    "targetImproved",
    "selectionImproved",
    "selectionRegressed",
    "terminalFinalImproved",
    "terminalFinalRegressed",
    "finalImproved",
    "finalRegressed",
    "safetyRegressed",
    "neutral",
    "safeNoRegression"
  ];
  const topReportingTelemetryGreedyMetricNames = [
    "greedySelectedFeatureGateGroups",
    "greedySelectedFeatureGateGroupsCliArg",
    "greedyTargetImproved",
    "greedySelectionImproved",
    "greedySelectionRegressed",
    "greedyTerminalFinalImproved",
    "greedyTerminalFinalRegressed",
    "greedyFinalImproved",
    "greedyFinalRegressed",
    "greedySafetyRegressed",
    "greedyNeutral",
    "greedySafeNoRegression"
  ];
  assert.equal(topReportingTop1Discovery.topCandidateCount, 1);
  assert.ok(topReportingTop1Discovery.candidateCount > topReportingTop1Discovery.topCandidateCount);
  assert.equal(topReportingTop5Discovery.candidateCount, topReportingTop1Discovery.candidateCount);
  assert.equal(topReportingTop5Discovery.topCandidateCount, Math.min(5, topReportingTop5Discovery.candidateCount));
  assert.notEqual(topReportingTop5Discovery.topCandidateCount, topReportingTop1Discovery.topCandidateCount);
  assert.equal(topReportingTop5Discovery.discoveryFingerprint, topReportingTop1Discovery.discoveryFingerprint);
  assert.equal(topReportingTop5.telemetry.discoveryFingerprint, topReportingTop1.telemetry.discoveryFingerprint);
  assert.equal(topReportingTop5.registry.datasetFingerprint, topReportingTop1.registry.datasetFingerprint);
  assert.notEqual(topReportingTop5.telemetry.reportFingerprint, topReportingTop1.telemetry.reportFingerprint);
  assert.notEqual(topReportingTop5.registry.reportFingerprint, topReportingTop1.registry.reportFingerprint);
  assert.equal(topReportingTop5.registry.reportFingerprint, topReportingTop5.telemetry.reportFingerprint);
  assert.equal(topReportingTop1.registry.reportFingerprint, topReportingTop1.telemetry.reportFingerprint);
  assert.notEqual(topReportingTop5.registry.runId, topReportingTop1.registry.runId);
  for (const topReportingArtifacts of [topReportingTop1, topReportingTop5]) {
    const {
      discovery: topDiscovery,
      telemetry: topTelemetry,
      registry: topRegistry,
      text: topText
    } = topReportingArtifacts;
    assert.equal(topTelemetry.metrics.candidateCount, topDiscovery.candidateCount);
    assert.equal(topTelemetry.metrics.topCandidateCount, topDiscovery.topCandidateCount);
    assert.equal(topRegistry.budget.candidateCount, topDiscovery.candidateCount);
    assert.equal(topRegistry.budget.topCandidateCount, topDiscovery.topCandidateCount);
    assert.equal(topRegistry.summaryMetrics.candidateCount, topDiscovery.candidateCount);
    assert.equal(topRegistry.summaryMetrics.topCandidateCount, topDiscovery.topCandidateCount);
    assert.match(
      topText,
      new RegExp(`candidates=${topDiscovery.candidateCount} total / ${topDiscovery.topCandidateCount} reported`)
    );
  }
  for (const metricName of topReportingGreedyMetricNames) {
    assert.deepEqual(
      topReportingTop1Discovery.greedySelectedGateGroups[metricName],
      topReportingTop5Discovery.greedySelectedGateGroups[metricName]
    );
  }
  for (const metricName of topReportingTelemetryGreedyMetricNames) {
    assert.deepEqual(topReportingTop1.telemetry.metrics[metricName], topReportingTop5.telemetry.metrics[metricName]);
    assert.deepEqual(
      topReportingTop1.registry.summaryMetrics[metricName],
      topReportingTop5.registry.summaryMetrics[metricName]
    );
  }
  assert.equal(topReportingTop1Discovery.greedySelectedGateGroups.targetImproved, 2);
  assert.equal(topReportingTop5Discovery.greedySelectedGateGroups.targetImproved, 2);
  assert.equal(topReportingTop1Discovery.greedySelectedGateGroups.safetyRegressed, 0);

  fs.mkdirSync(closeNumericSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(closeNumericSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "close-value-a",
            seed: 18,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { closeValue: 1.0000001, selectedByBaseline: 0 },
                seed: 18
              })
            ]
          },
          {
            name: "close-value-b",
            seed: 18,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { closeValue: 1.0000002, selectedByBaseline: 0 },
                seed: 18
              })
            ]
          },
          {
            name: "close-value-regression",
            seed: 18,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { closeValue: 0, selectedByBaseline: 0 },
                seed: 18
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const closeNumericResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(closeNumericSourceDir)}`,
      `--artifact-dir=${repoRelative(closeNumericOutputDir)}`,
      "--feature-allowlist=closeValue",
      "--max-group-size=1",
      "--top=20"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(closeNumericResult.status, 0, closeNumericResult.stderr || closeNumericResult.stdout);
  const closeNumericDiscovery = JSON.parse(
    fs.readFileSync(path.join(closeNumericOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  const closeNumericCliArgs = closeNumericDiscovery.topCandidates.map((candidate) => candidate.cliArg).join(";");
  assert.match(closeNumericCliArgs, /closeValue>=1\.0000001/);
  assert.match(closeNumericCliArgs, /closeValue>=1\.0000002/);
  const closeNumericAtomSignatures = new Set(
    closeNumericDiscovery.topCandidates.flatMap((candidate) => candidate.atoms.map((atom) => atom.signature))
  );
  assert.ok(closeNumericAtomSignatures.has("closeValue:min:1.0000001"));
  assert.ok(closeNumericAtomSignatures.has("closeValue:min:1.0000002"));

  fs.mkdirSync(selectionCapSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(selectionCapSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "safe-selection-positive",
            seed: 12,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { safeSelection: 1, riskySelection: 1, selectedByBaseline: 0 },
                seed: 12
              })
            ]
          },
          {
            name: "risky-selection-positive",
            seed: 12,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { safeSelection: 0, riskySelection: 1, selectedByBaseline: 0 },
                seed: 12
              })
            ]
          },
          {
            name: "risky-selection-regression",
            seed: 12,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { safeSelection: 0, riskySelection: 1, selectedByBaseline: 0 },
                seed: 12
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const selectionCapResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(selectionCapSourceDir)}`,
      `--artifact-dir=${repoRelative(selectionCapOutputDir)}`,
      "--feature-allowlist=safeSelection,riskySelection",
      "--max-group-size=1",
      "--max-total-atoms=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(selectionCapResult.status, 0, selectionCapResult.stderr || selectionCapResult.stdout);
  const selectionCapDiscovery = JSON.parse(
    fs.readFileSync(path.join(selectionCapOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(selectionCapDiscovery.atomCount, 1);
  assert.equal(selectionCapDiscovery.cappedAtomSummary.includedUnsafeTargetAtomCount, 0);
  assert.match(selectionCapDiscovery.topCandidates[0].cliArg, /^safeSelection>=1/);
  assert.equal(selectionCapDiscovery.topCandidates[0].selectionRegressed, 0);
  assert.equal(selectionCapDiscovery.topCandidates[0].safetyRegressed, 0);

  fs.mkdirSync(conjunctionCapSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(conjunctionCapSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "narrowed-positive",
            seed: 14,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: {
                  riskyConjunction: 1,
                  narrowingConjunction: 1,
                  safeDistractor: 1,
                  selectedByBaseline: 0
                },
                seed: 14
              })
            ]
          },
          {
            name: "broad-positive",
            seed: 14,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: {
                  riskyConjunction: 1,
                  narrowingConjunction: 0,
                  safeDistractor: 0,
                  selectedByBaseline: 0
                },
                seed: 14
              })
            ]
          },
          {
            name: "broad-regression",
            seed: 14,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: {
                  riskyConjunction: 1,
                  narrowingConjunction: 0,
                  safeDistractor: 0,
                  selectedByBaseline: 0
                },
                seed: 14
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const conjunctionCapResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(conjunctionCapSourceDir)}`,
      `--artifact-dir=${repoRelative(conjunctionCapOutputDir)}`,
      "--feature-allowlist=riskyConjunction,narrowingConjunction",
      "--max-group-size=3",
      "--max-total-atoms=2",
      "--top=10"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(conjunctionCapResult.status, 0, conjunctionCapResult.stderr || conjunctionCapResult.stdout);
  const conjunctionCapDiscovery = JSON.parse(
    fs.readFileSync(path.join(conjunctionCapOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(conjunctionCapDiscovery.atomCount, 2);
  assert.ok(conjunctionCapDiscovery.cappedAtomSummary.reservedConjunctionPairCount >= 1);
  assert.equal(conjunctionCapDiscovery.cappedAtomSummary.omittedReservedConjunctionAtomCount, 0);
  assert.equal(
    conjunctionCapDiscovery.cappedAtomSummary.includedReservedConjunctionAtomCount,
    conjunctionCapDiscovery.cappedAtomSummary.reservedConjunctionAtomCount
  );
  assert.equal(conjunctionCapDiscovery.maxGroupSize, 3);
  assert.equal(conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchMaxGroupSize, 3);
  assert.equal(conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSupportsRequestedMaxGroupSize, true);
  assert.equal(conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchExhaustive, false);
  assert.equal(conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationCoversRequestedMaxGroupSize, false);
  assert.ok(
    conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationConsideredUnsafeTargetAtomCount <=
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationAvailableUnsafeTargetAtomCount
  );
  assert.ok(
    conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationConsideredPartnerAtomCount <=
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationAvailablePartnerAtomCount
  );
  assert.equal(
    conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchExhaustive,
    !(
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSlicedUnsafeTargetAtoms ||
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSlicedPartnerAtoms ||
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationExhaustedSearchBudget ||
      conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationReachedReservationAtomCap
    )
  );
  assert.match(conjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchDescription, /Bounded recursive/);
  assert.ok(conjunctionCapDiscovery.cappedAtomSummary.reservedUnsafeConjunctionAtomCount >= 1);
  assert.ok(conjunctionCapDiscovery.cappedAtomSummary.includedUnsafeTargetAtomCount >= 1);
  assert.ok(
    conjunctionCapDiscovery.topCandidates.some(
      (candidate) =>
        /riskyConjunction/.test(candidate.cliArg) &&
        /narrowingConjunction/.test(candidate.cliArg) &&
        candidate.selectionRegressed === 0 &&
        candidate.safetyRegressed === 0
    )
  );

  const reservationStarvationResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(conjunctionCapSourceDir)}`,
      `--artifact-dir=${repoRelative(reservationStarvationOutputDir)}`,
      "--feature-allowlist=riskyConjunction,narrowingConjunction,safeDistractor",
      "--max-group-size=2",
      "--max-total-atoms=2",
      "--top=10"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(
    reservationStarvationResult.status,
    0,
    reservationStarvationResult.stderr || reservationStarvationResult.stdout
  );
  const reservationStarvationDiscovery = JSON.parse(
    fs.readFileSync(path.join(reservationStarvationOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(reservationStarvationDiscovery.atomCount, 2);
  assert.ok(reservationStarvationDiscovery.cappedAtomSummary.reservedConjunctionPairCount >= 1);
  assert.equal(reservationStarvationDiscovery.cappedAtomSummary.omittedReservedConjunctionAtomCount, 0);
  assert.equal(
    reservationStarvationDiscovery.cappedAtomSummary.includedReservedConjunctionAtomCount,
    reservationStarvationDiscovery.cappedAtomSummary.reservedConjunctionAtomCount
  );
  assert.ok(reservationStarvationDiscovery.cappedAtomSummary.safeTargetAtomCount >= 1);
  const reservationStarvationReservedCliArgs = new Set(
    reservationStarvationDiscovery.cappedAtomSummary.reservedConjunctionExamples.map((example) => example.cliArg)
  );
  assert.ok(
    reservationStarvationDiscovery.topCandidates.some(
      (candidate) =>
        candidate.atomCount === 2 &&
        reservationStarvationReservedCliArgs.has(candidate.cliArg) &&
        candidate.selectionRegressed === 0 &&
        candidate.safetyRegressed === 0
    )
  );

  fs.mkdirSync(tripleConjunctionCapSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(tripleConjunctionCapSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "triple-only-positive",
            seed: 19,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { tripleA: 1, tripleB: 1, tripleC: 1, selectedByBaseline: 0 },
                seed: 19
              })
            ]
          },
          {
            name: "triple-pair-ab-regression",
            seed: 19,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { tripleA: 1, tripleB: 1, tripleC: 0, selectedByBaseline: 0 },
                seed: 19
              })
            ]
          },
          {
            name: "triple-pair-ac-regression",
            seed: 19,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { tripleA: 1, tripleB: 0, tripleC: 1, selectedByBaseline: 0 },
                seed: 19
              })
            ]
          },
          {
            name: "triple-pair-bc-regression",
            seed: 19,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { tripleA: 0, tripleB: 1, tripleC: 1, selectedByBaseline: 0 },
                seed: 19
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const tripleConjunctionCapResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(tripleConjunctionCapSourceDir)}`,
      `--artifact-dir=${repoRelative(tripleConjunctionCapOutputDir)}`,
      "--feature-allowlist=tripleA,tripleB,tripleC",
      "--max-group-size=3",
      "--max-total-atoms=3",
      "--top=10"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(
    tripleConjunctionCapResult.status,
    0,
    tripleConjunctionCapResult.stderr || tripleConjunctionCapResult.stdout
  );
  const tripleConjunctionCapDiscovery = JSON.parse(
    fs.readFileSync(path.join(tripleConjunctionCapOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(tripleConjunctionCapDiscovery.atomCount, 3);
  assert.equal(tripleConjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchMaxGroupSize, 3);
  assert.equal(
    tripleConjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSupportsRequestedMaxGroupSize,
    true
  );
  assert.equal(tripleConjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationSearchExhaustive, false);
  assert.equal(
    tripleConjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationCoversRequestedMaxGroupSize,
    false
  );
  assert.ok(tripleConjunctionCapDiscovery.cappedAtomSummary.reservedConjunctionTripleCount >= 1);
  assert.equal(tripleConjunctionCapDiscovery.cappedAtomSummary.conjunctionReservationExhaustedSearchBudget, false);
  assert.ok(
    tripleConjunctionCapDiscovery.topCandidates.some(
      (candidate) =>
        candidate.atomCount === 3 &&
        /tripleA/.test(candidate.cliArg) &&
        /tripleB/.test(candidate.cliArg) &&
        /tripleC/.test(candidate.cliArg) &&
        candidate.selectionImproved === 1 &&
        candidate.safetyRegressed === 0
    )
  );

  fs.mkdirSync(perFeatureCapSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(perFeatureCapSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "low-safe-positive",
            seed: 15,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { cappedFeature: 1, selectedByBaseline: 0 },
                seed: 15
              })
            ]
          },
          ...["high-unsafe-positive-a", "high-unsafe-positive-b"].map((name) => ({
            name,
            seed: 15,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { cappedFeature: 3, selectedByBaseline: 0 },
                seed: 15
              })
            ]
          })),
          {
            name: "high-unsafe-regression",
            seed: 15,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { cappedFeature: 3, selectedByBaseline: 0 },
                seed: 15
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const perFeatureCapResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(perFeatureCapSourceDir)}`,
      `--artifact-dir=${repoRelative(perFeatureCapOutputDir)}`,
      "--feature-allowlist=cappedFeature",
      "--max-group-size=1",
      "--max-atoms-per-feature=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(perFeatureCapResult.status, 0, perFeatureCapResult.stderr || perFeatureCapResult.stdout);
  const perFeatureCapDiscovery = JSON.parse(
    fs.readFileSync(path.join(perFeatureCapOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.ok(perFeatureCapDiscovery.totalCandidateAtomCount > perFeatureCapDiscovery.perFeatureCappedAtomCount);
  assert.equal(perFeatureCapDiscovery.perFeatureCappedAtomCount, 1);
  assert.equal(perFeatureCapDiscovery.atomCount, 1);
  assert.equal(perFeatureCapDiscovery.topCandidates[0].selectionImproved, 1);
  assert.equal(perFeatureCapDiscovery.topCandidates[0].safetyRegressed, 0);
  assert.doesNotMatch(perFeatureCapDiscovery.topCandidates[0].cliArg, /cappedFeature>=3|cappedFeature<=3/);

  fs.mkdirSync(perFeatureConjunctionSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(perFeatureConjunctionSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "per-feature-safe-distractor-positive",
            seed: 17,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { cappedRisk: 1, narrowGate: 0, selectedByBaseline: 0 },
                seed: 17
              })
            ]
          },
          {
            name: "per-feature-narrowed-positive",
            seed: 17,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { cappedRisk: 3, narrowGate: 1, selectedByBaseline: 0 },
                seed: 17
              })
            ]
          },
          {
            name: "per-feature-broad-positive",
            seed: 17,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { cappedRisk: 3, narrowGate: 0, selectedByBaseline: 0 },
                seed: 17
              })
            ]
          },
          {
            name: "per-feature-broad-regression",
            seed: 17,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { cappedRisk: 3, narrowGate: 0, selectedByBaseline: 0 },
                seed: 17
              })
            ]
          },
          {
            name: "per-feature-narrow-regression",
            seed: 17,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { cappedRisk: 0, narrowGate: 1, selectedByBaseline: 0 },
                seed: 17
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const perFeatureConjunctionResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(perFeatureConjunctionSourceDir)}`,
      `--artifact-dir=${repoRelative(perFeatureConjunctionOutputDir)}`,
      "--feature-allowlist=cappedRisk,narrowGate",
      "--max-group-size=2",
      "--max-atoms-per-feature=1",
      "--max-total-atoms=3",
      "--top=10"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(
    perFeatureConjunctionResult.status,
    0,
    perFeatureConjunctionResult.stderr || perFeatureConjunctionResult.stdout
  );
  const perFeatureConjunctionDiscovery = JSON.parse(
    fs.readFileSync(path.join(perFeatureConjunctionOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.ok(
    perFeatureConjunctionDiscovery.totalCandidateAtomCount > perFeatureConjunctionDiscovery.perFeatureCappedAtomCount
  );
  assert.ok(perFeatureConjunctionDiscovery.cappedAtomSummary.reservedPerFeatureOmittedConjunctionAtomCount >= 1);
  assert.equal(perFeatureConjunctionDiscovery.cappedAtomSummary.omittedReservedConjunctionAtomCount, 0);
  assert.equal(
    perFeatureConjunctionDiscovery.cappedAtomSummary.includedReservedConjunctionAtomCount,
    perFeatureConjunctionDiscovery.cappedAtomSummary.reservedConjunctionAtomCount
  );
  assert.ok(
    perFeatureConjunctionDiscovery.topCandidates.some(
      (candidate) =>
        /cappedRisk/.test(candidate.cliArg) &&
        /narrowGate/.test(candidate.cliArg) &&
        candidate.selectionImproved === 1 &&
        candidate.safetyRegressed === 0
    )
  );

  const finalTargetResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(sourceDir)}`,
      `--artifact-dir=${repoRelative(finalTargetOutputDir)}`,
      "--feature-allowlist=area,operatorScore",
      "--target=final-improved",
      "--max-group-size=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(finalTargetResult.status, 0, finalTargetResult.stderr || finalTargetResult.stdout);
  const finalTargetDiscovery = JSON.parse(
    fs.readFileSync(path.join(finalTargetOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(finalTargetDiscovery.target, "final-improved");
  assert.equal(finalTargetDiscovery.rowSummary.targetImproved, 1);
  assert.equal(finalTargetDiscovery.rowSummary.finalImproved, 1);

  fs.mkdirSync(multiTraceSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(multiTraceSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "late-final-positive",
            seed: 13,
            variants: [
              variantWithTraceFeatures({
                finalStatus: "improved",
                finalDelta: 60,
                traceFeatures: [
                  { earlyFeature: 1, lateFeature: 0, selectedByBaseline: 0 },
                  { earlyFeature: 0, lateFeature: 1, selectedByBaseline: 0 },
                  {
                    selectionStatus: "fallback",
                    outcomeStatus: "neutral",
                    iteration: 2,
                    transition: "random->fallback"
                  }
                ]
              })
            ]
          },
          {
            name: "late-final-regression",
            seed: 13,
            variants: [
              variantWithTraceFeatures({
                finalStatus: "regressed",
                finalDelta: -60,
                traceFeatures: [
                  { earlyFeature: 0, lateFeature: 0, earlyRisk: 1, lateRisk: 0, selectedByBaseline: 0 },
                  { earlyFeature: 0, lateFeature: 0, earlyRisk: 0, lateRisk: 1, selectedByBaseline: 0 },
                  {
                    selectionStatus: "fallback",
                    outcomeStatus: "neutral",
                    iteration: 2,
                    transition: "random->fallback"
                  }
                ]
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const multiTraceResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(multiTraceSourceDir)}`,
      `--artifact-dir=${repoRelative(multiTraceOutputDir)}`,
      "--feature-allowlist=earlyFeature,lateFeature,earlyRisk,lateRisk",
      "--target=final-improved",
      "--max-group-size=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(multiTraceResult.status, 0, multiTraceResult.stderr || multiTraceResult.stdout);
  const multiTraceDiscovery = JSON.parse(
    fs.readFileSync(path.join(multiTraceOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(multiTraceDiscovery.rowSummary.overrideTraceCount, 4);
  assert.equal(multiTraceDiscovery.rowSummary.targetImproved, 1);
  assert.equal(multiTraceDiscovery.rowSummary.terminalFinalImproved, 1);
  assert.equal(multiTraceDiscovery.rowSummary.terminalFinalRegressed, 1);
  assert.equal(multiTraceDiscovery.rowSummary.finalImproved, 1);
  assert.equal(multiTraceDiscovery.rowSummary.finalRegressed, 1);
  assert.equal(multiTraceDiscovery.rowSummary.safetyRegressed, 2);
  assert.doesNotMatch(
    multiTraceDiscovery.topCandidates.map((candidate) => candidate.cliArg).join(";"),
    /earlyFeature>=1|earlyRisk/
  );
  assert.match(multiTraceDiscovery.metricSemantics.terminalFinalRegressed, /terminal override trace/);
  assert.equal(
    multiTraceDiscovery.topCandidates[0].positiveExamples[0].finalOutcomeAttribution,
    "terminal-selected-override-trace"
  );
  assert.equal(multiTraceDiscovery.topCandidates[0].positiveExamples[0].iteration, 1);

  fs.mkdirSync(duplicateCaseSourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(duplicateCaseSourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "duplicate-case-name",
            seed: 21,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "improved",
                selectedFeatures: { duplicateSafe: 1, selectedByBaseline: 0 },
                seed: 21
              })
            ]
          },
          {
            name: "duplicate-case-name",
            seed: 21,
            variants: [
              variantWithSelectionOutcomeFeatures({
                outcomeStatus: "regressed",
                selectedFeatures: { duplicateSafe: 0, selectedByBaseline: 0 },
                seed: 21
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const duplicateCaseResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(duplicateCaseSourceDir)}`,
      `--artifact-dir=${repoRelative(duplicateCaseOutputDir)}`,
      "--feature-allowlist=duplicateSafe",
      "--max-group-size=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(duplicateCaseResult.status, 0, duplicateCaseResult.stderr || duplicateCaseResult.stdout);
  const duplicateCaseDiscovery = JSON.parse(
    fs.readFileSync(path.join(duplicateCaseOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(duplicateCaseDiscovery.rowSummary.overrideTraceCount, 2);
  assert.equal(duplicateCaseDiscovery.greedySelectedGateGroups.selected, 1);
  assert.equal(duplicateCaseDiscovery.greedySelectedGateGroups.targetImproved, 1);
  assert.equal(duplicateCaseDiscovery.greedySelectedGateGroups.selectionRegressed, 0);
  assert.equal(duplicateCaseDiscovery.greedySelectedGateGroups.safetyRegressed, 0);
  assert.equal(duplicateCaseDiscovery.greedySelectedGateGroups.safeNoRegression, true);
  assert.equal(duplicateCaseDiscovery.topCandidates[0].positiveExamples[0].caseIndex, 0);

  fs.mkdirSync(renamedCaseSourceDir, { recursive: true });
  function writeRenamedCaseScorecard(caseNames) {
    fs.writeFileSync(
      path.join(renamedCaseSourceDir, "lns-window-ranker-online-ablation.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          cases: [
            {
              name: caseNames[0],
              seed: 22,
              variants: [
                variantWithSelectionOutcomeFeatures({
                  outcomeStatus: "improved",
                  selectedFeatures: { renameStable: 1, selectedByBaseline: 0 },
                  seed: 22
                })
              ]
            },
            {
              name: caseNames[1],
              seed: 22,
              variants: [
                variantWithSelectionOutcomeFeatures({
                  outcomeStatus: "regressed",
                  selectedFeatures: { renameStable: 0, selectedByBaseline: 0 },
                  seed: 22
                })
              ]
            },
            {
              name: caseNames[2],
              seed: 22,
              variants: [
                variantWithSelectionOutcomeFeatures({
                  outcomeStatus: "neutral",
                  selectedFeatures: { renameStable: 0, selectedByBaseline: 0 },
                  seed: 22
                })
              ]
            }
          ]
        },
        null,
        2
      )
    );
  }
  function runRenamedCaseDiscovery() {
    const result = childProcess.spawnSync(
      process.execPath,
      [
        "scripts/discover-lns-online-selected-feature-gates.mjs",
        `--source-artifact=${repoRelative(renamedCaseSourceDir)}`,
        `--artifact-dir=${repoRelative(renamedCaseOutputDir)}`,
        "--feature-allowlist=renameStable",
        "--max-group-size=1",
        "--top=5",
        "--force-artifact-dir"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return {
      discovery: JSON.parse(
        fs.readFileSync(path.join(renamedCaseOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
      ),
      telemetry: JSON.parse(fs.readFileSync(path.join(renamedCaseOutputDir, "telemetry-manifest.json"), "utf8")),
      registry: JSON.parse(fs.readFileSync(path.join(renamedCaseOutputDir, "registry-entry-draft.json"), "utf8"))
    };
  }
  writeRenamedCaseScorecard(["structural-positive", "structural-regression", "display-only-before"]);
  const renamedCaseBefore = runRenamedCaseDiscovery();
  writeRenamedCaseScorecard(["structural-positive", "structural-regression", "display-only-after"]);
  const renamedCaseAfter = runRenamedCaseDiscovery();
  assert.equal(renamedCaseBefore.discovery.discoveryFingerprint, renamedCaseAfter.discovery.discoveryFingerprint);
  assert.equal(renamedCaseBefore.registry.datasetFingerprint, renamedCaseAfter.registry.datasetFingerprint);
  assert.equal(renamedCaseBefore.registry.datasetFingerprint, renamedCaseBefore.discovery.discoveryFingerprint);
  assert.equal(renamedCaseAfter.registry.datasetFingerprint, renamedCaseAfter.discovery.discoveryFingerprint);
  assert.notEqual(renamedCaseBefore.telemetry.reportFingerprint, renamedCaseAfter.telemetry.reportFingerprint);
  assert.equal(renamedCaseAfter.telemetry.reportFingerprint, renamedCaseAfter.registry.reportFingerprint);
  assert.notEqual(renamedCaseBefore.registry.runId, renamedCaseAfter.registry.runId);
  assert.equal(renamedCaseBefore.discovery.topCandidates[0].positiveExamples[0].caseName, "structural-positive");
  assert.equal(renamedCaseAfter.discovery.topCandidates[0].positiveExamples[0].caseName, "structural-positive");
  assert.deepEqual(renamedCaseBefore.registry.cases, [
    "display-only-before",
    "structural-positive",
    "structural-regression"
  ]);
  assert.deepEqual(renamedCaseAfter.registry.cases, [
    "display-only-after",
    "structural-positive",
    "structural-regression"
  ]);

  fs.mkdirSync(reportExampleSourceDir, { recursive: true });
  function writeReportExampleScorecard(selectedWindow) {
    fs.writeFileSync(
      path.join(reportExampleSourceDir, "lns-window-ranker-online-ablation.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          cases: [
            {
              name: "report-example-positive",
              seed: 23,
              variants: [
                variantWithWindowedSelectionFeatures({
                  outcomeStatus: "improved",
                  selectedWindow,
                  selectedFeatures: { reportStable: 1, selectedByBaseline: 0 },
                  seed: 23
                })
              ]
            },
            {
              name: "report-example-regression",
              seed: 23,
              variants: [
                variantWithWindowedSelectionFeatures({
                  outcomeStatus: "regressed",
                  selectedWindow: { row: 9, col: 9, width: 1, height: 1 },
                  selectedFeatures: { reportStable: 0, selectedByBaseline: 0 },
                  seed: 23
                })
              ]
            }
          ]
        },
        null,
        2
      )
    );
  }
  function runReportExampleDiscovery() {
    const result = childProcess.spawnSync(
      process.execPath,
      [
        "scripts/discover-lns-online-selected-feature-gates.mjs",
        `--source-artifact=${repoRelative(reportExampleSourceDir)}`,
        `--artifact-dir=${repoRelative(reportExampleOutputDir)}`,
        "--feature-allowlist=reportStable",
        "--max-group-size=1",
        "--top=5",
        "--force-artifact-dir"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return {
      discovery: JSON.parse(
        fs.readFileSync(path.join(reportExampleOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
      ),
      telemetry: JSON.parse(fs.readFileSync(path.join(reportExampleOutputDir, "telemetry-manifest.json"), "utf8")),
      registry: JSON.parse(fs.readFileSync(path.join(reportExampleOutputDir, "registry-entry-draft.json"), "utf8"))
    };
  }
  writeReportExampleScorecard({ row: 1, col: 2, width: 2, height: 1 });
  const reportExampleBefore = runReportExampleDiscovery();
  writeReportExampleScorecard({ row: 1, col: 3, width: 2, height: 1 });
  const reportExampleAfter = runReportExampleDiscovery();
  assert.equal(reportExampleBefore.discovery.discoveryFingerprint, reportExampleAfter.discovery.discoveryFingerprint);
  assert.notEqual(reportExampleBefore.telemetry.reportFingerprint, reportExampleAfter.telemetry.reportFingerprint);
  assert.equal(reportExampleAfter.telemetry.reportFingerprint, reportExampleAfter.registry.reportFingerprint);
  assert.deepEqual(reportExampleAfter.discovery.topCandidates[0].positiveExamples[0].selectedWindow, {
    row: 1,
    col: 3,
    width: 2,
    height: 1
  });

  fs.mkdirSync(safetySourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(safetySourceDir, "lns-window-ranker-online-ablation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        cases: [
          {
            name: "safe-final-pocket",
            seed: 11,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 40,
                selectedFeatures: { safePocket: 1, riskyPocket: 1, selectedByBaseline: 0 }
              })
            ]
          },
          {
            name: "risky-final-positive",
            seed: 11,
            variants: [
              variantWithFeatures({
                finalStatus: "improved",
                finalDelta: 30,
                selectedFeatures: { safePocket: 0, riskyPocket: 1, selectedByBaseline: 0 }
              })
            ]
          },
          {
            name: "risky-final-regression",
            seed: 11,
            variants: [
              variantWithFeatures({
                finalStatus: "regressed",
                finalDelta: -30,
                selectedFeatures: { safePocket: 0, riskyPocket: 1, selectedByBaseline: 0 }
              })
            ]
          }
        ]
      },
      null,
      2
    )
  );

  const finalTargetSafetyResult = childProcess.spawnSync(
    process.execPath,
    [
      "scripts/discover-lns-online-selected-feature-gates.mjs",
      `--source-artifact=${repoRelative(safetySourceDir)}`,
      `--artifact-dir=${repoRelative(finalTargetSafetyOutputDir)}`,
      "--feature-allowlist=safePocket,riskyPocket",
      "--target=final-improved",
      "--max-group-size=1",
      "--max-total-atoms=1",
      "--top=5"
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  assert.equal(finalTargetSafetyResult.status, 0, finalTargetSafetyResult.stderr || finalTargetSafetyResult.stdout);
  const finalTargetSafetyDiscovery = JSON.parse(
    fs.readFileSync(path.join(finalTargetSafetyOutputDir, "online-selected-feature-gate-discovery.json"), "utf8")
  );
  assert.equal(finalTargetSafetyDiscovery.atomCount, 1);
  assert.match(finalTargetSafetyDiscovery.topCandidates[0].cliArg, /^safePocket>=1/);
  assert.doesNotMatch(finalTargetSafetyDiscovery.topCandidates[0].cliArg, /riskyPocket/);
  assert.equal(finalTargetSafetyDiscovery.topCandidates[0].finalRegressed, 0);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("LNS online selected-feature gate discovery script tests passed.");
