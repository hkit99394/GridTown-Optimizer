#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {
  DISCOVERY_TARGETS,
  DISCOVERY_ARTIFACT_SCHEMA_VERSION,
  METRIC_SEMANTICS,
  SCORECARD_FILE,
  SCRIPT_PATH,
  TELEMETRY_MANIFEST_SCHEMA_VERSION,
  V2_DEPRECATED_METRIC_ALIASES,
  usage
} from "./lib/online-selected-feature-gate-config.mjs";
import {
  atomCapSummary,
  atomComparatorForTarget,
  buildAtoms,
  buildGreedyGroupSet,
  buildValidationGreedyGroupSet,
  enumerateCandidates,
  evaluatePredicate,
  metricsReportProjection,
  rowSummaryFromMetrics,
  selectCappedAtoms
} from "./lib/online-selected-feature-gate-core.mjs";
import {
  discoveryIdentityPayload,
  registryDisplayProjection,
  reportIdentityPayload
} from "./lib/online-selected-feature-gate-report.mjs";

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
    "Missing dist/benchmarkApi.js. Run npm run build before discovering online selected-feature gates."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before discovering online selected-feature gates."
  );
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  const sourceArtifacts = [];
  const sourceScorecards = [];
  const validationSourceArtifacts = [];
  const validationSourceScorecards = [];
  let artifactDir;
  let featureAllowlist;
  let target = "selection-improved";
  let maxGroupSize = 2;
  let maxAtomsPerFeature = 12;
  let maxTotalAtoms = 120;
  let top = 25;
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
    if (arg.startsWith("--source-artifact=")) {
      sourceArtifacts.push(arg.slice("--source-artifact=".length));
      continue;
    }
    if (arg.startsWith("--source-scorecard=")) {
      sourceScorecards.push(arg.slice("--source-scorecard=".length));
      continue;
    }
    if (arg.startsWith("--validation-source-artifact=")) {
      validationSourceArtifacts.push(arg.slice("--validation-source-artifact=".length));
      continue;
    }
    if (arg.startsWith("--validation-source-scorecard=")) {
      validationSourceScorecards.push(arg.slice("--validation-source-scorecard=".length));
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = arg.slice("--artifact-dir=".length);
      continue;
    }
    if (arg.startsWith("--feature-allowlist=")) {
      featureAllowlist = arg
        .slice("--feature-allowlist=".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      continue;
    }
    if (arg.startsWith("--target=")) {
      target = normalizeTarget(arg.slice("--target=".length));
      continue;
    }
    if (arg.startsWith("--max-group-size=")) {
      maxGroupSize = parsePositiveInteger(arg.slice("--max-group-size=".length), "--max-group-size");
      continue;
    }
    if (arg.startsWith("--max-atoms-per-feature=")) {
      maxAtomsPerFeature = parsePositiveInteger(
        arg.slice("--max-atoms-per-feature=".length),
        "--max-atoms-per-feature"
      );
      continue;
    }
    if (arg.startsWith("--max-total-atoms=")) {
      maxTotalAtoms = parsePositiveInteger(arg.slice("--max-total-atoms=".length), "--max-total-atoms");
      continue;
    }
    if (arg.startsWith("--top=")) {
      top = parsePositiveInteger(arg.slice("--top=".length), "--top");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!artifactDir) throw new Error("--artifact-dir=<dir> is required.");
  if (sourceArtifacts.length === 0 && sourceScorecards.length === 0) {
    throw new Error("--source-artifact=<dir> or --source-scorecard=<path> is required.");
  }
  return {
    sourceArtifacts,
    sourceScorecards,
    validationSourceArtifacts,
    validationSourceScorecards,
    artifactDir,
    featureAllowlist,
    target,
    maxGroupSize,
    maxAtomsPerFeature,
    maxTotalAtoms,
    top,
    forceArtifactDir
  };
}

function normalizeTarget(value) {
  const normalized = value.trim();
  const target = normalized === "final" || normalized === "final-lift" ? "final-improved" : normalized;
  if (!DISCOVERY_TARGETS.has(target)) {
    throw new Error("--target must be selection-improved or final-improved.");
  }
  return target;
}

