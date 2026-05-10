#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/discover-lns-online-selected-feature-gates.mjs";
const SCORECARD_FILE = "lns-window-ranker-online-ablation.json";

function usage() {
  return [
    "Usage: node scripts/discover-lns-online-selected-feature-gates.mjs --source-artifact=<dir> --artifact-dir=<dir> [options]",
    "",
    "Discovers diagnostics-only selected-feature gate groups from online LNS window-ranker override traces.",
    "",
    "Options:",
    "  --source-artifact=<dir>       Online ablation artifact dir containing lns-window-ranker-online-ablation.json. Repeatable.",
    "  --source-scorecard=<path>     Direct path to an online ablation JSON file. Repeatable.",
    "  --artifact-dir=<dir>          Artifact bundle output directory under artifacts/.",
    "  --feature-allowlist=<csv>     Restrict candidate features to these selectedFeatures names.",
    "  --max-group-size=<n>          Maximum conjunction size in atoms. Default: 2.",
    "  --max-atoms-per-feature=<n>   Candidate atom cap per feature. Default: 12.",
    "  --top=<n>                     Number of ranked groups to keep. Default: 25.",
    "  --force-artifact-dir          Replace an existing artifact directory."
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
  let artifactDir;
  let featureAllowlist;
  let maxGroupSize = 2;
  let maxAtomsPerFeature = 12;
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
    artifactDir,
    featureAllowlist,
    maxGroupSize,
    maxAtomsPerFeature,
    top,
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

function readJson(repoRelativePath) {
  return JSON.parse(fs.readFileSync(absoluteRepoPath(repoRelativePath), "utf8"));
}

function scorecardPathFromArtifact(artifactDir) {
  return path.posix.join(normalizeRepoRelativePath(artifactDir), SCORECARD_FILE);
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function rowKey(row) {
  return `${row.sourceScorecard}\0${row.caseName}\0${row.seed}\0${row.variantIndex}\0${row.traceIndex}`;
}

function extractRows(sourceScorecards) {
  const rows = [];
  for (const sourceScorecard of sourceScorecards) {
    const scorecard = readJson(sourceScorecard);
    for (const [caseIndex, caseResult] of (scorecard.cases ?? []).entries()) {
      for (const [variantIndex, variant] of (caseResult.variants ?? []).entries()) {
        if (variant.variantName !== "window-ranker") continue;
        for (const [traceIndex, trace] of (variant.selectionTrace ?? []).entries()) {
          if (trace.selectionStatus !== "override" || !trace.selectedFeatures) continue;
          rows.push({
            key: rowKey({
              sourceScorecard,
              caseName: caseResult.name ?? `case-${caseIndex}`,
              seed: caseResult.seed ?? variant.seed ?? "unknown",
              variantIndex,
              traceIndex
            }),
            sourceScorecard,
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

function isPositive(row) {
  return row.selectionOutcomeStatus === "improved";
}

function isRegression(row) {
  return row.selectionOutcomeStatus === "regressed" || row.finalOutcomeStatus === "regressed";
}

function gatePasses(row, gate) {
  const value = row.selectedFeatures[gate.feature];
  return (
    Number.isFinite(value) &&
    (gate.minValue === undefined || value >= gate.minValue) &&
    (gate.maxValue === undefined || value <= gate.maxValue)
  );
}

function atomToGates(atom) {
  return atom.kind === "eq"
    ? [
        { feature: atom.feature, minValue: atom.value },
        { feature: atom.feature, maxValue: atom.value }
      ]
    : atom.kind === "min"
      ? [{ feature: atom.feature, minValue: atom.value }]
      : [{ feature: atom.feature, maxValue: atom.value }];
}

function atomSignature(atom) {
  return `${atom.feature}:${atom.kind}:${formatNumber(atom.value)}`;
}

function gateCliArg(gate) {
  return gate.minValue === undefined
    ? `${gate.feature}<=${formatNumber(gate.maxValue)}`
    : `${gate.feature}>=${formatNumber(gate.minValue)}`;
}

function gatesCliArg(gates) {
  return gates.map(gateCliArg).join(",");
}

function evaluatePredicate(rows, predicate) {
  const selectedRows = rows.filter(predicate);
  const selectedKeys = selectedRows.map((row) => row.key);
  const positiveKeys = selectedRows.filter(isPositive).map((row) => row.key);
  const regressionRows = selectedRows.filter(isRegression);
  return {
    selected: selectedRows.length,
    selectionImproved: positiveKeys.length,
    selectionRegressed: selectedRows.filter((row) => row.selectionOutcomeStatus === "regressed").length,
    finalImproved: selectedRows.filter((row) => row.finalOutcomeStatus === "improved").length,
    finalRegressed: regressionRows.length,
    neutral: selectedRows.filter((row) => !isPositive(row) && !isRegression(row)).length,
    unknown: selectedRows.filter(
      (row) => row.selectionOutcomeStatus === "unknown" || row.finalOutcomeStatus === "unknown"
    ).length,
    bestFinalDelta: selectedRows.length ? Math.max(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    worstFinalDelta: selectedRows.length ? Math.min(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    selectedKeys,
    positiveKeys,
    regressionExamples: regressionRows.slice(0, 8).map(rowExample),
    positiveExamples: selectedRows.filter(isPositive).slice(0, 8).map(rowExample)
  };
}

function rowExample(row) {
  return {
    sourceScorecard: row.sourceScorecard,
    caseName: row.caseName,
    pressureFamily: row.pressureFamily,
    seed: row.seed,
    iteration: row.iteration,
    transition: row.transition,
    selectedOperator: row.selectedOperator,
    selectedWindow: row.selectedWindow,
    selectionOutcomeStatus: row.selectionOutcomeStatus,
    finalOutcomeStatus: row.finalOutcomeStatus,
    finalPopulationDelta: row.finalPopulationDelta,
    selectedFeatures: row.selectedFeatures
  };
}

function compareCandidates(left, right) {
  if (left.selectionImproved !== right.selectionImproved) return right.selectionImproved - left.selectionImproved;
  if (left.finalRegressed !== right.finalRegressed) return left.finalRegressed - right.finalRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  if (left.atomCount !== right.atomCount) return left.atomCount - right.atomCount;
  return left.cliArg.localeCompare(right.cliArg);
}

function compareAtoms(left, right) {
  if (left.selectionImproved !== right.selectionImproved) return right.selectionImproved - left.selectionImproved;
  if (left.finalRegressed !== right.finalRegressed) return left.finalRegressed - right.finalRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  return left.signature.localeCompare(right.signature);
}

function buildAtoms(rows, features, maxAtomsPerFeature) {
  return features.flatMap((feature) => {
    const featureAtoms = uniqueSortedNumbers(rows.map((row) => row.selectedFeatures[feature]))
      .flatMap((value) => [
        { feature, kind: "eq", value },
        { feature, kind: "min", value },
        { feature, kind: "max", value }
      ])
      .map((atom) => ({
        ...atom,
        signature: atomSignature(atom),
        gates: atomToGates(atom),
        ...evaluatePredicate(rows, (row) => atomToGates(atom).every((gate) => gatePasses(row, gate)))
      }))
      .filter((atom) => atom.selectionImproved > 0)
      .sort(compareAtoms);
    return featureAtoms.slice(0, maxAtomsPerFeature);
  });
}

function buildCandidate(atomGroup, rows) {
  const gates = atomGroup.flatMap(atomToGates);
  const cliArg = gatesCliArg(gates);
  const metrics = evaluatePredicate(rows, (row) => gates.every((gate) => gatePasses(row, gate)));
  return {
    atomCount: atomGroup.length,
    atoms: atomGroup.map(({ feature, kind, value, signature }) => ({ feature, kind, value, signature })),
    gates,
    cliArg,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.selectionImproved > 0 && metrics.finalRegressed === 0
  };
}

function enumerateCandidates(rows, atoms, maxGroupSize) {
  const candidates = [];
  const seen = new Set();

  function visit(start, group, usedFeatures) {
    if (group.length > 0) {
      const candidate = buildCandidate(group, rows);
      const signature = candidate.cliArg;
      if (!seen.has(signature)) {
        seen.add(signature);
        if (candidate.selectionImproved > 0 && candidate.finalRegressed === 0) candidates.push(candidate);
      }
    }
    if (group.length >= maxGroupSize) return;
    for (let index = start; index < atoms.length; index += 1) {
      const atom = atoms[index];
      if (usedFeatures.has(atom.feature)) continue;
      usedFeatures.add(atom.feature);
      group.push(atom);
      visit(index + 1, group, usedFeatures);
      group.pop();
      usedFeatures.delete(atom.feature);
    }
  }

  visit(0, [], new Set());
  return candidates.sort(compareCandidates);
}

function buildGreedyGroupSet(rows, candidates) {
  const uncovered = new Set(rows.filter(isPositive).map((row) => row.key));
  const selectedGroups = [];
  const selectedKeys = new Set();
  for (const candidate of candidates) {
    const positiveGain = candidate.positiveKeys.filter((key) => uncovered.has(key)).length;
    if (positiveGain === 0) continue;
    selectedGroups.push(candidate);
    for (const key of candidate.selectedKeys) selectedKeys.add(key);
    for (const key of candidate.positiveKeys) uncovered.delete(key);
    if (uncovered.size === 0) break;
  }
  const metrics = evaluatePredicate(rows, (row) => selectedKeys.has(row.key));
  return {
    groups: selectedGroups.map((candidate) => ({
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      selectionImproved: candidate.selectionImproved,
      finalRegressed: candidate.finalRegressed,
      neutral: candidate.neutral,
      selected: candidate.selected
    })),
    selectedFeatureGateGroups: selectedGroups.map((candidate) => candidate.gates),
    cliArg: selectedGroups.map((candidate) => candidate.cliArg).join(";"),
    uncoveredPositiveCount: uncovered.size,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.selectionImproved > 0 && metrics.finalRegressed === 0
  };
}

function buildDiscovery(rows, options, benchmarkApi, sourceScorecards) {
  const features = (
    options.featureAllowlist ??
    [...new Set(rows.flatMap((row) => Object.keys(row.selectedFeatures)))].filter(
      (feature) => feature !== "selectedByBaseline"
    )
  )
    .filter((feature) => rows.some((row) => Number.isFinite(row.selectedFeatures[feature])))
    .sort();
  const atoms = buildAtoms(rows, features, options.maxAtomsPerFeature);
  const candidates = enumerateCandidates(rows, atoms, options.maxGroupSize).slice(0, options.top);
  const greedy = buildGreedyGroupSet(rows, candidates);
  const rowSummary = evaluatePredicate(rows, () => true);
  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    generatedAt,
    sourceScorecards,
    featureAllowlist: options.featureAllowlist ?? null,
    features,
    maxGroupSize: options.maxGroupSize,
    maxAtomsPerFeature: options.maxAtomsPerFeature,
    top: options.top,
    rowSummary: {
      overrideTraceCount: rows.length,
      selectionImproved: rowSummary.selectionImproved,
      selectionRegressed: rowSummary.selectionRegressed,
      finalImproved: rowSummary.finalImproved,
      finalRegressed: rowSummary.finalRegressed,
      neutral: rowSummary.neutral,
      unknown: rowSummary.unknown,
      bestFinalDelta: rowSummary.bestFinalDelta,
      worstFinalDelta: rowSummary.worstFinalDelta
    },
    candidateCount: candidates.length,
    topCandidates: candidates.map((candidate) => ({
      atomCount: candidate.atomCount,
      atoms: candidate.atoms,
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      selected: candidate.selected,
      selectionImproved: candidate.selectionImproved,
      finalImproved: candidate.finalImproved,
      finalRegressed: candidate.finalRegressed,
      neutral: candidate.neutral,
      unknown: candidate.unknown,
      bestFinalDelta: candidate.bestFinalDelta,
      worstFinalDelta: candidate.worstFinalDelta,
      safeNoRegression: candidate.safeNoRegression,
      positiveExamples: candidate.positiveExamples,
      regressionExamples: candidate.regressionExamples
    })),
    greedySelectedGateGroups: greedy
  };
  return {
    ...payload,
    inputFingerprint: benchmarkApi.buildModelExperimentFingerprint({ sourceScorecards }),
    discoveryFingerprint: benchmarkApi.buildModelExperimentFingerprint(payload)
  };
}

function formatDiscovery(discovery) {
  const lines = [
    "LNS online selected-feature gate discovery",
    `generatedAt=${discovery.generatedAt}`,
    `sourceScorecards=${discovery.sourceScorecards.length}`,
    `overrideTraces=${discovery.rowSummary.overrideTraceCount}`,
    `selectionImproved=${discovery.rowSummary.selectionImproved}`,
    `finalRegressed=${discovery.rowSummary.finalRegressed}`,
    `features=${discovery.features.join(",")}`,
    `inputFingerprint=${discovery.inputFingerprint}`,
    `discoveryFingerprint=${discovery.discoveryFingerprint}`,
    "",
    `greedy-selected-groups=${discovery.greedySelectedGateGroups.cliArg || "none"}`,
    `greedy-selected=${discovery.greedySelectedGateGroups.selected} improved=${discovery.greedySelectedGateGroups.selectionImproved} final-regressed=${discovery.greedySelectedGateGroups.finalRegressed} neutral=${discovery.greedySelectedGateGroups.neutral} safe=${discovery.greedySelectedGateGroups.safeNoRegression}`,
    "",
    "top-candidates:"
  ];
  for (const candidate of discovery.topCandidates) {
    lines.push(
      `- ${candidate.cliArg}: selected=${candidate.selected} improved=${candidate.selectionImproved} final-regressed=${candidate.finalRegressed} neutral=${candidate.neutral} worst=${candidate.worstFinalDelta} safe=${candidate.safeNoRegression}`
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
    `--artifact-dir=${options.artifactDir}`,
    `--max-group-size=${options.maxGroupSize}`,
    `--max-atoms-per-feature=${options.maxAtomsPerFeature}`,
    `--top=${options.top}`
  ];
  if (options.featureAllowlist) argv.push(`--feature-allowlist=${options.featureAllowlist.join(",")}`);
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

const options = parseArgs(process.argv.slice(2));
const artifactHelpers = await loadArtifactBundleHelpers();
const benchmarkApi = await loadBenchmarkApi();
const sourceScorecards = [
  ...options.sourceArtifacts.map(scorecardPathFromArtifact),
  ...options.sourceScorecards.map(normalizeRepoRelativePath)
];
const rows = extractRows(sourceScorecards);
if (rows.length === 0) {
  throw new Error("No window-ranker override traces with selectedFeatures found in the supplied source scorecards.");
}

const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
  force: options.forceArtifactDir
});
const discovery = buildDiscovery(rows, options, benchmarkApi, sourceScorecards);
const artifactPaths = artifactPathsFor(artifacts);
const outputArtifacts = diagnosticArtifactPaths(artifactPaths);
const command = replayCommand(artifactHelpers.defaultCliReplayCommand, options);
const telemetryManifest = {
  schemaVersion: 1,
  source: "lns-online-selected-feature-gate-discovery",
  command,
  generatedAt: discovery.generatedAt,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  diagnosticsOnly: true,
  inputFingerprint: discovery.inputFingerprint,
  discoveryFingerprint: discovery.discoveryFingerprint,
  sourceScorecards,
  outputArtifacts,
  metrics: {
    overrideTraceCount: discovery.rowSummary.overrideTraceCount,
    selectionImproved: discovery.rowSummary.selectionImproved,
    finalRegressed: discovery.rowSummary.finalRegressed,
    candidateCount: discovery.candidateCount,
    topCandidateCliArg: discovery.topCandidates[0]?.cliArg ?? null,
    greedySelectedFeatureGateGroups: discovery.greedySelectedGateGroups.selectedFeatureGateGroups,
    greedySelectedFeatureGateGroupsCliArg: discovery.greedySelectedGateGroups.cliArg,
    greedySelectionImproved: discovery.greedySelectedGateGroups.selectionImproved,
    greedyFinalRegressed: discovery.greedySelectedGateGroups.finalRegressed,
    greedyNeutral: discovery.greedySelectedGateGroups.neutral,
    greedySafeNoRegression: discovery.greedySelectedGateGroups.safeNoRegression
  },
  notes:
    "Diagnostics-only selected-feature gate discovery over online LNS window-ranker override traces; no solver default changed."
};
const registryEntryDraft = {
  schemaVersion: 1,
  runId: `lns-online-selected-feature-gate-discovery-${discovery.discoveryFingerprint.slice(-8)}`,
  artifactType: "ablation-gate",
  generatedAt: discovery.generatedAt,
  commands: [command],
  artifactPaths: outputArtifacts,
  cases: [...new Set(rows.map((row) => row.caseName))].sort(),
  caseFamilies: ["lns-window-ranker-online", ...new Set(rows.map((row) => row.pressureFamily).filter(Boolean))].sort(),
  seeds: [...new Set(rows.map((row) => row.seed).filter((seed) => seed !== null))].sort((left, right) => left - right),
  inputFingerprint: discovery.inputFingerprint,
  datasetFingerprint: discovery.discoveryFingerprint,
  splitStatus: {
    diagnosticsOnly: true,
    source: "online-lns-window-ranker-scorecards",
    sourceScorecardCount: sourceScorecards.length
  },
  budget: {
    sourceScorecardCount: sourceScorecards.length,
    overrideTraceCount: discovery.rowSummary.overrideTraceCount,
    maxGroupSize: options.maxGroupSize,
    maxAtomsPerFeature: options.maxAtomsPerFeature,
    candidateCount: discovery.candidateCount
  },
  hardware: telemetryManifest.hardware,
  model: {
    trained: false,
    diagnosticsOnly: true,
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
  inputFingerprint: discovery.inputFingerprint,
  discoveryFingerprint: discovery.discoveryFingerprint,
  sourceScorecards,
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