function normalizeRepoRelativePath(inputPath, label = "Path") {
  return artifactHelpers.resolveRepoInputPath(inputPath, label);
}

function readJsonInputArtifact(repoRelativePath, label) {
  return artifactHelpers.readJsonRepoInputArtifact(repoRelativePath, label).value;
}

function rowKey(row) {
  return `${row.sourceScorecard}\0${row.caseIndex}\0${row.seed}\0${row.variantIndex}\0${row.traceIndex}`;
}

function extractRows(sourceScorecards) {
  const rows = [];
  for (const sourceScorecard of sourceScorecards) {
    const scorecard = readJsonInputArtifact(sourceScorecard, "--source-scorecard");
    for (const [caseIndex, caseResult] of (scorecard.cases ?? []).entries()) {
      for (const [variantIndex, variant] of (caseResult.variants ?? []).entries()) {
        if (variant.variantName !== "window-ranker") continue;
        const selectionTrace = variant.selectionTrace ?? [];
        const terminalSelectedOverrideTraceIndex = selectionTrace.reduce((terminalIndex, trace, traceIndex) => {
          return trace.selectionStatus === "override" && trace.selectedFeatures ? traceIndex : terminalIndex;
        }, -1);
        for (const [traceIndex, trace] of selectionTrace.entries()) {
          if (trace.selectionStatus !== "override" || !trace.selectedFeatures) continue;
          const finalOutcomeAttributed = traceIndex === terminalSelectedOverrideTraceIndex;
          rows.push({
            key: rowKey({
              sourceScorecard,
              caseIndex,
              seed: caseResult.seed ?? variant.seed ?? "unknown",
              variantIndex,
              traceIndex
            }),
            sourceScorecard,
            caseIndex,
            caseName: caseResult.name ?? `case-${caseIndex}`,
            pressureFamily: caseResult.pressureFamily ?? null,
            seed: caseResult.seed ?? variant.seed ?? null,
            variantIndex,
            traceIndex,
            iteration: trace.iteration ?? null,
            transition: trace.transition ?? null,
            selectedOperator: trace.selectedOperator ?? trace.appliedOperator ?? null,
            selectedWindow: trace.selectedWindow ?? trace.appliedWindow ?? null,
            scoreDelta: trace.scoreDelta ?? null,
            selectionOutcomeStatus: trace.outcomeStatus ?? "unknown",
            selectionImprovement: trace.improvement ?? 0,
            finalOutcomeAttributed,
            finalOutcomeAttribution: finalOutcomeAttributed
              ? "terminal-selected-override-trace"
              : "not-terminal-selected-override-trace",
            finalOutcomeStatus: variant.finalOutcome?.status ?? "unknown",
            finalPopulationDelta:
              variant.finalOutcome?.populationDeltaVsBaseline ?? variant.populationDeltaVsBaseline ?? 0,
            selectedFeatures: trace.selectedFeatures
          });
        }
      }
    }
  }
  return rows;
}

function scorecardPathFromArtifact(artifactDir, label) {
  const repoRelativeArtifactDir = normalizeRepoRelativePath(artifactDir, label);
  return artifactHelpers.resolveRepoInputArtifactPath(path.posix.join(repoRelativeArtifactDir, SCORECARD_FILE), label, {
    mustExist: true
  });
}

function buildDiscovery(rows, validationRows, options, benchmarkApi, sourceScorecards, validationSourceScorecards) {
  const features = (
    options.featureAllowlist ??
    [...new Set(rows.flatMap((row) => Object.keys(row.selectedFeatures)))].filter(
      (feature) => feature !== "selectedByBaseline"
    )
  )
    .filter((feature) => rows.some((row) => Number.isFinite(row.selectedFeatures[feature])))
    .sort();
  const atomBuild = buildAtoms(rows, features, options.maxAtomsPerFeature, options.target, options.maxGroupSize);
  const totalCandidateAtoms = atomBuild.totalCandidateAtoms.sort(atomComparatorForTarget(options.target));
  const perFeatureCappedAtoms = atomBuild.perFeatureCappedAtoms.sort(atomComparatorForTarget(options.target));
  const { atoms, capDetails } = selectCappedAtoms(perFeatureCappedAtoms, options.maxTotalAtoms, options.target, {
    rows,
    maxGroupSize: options.maxGroupSize,
    reservationAtoms: totalCandidateAtoms
  });
  const cappedAtomSummary = atomCapSummary(totalCandidateAtoms, perFeatureCappedAtoms, atoms, capDetails);
  const candidates = enumerateCandidates(rows, atoms, options.maxGroupSize, options.target, validationRows);
  const topCandidates = candidates.slice(0, options.top);
  const greedy = buildGreedyGroupSet(rows, candidates, options.target);
  const validationGreedy = buildValidationGreedyGroupSet(rows, validationRows, candidates, options.target);
  const rowSummary = evaluatePredicate(rows, () => true, options.target);
  const validationRowSummary = evaluatePredicate(validationRows, () => true, options.target);
  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: DISCOVERY_ARTIFACT_SCHEMA_VERSION,
    generatedAt,
    target: options.target,
    metricSemantics: METRIC_SEMANTICS,
    v2DeprecatedMetricAliases: V2_DEPRECATED_METRIC_ALIASES,
    sourceScorecards,
    validationSourceScorecards,
    featureAllowlist: options.featureAllowlist ?? null,
    features,
    maxGroupSize: options.maxGroupSize,
    maxAtomsPerFeature: options.maxAtomsPerFeature,
    maxTotalAtoms: options.maxTotalAtoms,
    totalCandidateAtomCount: totalCandidateAtoms.length,
    perFeatureCappedAtomCount: perFeatureCappedAtoms.length,
    atomCount: atoms.length,
    cappedAtomSummary,
    top: options.top,
    rowSummary: rowSummaryFromMetrics(rowSummary),
    validationRowSummary: rowSummaryFromMetrics(validationRowSummary),
    candidateCount: candidates.length,
    topCandidateCount: topCandidates.length,
    topCandidates: topCandidates.map((candidate) => ({
      atomCount: candidate.atomCount,
      atoms: candidate.atoms,
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      selected: candidate.selected,
      targetImproved: candidate.targetImproved,
      selectionImproved: candidate.selectionImproved,
      selectionRegressed: candidate.selectionRegressed,
      terminalFinalImproved: candidate.terminalFinalImproved,
      terminalFinalRegressed: candidate.terminalFinalRegressed,
      finalImproved: candidate.finalImproved,
      finalRegressed: candidate.finalRegressed,
      safetyRegressed: candidate.safetyRegressed,
      neutral: candidate.neutral,
      unknown: candidate.unknown,
      bestFinalDelta: candidate.bestFinalDelta,
      worstFinalDelta: candidate.worstFinalDelta,
      safeNoRegression: candidate.safeNoRegression,
      validation: candidate.validation ? metricsReportProjection(candidate.validation) : null,
      positiveExamples: candidate.positiveExamples,
      regressionExamples: candidate.regressionExamples,
      selectionRegressionExamples: candidate.selectionRegressionExamples,
      finalRegressionExamples: candidate.finalRegressionExamples,
      safetyRegressionExamples: candidate.safetyRegressionExamples
    })),
    greedySelectedGateGroups: greedy,
    validationGreedySelectedGateGroups: validationGreedy
  };
  return {
    ...payload,
    inputFingerprint: benchmarkApi.buildModelExperimentFingerprint({ sourceScorecards, validationSourceScorecards }),
    discoveryFingerprint: benchmarkApi.buildModelExperimentFingerprint(discoveryIdentityPayload(payload))
  };
}

function formatDiscovery(discovery) {
  const lines = [
    "LNS online selected-feature gate discovery",
    `generatedAt=${discovery.generatedAt}`,
    `target=${discovery.target}`,
    `sourceScorecards=${discovery.sourceScorecards.length}`,
    `validationSourceScorecards=${discovery.validationSourceScorecards.length}`,
    `overrideTraces=${discovery.rowSummary.overrideTraceCount}`,
    `targetImproved=${discovery.rowSummary.targetImproved}`,
    `selectionImproved=${discovery.rowSummary.selectionImproved}`,
    `selectionRegressed=${discovery.rowSummary.selectionRegressed}`,
    `terminalFinalImproved=${discovery.rowSummary.terminalFinalImproved}`,
    `terminalFinalRegressed=${discovery.rowSummary.terminalFinalRegressed}`,
    `safetyRegressed=${discovery.rowSummary.safetyRegressed}`,
    `validationOverrideTraces=${discovery.validationRowSummary.overrideTraceCount}`,
    `validationTargetImproved=${discovery.validationRowSummary.targetImproved}`,
    `validationSelectionImproved=${discovery.validationRowSummary.selectionImproved}`,
    `validationSelectionRegressed=${discovery.validationRowSummary.selectionRegressed}`,
    `validationTerminalFinalImproved=${discovery.validationRowSummary.terminalFinalImproved}`,
    `validationTerminalFinalRegressed=${discovery.validationRowSummary.terminalFinalRegressed}`,
    `validationSafetyRegressed=${discovery.validationRowSummary.safetyRegressed}`,
    `features=${discovery.features.join(",")}`,
    `atoms=${discovery.atomCount} global-capped / ${discovery.perFeatureCappedAtomCount} per-feature-capped / ${discovery.totalCandidateAtomCount} total-candidate`,
    `safeTargetAtoms=${discovery.cappedAtomSummary.includedSafeTargetAtomCount}/${discovery.cappedAtomSummary.safeTargetAtomCount}`,
    `safeSingletonAdmissionQuota=${discovery.cappedAtomSummary.safeSingletonAdmissionQuota}`,
    `conjunctionReservationSearch=${discovery.cappedAtomSummary.conjunctionReservationSearchDescription}`,
    `conjunctionReservationSearchMaxGroupSize=${discovery.cappedAtomSummary.conjunctionReservationSearchMaxGroupSize}`,
    `conjunctionReservationSupportsRequestedMaxGroupSize=${discovery.cappedAtomSummary.conjunctionReservationSupportsRequestedMaxGroupSize}`,
    `conjunctionReservationSearchExhaustive=${discovery.cappedAtomSummary.conjunctionReservationSearchExhaustive}`,
    `conjunctionReservationCoversRequestedMaxGroupSize=${discovery.cappedAtomSummary.conjunctionReservationCoversRequestedMaxGroupSize}`,
    `conjunctionReservationUnsafeAtoms=${discovery.cappedAtomSummary.conjunctionReservationConsideredUnsafeTargetAtomCount}/${discovery.cappedAtomSummary.conjunctionReservationAvailableUnsafeTargetAtomCount} considered`,
    `conjunctionReservationPartnerAtoms=${discovery.cappedAtomSummary.conjunctionReservationConsideredPartnerAtomCount}/${discovery.cappedAtomSummary.conjunctionReservationAvailablePartnerAtomCount} considered`,
    `candidates=${discovery.candidateCount} total / ${discovery.topCandidateCount} reported`,
    `inputFingerprint=${discovery.inputFingerprint}`,
    `discoveryFingerprint=${discovery.discoveryFingerprint}`,
    "",
    `greedy-selected-groups=${discovery.greedySelectedGateGroups.cliArg || "none"}`,
    `greedy-selected=${discovery.greedySelectedGateGroups.selected} target-improved=${discovery.greedySelectedGateGroups.targetImproved} selection-improved=${discovery.greedySelectedGateGroups.selectionImproved} selection-regressed=${discovery.greedySelectedGateGroups.selectionRegressed} terminal-final-improved=${discovery.greedySelectedGateGroups.terminalFinalImproved} terminal-final-regressed=${discovery.greedySelectedGateGroups.terminalFinalRegressed} safety-regressed=${discovery.greedySelectedGateGroups.safetyRegressed} neutral=${discovery.greedySelectedGateGroups.neutral} safe=${discovery.greedySelectedGateGroups.safeNoRegression}`,
    discovery.validationGreedySelectedGateGroups
      ? `validation-greedy-selected-groups=${discovery.validationGreedySelectedGateGroups.cliArg || "none"}`
      : null,
    discovery.validationGreedySelectedGateGroups
      ? `validation-greedy-selected=${discovery.validationGreedySelectedGateGroups.selected} target-improved=${discovery.validationGreedySelectedGateGroups.targetImproved} selection-improved=${discovery.validationGreedySelectedGateGroups.selectionImproved} selection-regressed=${discovery.validationGreedySelectedGateGroups.selectionRegressed} terminal-final-improved=${discovery.validationGreedySelectedGateGroups.terminalFinalImproved} terminal-final-regressed=${discovery.validationGreedySelectedGateGroups.terminalFinalRegressed} safety-regressed=${discovery.validationGreedySelectedGateGroups.safetyRegressed} neutral=${discovery.validationGreedySelectedGateGroups.neutral} safe=${discovery.validationGreedySelectedGateGroups.safeNoRegression}`
      : null,
    "",
    "top-candidates:"
  ].filter((line) => line !== null);
  for (const candidate of discovery.topCandidates) {
    const validationText = candidate.validation
      ? ` validation-selected=${candidate.validation.selected} validation-target-improved=${candidate.validation.targetImproved} validation-selection-regressed=${candidate.validation.selectionRegressed} validation-terminal-final-regressed=${candidate.validation.terminalFinalRegressed} validation-safety-regressed=${candidate.validation.safetyRegressed} validation-neutral=${candidate.validation.neutral} validation-safe=${candidate.validation.safeNoRegression}`
      : "";
    lines.push(
      `- ${candidate.cliArg}: selected=${candidate.selected} target-improved=${candidate.targetImproved} selection-improved=${candidate.selectionImproved} selection-regressed=${candidate.selectionRegressed} terminal-final-improved=${candidate.terminalFinalImproved} terminal-final-regressed=${candidate.terminalFinalRegressed} safety-regressed=${candidate.safetyRegressed} neutral=${candidate.neutral} worst=${candidate.worstFinalDelta} safe=${candidate.safeNoRegression}${validationText}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function artifactPathsFor(artifacts) {
  return {
    discoveryJson: artifacts.artifactPath("online-selected-feature-gate-discovery.json"),
    discoveryText: artifacts.artifactPath("online-selected-feature-gate-discovery.txt"),
    telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
    registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
    manifestJson: artifacts.artifactPath("manifest.json")
  };
}

function diagnosticArtifactPaths(artifactPaths) {
  return Object.entries(artifactPaths)
    .filter(([name]) => name !== "registryEntryDraftJson")
    .map(([, artifactPath]) => artifactPath);
}

function replayCommand(defaultCliReplayCommand, options) {
  const argv = [
    ...options.sourceArtifacts.map((source) => `--source-artifact=${normalizeRepoRelativePath(source)}`),
    ...options.sourceScorecards.map((source) => `--source-scorecard=${normalizeRepoRelativePath(source)}`),
    ...options.validationSourceArtifacts.map(
      (source) => `--validation-source-artifact=${normalizeRepoRelativePath(source)}`
    ),
    ...options.validationSourceScorecards.map(
      (source) => `--validation-source-scorecard=${normalizeRepoRelativePath(source)}`
    ),
    `--artifact-dir=${options.artifactDir}`,
    `--target=${options.target}`,
    `--max-group-size=${options.maxGroupSize}`,
    `--max-atoms-per-feature=${options.maxAtomsPerFeature}`,
    `--max-total-atoms=${options.maxTotalAtoms}`,
    `--top=${options.top}`
  ];
  if (options.featureAllowlist) argv.push(`--feature-allowlist=${options.featureAllowlist.join(",")}`);
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

const options = parseArgs(process.argv.slice(2));
const artifactHelpers = await loadArtifactBundleHelpers();
const benchmarkApi = await loadBenchmarkApi();
const registryEntrySchemaVersion = benchmarkApi.EXPERIMENT_REGISTRY_SCHEMA_VERSION;
const sourceScorecards = [
  ...options.sourceArtifacts.map((source) => scorecardPathFromArtifact(source, "--source-artifact")),
  ...options.sourceScorecards.map((source) =>
    artifactHelpers.resolveRepoInputArtifactPath(source, "--source-scorecard", { mustExist: true })
  )
];
const validationSourceScorecards = [
  ...options.validationSourceArtifacts.map((source) =>
    scorecardPathFromArtifact(source, "--validation-source-artifact")
  ),
  ...options.validationSourceScorecards.map((source) =>
    artifactHelpers.resolveRepoInputArtifactPath(source, "--validation-source-scorecard", { mustExist: true })
  )
];
const rows = extractRows(sourceScorecards);
if (rows.length === 0) {
  throw new Error("No window-ranker override traces with selectedFeatures found in the supplied source scorecards.");
}
const validationRows = extractRows(validationSourceScorecards);
if (validationSourceScorecards.length > 0 && validationRows.length === 0) {
  throw new Error(
    "No window-ranker override traces with selectedFeatures found in the supplied validation source scorecards."
  );
}

const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
  force: options.forceArtifactDir
});
const discovery = buildDiscovery(
  rows,
  validationRows,
  options,
  benchmarkApi,
  sourceScorecards,
  validationSourceScorecards
);
const artifactPaths = artifactPathsFor(artifacts);
const outputArtifacts = diagnosticArtifactPaths(artifactPaths);
const command = replayCommand(artifactHelpers.defaultCliReplayCommand, options);
const registryDisplay = registryDisplayProjection([...rows, ...validationRows]);
const reportFingerprint = benchmarkApi.buildModelExperimentFingerprint(
  reportIdentityPayload({
    discovery,
    command,
    artifactDir: artifacts.artifactDir,
    outputArtifacts,
    top: options.top,
    registryDisplay
  })
);
const telemetryManifest = {
  schemaVersion: TELEMETRY_MANIFEST_SCHEMA_VERSION,
  source: "lns-online-selected-feature-gate-discovery",
  command,
  generatedAt: discovery.generatedAt,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  diagnosticsOnly: true,
  target: discovery.target,
  metricSemantics: METRIC_SEMANTICS,
  v2DeprecatedMetricAliases: V2_DEPRECATED_METRIC_ALIASES,
  inputFingerprint: discovery.inputFingerprint,
  discoveryFingerprint: discovery.discoveryFingerprint,
  reportFingerprint,
  sourceScorecards,
  validationSourceScorecards,
  outputArtifacts,
  metrics: {
    sourceScorecardCount: sourceScorecards.length,
    validationSourceScorecardCount: validationSourceScorecards.length,
    overrideTraceCount: discovery.rowSummary.overrideTraceCount,
    targetImproved: discovery.rowSummary.targetImproved,
    selectionImproved: discovery.rowSummary.selectionImproved,
    selectionRegressed: discovery.rowSummary.selectionRegressed,
    terminalFinalImproved: discovery.rowSummary.terminalFinalImproved,
    terminalFinalRegressed: discovery.rowSummary.terminalFinalRegressed,
    finalImproved: discovery.rowSummary.finalImproved,
    finalRegressed: discovery.rowSummary.finalRegressed,
    safetyRegressed: discovery.rowSummary.safetyRegressed,
    validationOverrideTraceCount: discovery.validationRowSummary.overrideTraceCount,
    validationTargetImproved: discovery.validationRowSummary.targetImproved,
    validationSelectionImproved: discovery.validationRowSummary.selectionImproved,
    validationSelectionRegressed: discovery.validationRowSummary.selectionRegressed,
    validationTerminalFinalImproved: discovery.validationRowSummary.terminalFinalImproved,
    validationTerminalFinalRegressed: discovery.validationRowSummary.terminalFinalRegressed,
    validationFinalImproved: discovery.validationRowSummary.finalImproved,
    validationFinalRegressed: discovery.validationRowSummary.finalRegressed,
    validationSafetyRegressed: discovery.validationRowSummary.safetyRegressed,
    totalCandidateAtomCount: discovery.totalCandidateAtomCount,
    perFeatureCappedAtomCount: discovery.perFeatureCappedAtomCount,
    atomCount: discovery.atomCount,
    safeTargetAtomCount: discovery.cappedAtomSummary.safeTargetAtomCount,
    includedSafeTargetAtomCount: discovery.cappedAtomSummary.includedSafeTargetAtomCount,
    omittedSafeTargetAtomCount: discovery.cappedAtomSummary.omittedSafeTargetAtomCount,
    includedUnsafeTargetAtomCount: discovery.cappedAtomSummary.includedUnsafeTargetAtomCount,
    safeSingletonAdmissionQuota: discovery.cappedAtomSummary.safeSingletonAdmissionQuota,
    conjunctionReservationSearchMaxGroupSize: discovery.cappedAtomSummary.conjunctionReservationSearchMaxGroupSize,
    conjunctionReservationSupportsRequestedMaxGroupSize:
      discovery.cappedAtomSummary.conjunctionReservationSupportsRequestedMaxGroupSize,
    conjunctionReservationSearchExhaustive: discovery.cappedAtomSummary.conjunctionReservationSearchExhaustive,
    conjunctionReservationCoversRequestedMaxGroupSize:
      discovery.cappedAtomSummary.conjunctionReservationCoversRequestedMaxGroupSize,
    conjunctionReservationAvailableUnsafeTargetAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationAvailableUnsafeTargetAtomCount,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationConsideredUnsafeTargetAtomCount,
    conjunctionReservationAvailablePartnerAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationAvailablePartnerAtomCount,
    conjunctionReservationConsideredPartnerAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationConsideredPartnerAtomCount,
    conjunctionReservationSlicedUnsafeTargetAtoms:
      discovery.cappedAtomSummary.conjunctionReservationSlicedUnsafeTargetAtoms,
    conjunctionReservationSlicedPartnerAtoms: discovery.cappedAtomSummary.conjunctionReservationSlicedPartnerAtoms,
    conjunctionReservationReachedReservationAtomCap:
      discovery.cappedAtomSummary.conjunctionReservationReachedReservationAtomCap,
    candidateCount: discovery.candidateCount,
    topCandidateCount: discovery.topCandidateCount,
    topCandidateCliArg: discovery.topCandidates[0]?.cliArg ?? null,
    greedySelectedFeatureGateGroups: discovery.greedySelectedGateGroups.selectedFeatureGateGroups,
    greedySelectedFeatureGateGroupsCliArg: discovery.greedySelectedGateGroups.cliArg,
    greedyTargetImproved: discovery.greedySelectedGateGroups.targetImproved,
    greedySelectionImproved: discovery.greedySelectedGateGroups.selectionImproved,
    greedySelectionRegressed: discovery.greedySelectedGateGroups.selectionRegressed,
    greedyTerminalFinalImproved: discovery.greedySelectedGateGroups.terminalFinalImproved,
    greedyTerminalFinalRegressed: discovery.greedySelectedGateGroups.terminalFinalRegressed,
    greedyFinalImproved: discovery.greedySelectedGateGroups.finalImproved,
    greedyFinalRegressed: discovery.greedySelectedGateGroups.finalRegressed,
    greedySafetyRegressed: discovery.greedySelectedGateGroups.safetyRegressed,
    greedyNeutral: discovery.greedySelectedGateGroups.neutral,
    greedySafeNoRegression: discovery.greedySelectedGateGroups.safeNoRegression,
    validationGreedySelectedFeatureGateGroups:
      discovery.validationGreedySelectedGateGroups?.selectedFeatureGateGroups ?? null,
    validationGreedySelectedFeatureGateGroupsCliArg: discovery.validationGreedySelectedGateGroups?.cliArg ?? null,
    validationGreedyTargetImproved: discovery.validationGreedySelectedGateGroups?.targetImproved ?? null,
    validationGreedySelectionImproved: discovery.validationGreedySelectedGateGroups?.selectionImproved ?? null,
    validationGreedySelectionRegressed: discovery.validationGreedySelectedGateGroups?.selectionRegressed ?? null,
    validationGreedyTerminalFinalImproved: discovery.validationGreedySelectedGateGroups?.terminalFinalImproved ?? null,
    validationGreedyTerminalFinalRegressed:
      discovery.validationGreedySelectedGateGroups?.terminalFinalRegressed ?? null,
    validationGreedyFinalImproved: discovery.validationGreedySelectedGateGroups?.finalImproved ?? null,
    validationGreedyFinalRegressed: discovery.validationGreedySelectedGateGroups?.finalRegressed ?? null,
    validationGreedySafetyRegressed: discovery.validationGreedySelectedGateGroups?.safetyRegressed ?? null,
    validationGreedyNeutral: discovery.validationGreedySelectedGateGroups?.neutral ?? null,
    validationGreedySafeNoRegression: discovery.validationGreedySelectedGateGroups?.safeNoRegression ?? null,
    topCandidateValidationTargetImproved: discovery.topCandidates[0]?.validation?.targetImproved ?? null,
    topCandidateValidationSafetyRegressed: discovery.topCandidates[0]?.validation?.safetyRegressed ?? null,
    topCandidateValidationNeutral: discovery.topCandidates[0]?.validation?.neutral ?? null,
    topCandidateValidationSafeNoRegression: discovery.topCandidates[0]?.validation?.safeNoRegression ?? null
  },
  notes:
    "Diagnostics-only selected-feature gate discovery over online LNS window-ranker override traces; no solver default changed."
};
const registryEntryDraft = {
  schemaVersion: registryEntrySchemaVersion,
  runId: `lns-online-selected-feature-gate-discovery-${reportFingerprint.slice(-8)}`,
  artifactType: "ablation-gate",
  generatedAt: discovery.generatedAt,
  commands: [command],
  artifactPaths: outputArtifacts,
  cases: registryDisplay.cases,
  caseFamilies: registryDisplay.caseFamilies,
  seeds: registryDisplay.seeds,
  inputFingerprint: discovery.inputFingerprint,
  datasetFingerprint: discovery.discoveryFingerprint,
  reportFingerprint,
  splitStatus: {
    diagnosticsOnly: true,
    source: "online-lns-window-ranker-scorecards",
    sourceScorecardCount: sourceScorecards.length,
    validationSourceScorecardCount: validationSourceScorecards.length,
    metricSemantics: METRIC_SEMANTICS,
    v2DeprecatedMetricAliases: V2_DEPRECATED_METRIC_ALIASES
  },
  budget: {
    sourceScorecardCount: sourceScorecards.length,
    validationSourceScorecardCount: validationSourceScorecards.length,
    overrideTraceCount: discovery.rowSummary.overrideTraceCount,
    validationOverrideTraceCount: discovery.validationRowSummary.overrideTraceCount,
    maxGroupSize: options.maxGroupSize,
    maxAtomsPerFeature: options.maxAtomsPerFeature,
    maxTotalAtoms: options.maxTotalAtoms,
    totalCandidateAtomCount: discovery.totalCandidateAtomCount,
    perFeatureCappedAtomCount: discovery.perFeatureCappedAtomCount,
    atomCount: discovery.atomCount,
    conjunctionReservationAvailableUnsafeTargetAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationAvailableUnsafeTargetAtomCount,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationConsideredUnsafeTargetAtomCount,
    conjunctionReservationAvailablePartnerAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationAvailablePartnerAtomCount,
    conjunctionReservationConsideredPartnerAtomCount:
      discovery.cappedAtomSummary.conjunctionReservationConsideredPartnerAtomCount,
    candidateCount: discovery.candidateCount,
    topCandidateCount: discovery.topCandidateCount
  },
  hardware: telemetryManifest.hardware,
  model: {
    trained: false,
    diagnosticsOnly: true,
    target: options.target,
    gateKind: "online-selected-feature-threshold-search"
  },
  decision: "diagnostics-only",
  summary:
    "Online LNS window-ranker override traces scanned for safe selected-feature gate groups; no solver default changed.",
  summaryMetrics: telemetryManifest.metrics
};
const manifest = {
  artifactDir: artifacts.artifactDir,
  artifactPaths,
  command,
  generatedAt: discovery.generatedAt,
  target: discovery.target,
  inputFingerprint: discovery.inputFingerprint,
  discoveryFingerprint: discovery.discoveryFingerprint,
  reportFingerprint,
  sourceScorecards,
  validationSourceScorecards,
  featureAllowlist: options.featureAllowlist ?? null,
  generator: {
    script: SCRIPT_PATH,
    requiresBuild: true,
    command
  }
};

artifactHelpers.writeJsonArtifact(
  artifacts.absoluteArtifactPath("online-selected-feature-gate-discovery.json"),
  discovery,
  {
    force: options.forceArtifactDir
  }
);
artifactHelpers.writeTextArtifact(
  artifacts.absoluteArtifactPath("online-selected-feature-gate-discovery.txt"),
  formatDiscovery(discovery),
  { force: options.forceArtifactDir }
);
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
  force: options.forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
  force: options.forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, {
  force: options.forceArtifactDir
});

console.log(`Wrote LNS online selected-feature gate discovery to ${artifacts.artifactDir}`);
