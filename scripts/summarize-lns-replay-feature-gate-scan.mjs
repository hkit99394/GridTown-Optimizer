#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/summarize-lns-replay-feature-gate-scan.mjs";
const DEFAULT_SOURCE_ROOT = "artifacts/lns-window-replay-labels";

const GATES = Object.freeze({
  slidingArea12: {
    description: "non-baseline sliding windows with replay feature area=12",
    predicate: (label) => isNonBaselineSliding(label) && label.features?.area === 12
  },
  slidingArea12NoFeatureIdenticalRepeatabilityConflict: {
    description:
      "non-baseline sliding windows with area=12, excluding labels in feature-identical repeatability conflict buckets",
    predicate: (label) =>
      isNonBaselineSliding(label) &&
      label.features?.area === 12 &&
      label.repeatability?.featureIdenticalConflictBucket !== true
  },
  slidingArea12RepeatabilitySafeBucket: {
    description:
      "non-baseline sliding windows with area=12 whose repeatability bucket has improvement and no regression/unknown labels",
    predicate: isRepeatabilitySafeArea12
  },
  slidingArea12HighServiceCandidatePressure: {
    description:
      "runtime-observable diagnostic: non-baseline sliding area=12 windows with high service candidate bonus and many residential candidates blocked by the incumbent",
    predicate: (label) =>
      isNonBaselineSliding(label) &&
      label.features?.area === 12 &&
      serviceCandidateBonusInside(label) >= 2790 &&
      residentialCandidatesBlocked(label) >= 13
  },
  slidingArea12ServiceComponentPocket: {
    description:
      "runtime-observable diagnostic: non-baseline sliding area=12 windows with high service candidate bonus and two empty components after clearing",
    predicate: (label) =>
      isNonBaselineSliding(label) &&
      label.features?.area === 12 &&
      serviceCandidateBonusInside(label) >= 3227 &&
      componentsAfter(label) === 2
  },
  slidingArea12ObservablePressureEnsemble: {
    description:
      "diagnostics-only screened disjunction over runtime-observable state/window features approximating the repeatability-safe bucket",
    predicate: (label) =>
      isNonBaselineSliding(label) &&
      label.features?.area === 12 &&
      ((serviceCandidateBonusInside(label) >= 2790 && roadCountInside(label) === 0) ||
        (serviceCandidateBonusInside(label) >= 3227 && componentsAfter(label) === 2) ||
        (componentsBefore(label) === 3 && operatorScore(label) <= 975) ||
        (roadCountInside(label) === 3 && incumbentPopulation(label) <= 665))
  },
  slidingArea12ComponentsMax2: {
    description: "non-baseline sliding windows with area=12 and fragmentation components <=2",
    predicate: (label) => isNonBaselineSliding(label) && label.features?.area === 12 && componentsAfter(label) <= 2
  },
  slidingComponentsMax2: {
    description: "non-baseline sliding windows with fragmentation components <=2",
    predicate: (label) => isNonBaselineSliding(label) && componentsAfter(label) <= 2
  },
  slidingTopOrLeft2: {
    description: "non-baseline sliding windows matching the service-braid top/left pocket",
    predicate: (label) =>
      isNonBaselineSliding(label) && (label.window?.top === 0 || (label.window?.top === 2 && label.window?.left === 1))
  },
  allNonBaselineSliding: {
    description: "all non-baseline sliding windows",
    predicate: isNonBaselineSliding
  }
});

function usage() {
  return [
    "Usage: node scripts/summarize-lns-replay-feature-gate-scan.mjs --artifact-dir=<path> [options]",
    "",
    "Scans existing LNS window replay-label artifacts for static and repeatability-aware feature-gate safety.",
    "",
    "Options:",
    `  --source-root=<path>       Root to scan for lns-window-replay-labels.json files. Default: ${DEFAULT_SOURCE_ROOT}`,
    "  --artifact-dir=<path>      Artifact bundle output directory under artifacts/.",
    "  --force-artifact-dir       Replace an existing artifact directory."
  ].join("\n");
}

function parseArgs(argv) {
  let sourceRoot = DEFAULT_SOURCE_ROOT;
  let artifactDir;
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
    if (arg.startsWith("--source-root=")) {
      sourceRoot = arg.slice("--source-root=".length);
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = arg.slice("--artifact-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!artifactDir) throw new Error("--artifact-dir=<path> is required.");
  return { sourceRoot, artifactDir, forceArtifactDir };
}

function repoRoot() {
  return path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
}

function loadDistModule(modulePath, missingMessage) {
  const distModulePath = path.join(repoRoot(), ...modulePath);
  if (!fs.existsSync(distModulePath)) {
    throw new Error(missingMessage);
  }
  return import(url.pathToFileURL(distModulePath).href);
}

function loadBenchmarkApi() {
  return loadDistModule(
    ["dist", "benchmarkApi.js"],
    "Missing dist/benchmarkApi.js. Run npm run build before scanning LNS replay feature gates."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before scanning LNS replay feature gates."
  );
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

function findReplayJsonFiles(sourceRoot) {
  const normalizedRoot = normalizeRepoRelativePath(sourceRoot);
  const absoluteRoot = absoluteRepoPath(normalizedRoot);
  if (!fs.existsSync(absoluteRoot)) {
    throw new Error(`LNS replay source root does not exist: ${normalizedRoot}`);
  }

  const files = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absoluteEntry = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absoluteEntry);
      } else if (entry.isFile() && entry.name === "lns-window-replay-labels.json") {
        files.push(path.relative(repoRoot(), absoluteEntry).split(path.sep).join(path.posix.sep));
      }
    }
  }
  visit(absoluteRoot);
  files.sort();
  return files;
}

function readJsonFile(repoRelativePath) {
  return JSON.parse(fs.readFileSync(absoluteRepoPath(repoRelativePath), "utf8"));
}

function readOptionalJsonFile(repoRelativePath) {
  const absolutePath = absoluteRepoPath(repoRelativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function isNonBaselineSliding(label) {
  return label.operator === "sliding" && label.selectedByBaseline !== true;
}

function isRepeatabilitySafeArea12(label) {
  return (
    isNonBaselineSliding(label) &&
    label.features?.area === 12 &&
    label.repeatability?.hasImproved === true &&
    label.repeatability?.hasRegressed !== true &&
    label.repeatability?.hasUnknown !== true
  );
}

function componentsAfter(label) {
  return label.features?.fragmentation?.emptyComponentCountAfterClearingWindow ?? Number.POSITIVE_INFINITY;
}

function componentsBefore(label) {
  return label.features?.fragmentation?.emptyComponentCountBefore ?? Number.NEGATIVE_INFINITY;
}

function roadCountInside(label) {
  return label.features?.roadCountInside ?? Number.NaN;
}

function serviceCandidateBonusInside(label) {
  return label.features?.candidateLoss?.serviceCandidateBonusInside ?? Number.NEGATIVE_INFINITY;
}

function residentialCandidatesBlocked(label) {
  return label.features?.candidateLoss?.residentialCandidatesBlockedByIncumbent ?? Number.NEGATIVE_INFINITY;
}

function operatorScore(label) {
  return label.operatorScore ?? Number.POSITIVE_INFINITY;
}

function incumbentPopulation(label) {
  return label.incumbentPopulation ?? Number.POSITIVE_INFINITY;
}

function formatWindow(label) {
  const { window } = label;
  if (!window) return "unknown";
  return `${window.top}:${window.left}:${window.rows}x${window.cols}`;
}

function repeatabilityBucketKey(caseResult, label) {
  return [
    label.caseName ?? caseResult.name ?? "unknown",
    label.statePolicy ?? caseResult.statePolicy ?? "unknown",
    label.operator ?? "unknown",
    formatWindow(label)
  ].join("\0");
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortedObject(entry)])
    );
  }
  return value;
}

function featureFingerprint(label) {
  return JSON.stringify(sortedObject(label.features ?? null));
}

function statusFromLabel(label) {
  return label.rollForward?.statusVsBaseline ?? "unknown";
}

function finalDeltaFromLabel(label) {
  return label.rollForward?.populationDeltaVsBaseline ?? 0;
}

function emptyCounts() {
  return {
    selected: 0,
    improved: 0,
    regressed: 0,
    neutral: 0,
    unknown: 0,
    bestDelta: null,
    worstDelta: null
  };
}

function addLabel(counts, label) {
  const status = statusFromLabel(label);
  const delta = finalDeltaFromLabel(label);
  counts.selected += 1;
  if (status === "improved") counts.improved += 1;
  else if (status === "regressed") counts.regressed += 1;
  else if (status === "neutral") counts.neutral += 1;
  else counts.unknown += 1;
  counts.bestDelta = counts.bestDelta === null ? delta : Math.max(counts.bestDelta, delta);
  counts.worstDelta = counts.worstDelta === null ? delta : Math.min(counts.worstDelta, delta);
}

function finalizedCounts(counts) {
  return {
    ...counts,
    bestDelta: counts.bestDelta ?? 0,
    worstDelta: counts.worstDelta ?? 0,
    safeNoRegression: counts.selected > 0 && counts.regressed === 0 && counts.unknown === 0,
    promotionReadyPocket: counts.selected > 0 && counts.improved > 0 && counts.regressed === 0 && counts.unknown === 0
  };
}

function gateExample(sourceArtifact, caseResult, label) {
  const example = {
    sourceArtifact,
    caseName: label.caseName ?? caseResult.name,
    pressureFamily: label.pressureFamily ?? caseResult.pressureFamily,
    seed: label.seed ?? caseResult.seed,
    statePolicy: label.statePolicy ?? caseResult.statePolicy,
    stateIndex: label.stateIndex ?? caseResult.stateIndex,
    operator: label.operator,
    window: label.window,
    delta: finalDeltaFromLabel(label),
    status: statusFromLabel(label),
    area: label.features?.area ?? null,
    roadCountInside: label.features?.roadCountInside ?? null,
    serviceCandidateBonusInside: label.features?.candidateLoss?.serviceCandidateBonusInside ?? null,
    residentialCandidatesBlockedByIncumbent:
      label.features?.candidateLoss?.residentialCandidatesBlockedByIncumbent ?? null,
    incumbentPopulation: label.incumbentPopulation ?? null,
    operatorScore: label.operatorScore ?? null,
    componentsAfter: label.features?.fragmentation?.emptyComponentCountAfterClearingWindow ?? null,
    newlyReachableCells: label.features?.connectivityShadow?.newlyReachableEmptyCellsIfCleared ?? null,
    selectionSource: label.selectionSource ?? null
  };
  if (label.repeatability) {
    example.repeatability = {
      bucketKey: label.repeatability.bucketKey,
      labelCount: label.repeatability.labelCount,
      statusCounts: label.repeatability.statusCounts,
      featureIdenticalConflictBucket: label.repeatability.featureIdenticalConflictBucket
    };
  }
  return example;
}

function addGroupedCount(group, key, label) {
  group[key] ??= emptyCounts();
  addLabel(group[key], label);
}

function summarizeGate(name, gate, loadedArtifacts) {
  const totals = emptyCounts();
  const repeatabilitySafeOverlap = emptyCounts();
  const bySourceArtifact = [];
  const byCase = {};
  const byPressureFamily = {};
  const bySeed = {};
  const examples = [];

  for (const artifact of loadedArtifacts) {
    const artifactCounts = emptyCounts();
    for (const caseResult of artifact.snapshot.cases ?? []) {
      for (const label of caseResult.labels ?? []) {
        if (!gate.predicate(label)) continue;
        addLabel(totals, label);
        if (isRepeatabilitySafeArea12(label)) {
          addLabel(repeatabilitySafeOverlap, label);
        }
        addLabel(artifactCounts, label);
        addGroupedCount(byCase, label.caseName ?? caseResult.name ?? "unknown", label);
        addGroupedCount(byPressureFamily, label.pressureFamily ?? caseResult.pressureFamily ?? "unknown", label);
        addGroupedCount(bySeed, String(label.seed ?? caseResult.seed ?? "case-default"), label);
        if (statusFromLabel(label) !== "neutral" && examples.length < 16) {
          examples.push(gateExample(artifact.artifactDir, caseResult, label));
        }
      }
    }
    if (artifactCounts.selected > 0) {
      bySourceArtifact.push({
        sourceArtifact: artifact.artifactDir,
        ...finalizedCounts(artifactCounts)
      });
    }
  }

  bySourceArtifact.sort((left, right) => {
    if (left.worstDelta !== right.worstDelta) return left.worstDelta - right.worstDelta;
    if (left.regressed !== right.regressed) return right.regressed - left.regressed;
    return right.selected - left.selected;
  });

  return {
    name,
    description: gate.description,
    ...finalizedCounts(totals),
    repeatabilitySafeOverlap: finalizedCounts(repeatabilitySafeOverlap),
    sourceArtifactCount: bySourceArtifact.length,
    bySourceArtifact,
    byCase: Object.fromEntries(Object.entries(byCase).map(([key, value]) => [key, finalizedCounts(value)])),
    byPressureFamily: Object.fromEntries(
      Object.entries(byPressureFamily).map(([key, value]) => [key, finalizedCounts(value)])
    ),
    bySeed: Object.fromEntries(Object.entries(bySeed).map(([key, value]) => [key, finalizedCounts(value)])),
    examples
  };
}

function emptyStatusCounts() {
  return { improved: 0, neutral: 0, regressed: 0, unknown: 0 };
}

function addStatusCount(statusCounts, status) {
  if (status === "improved") statusCounts.improved += 1;
  else if (status === "regressed") statusCounts.regressed += 1;
  else if (status === "neutral") statusCounts.neutral += 1;
  else statusCounts.unknown += 1;
}

function annotateRepeatabilityMetadata(artifact) {
  const buckets = new Map();

  for (const caseResult of artifact.snapshot.cases ?? []) {
    for (const label of caseResult.labels ?? []) {
      if (!label.rollForward) continue;
      const key = repeatabilityBucketKey(caseResult, label);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          labelCount: 0,
          statusCounts: emptyStatusCounts(),
          featureFingerprints: new Set()
        };
        buckets.set(key, bucket);
      }
      bucket.labelCount += 1;
      addStatusCount(bucket.statusCounts, statusFromLabel(label));
      bucket.featureFingerprints.add(featureFingerprint(label));
    }
  }

  for (const caseResult of artifact.snapshot.cases ?? []) {
    for (const label of caseResult.labels ?? []) {
      const bucket = buckets.get(repeatabilityBucketKey(caseResult, label));
      if (!bucket) continue;
      const conflicting = bucket.statusCounts.improved > 0 && bucket.statusCounts.regressed > 0;
      label.repeatability = {
        bucketKey: bucket.key,
        labelCount: bucket.labelCount,
        statusCounts: { ...bucket.statusCounts },
        repeatedBucket: bucket.labelCount > 1,
        mixedStatusBucket:
          [
            bucket.statusCounts.improved,
            bucket.statusCounts.neutral,
            bucket.statusCounts.regressed,
            bucket.statusCounts.unknown
          ].filter((value) => value > 0).length > 1,
        conflictingBucket: conflicting,
        featureIdenticalConflictBucket: conflicting && bucket.featureFingerprints.size === 1,
        hasImproved: bucket.statusCounts.improved > 0,
        hasRegressed: bucket.statusCounts.regressed > 0,
        hasUnknown: bucket.statusCounts.unknown > 0
      };
    }
  }
}

function loadArtifacts(sourceRoot) {
  return findReplayJsonFiles(sourceRoot).map((replayJson) => {
    const artifactDir = path.posix.dirname(replayJson);
    const manifest = readOptionalJsonFile(path.posix.join(artifactDir, "manifest.json"));
    const telemetryManifest = readOptionalJsonFile(path.posix.join(artifactDir, "telemetry-manifest.json"));
    const snapshot = readJsonFile(replayJson);
    const artifact = {
      artifactDir,
      replayJson,
      manifestJson: manifest === null ? null : path.posix.join(artifactDir, "manifest.json"),
      telemetryManifestJson:
        telemetryManifest === null ? null : path.posix.join(artifactDir, "telemetry-manifest.json"),
      inputFingerprint: manifest?.inputFingerprint ?? telemetryManifest?.inputFingerprint ?? null,
      labelFingerprint: manifest?.labelFingerprint ?? telemetryManifest?.labelFingerprint ?? null,
      snapshot
    };
    annotateRepeatabilityMetadata(artifact);
    return artifact;
  });
}

function buildSourceSummary(artifacts) {
  const cases = new Set();
  const pressureFamilies = new Set();
  const seeds = new Set();
  let labelCount = 0;
  let rollForwardLabelCount = 0;
  for (const artifact of artifacts) {
    for (const caseName of artifact.snapshot.selectedCaseNames ?? []) cases.add(caseName);
    for (const family of artifact.snapshot.pressureFamilies ?? []) pressureFamilies.add(family);
    for (const seed of artifact.snapshot.seeds ?? []) seeds.add(seed);
    labelCount += artifact.snapshot.labelCount ?? 0;
    rollForwardLabelCount += artifact.snapshot.rollForwardLabelCount ?? 0;
  }
  return {
    sourceArtifactCount: artifacts.length,
    caseCount: cases.size,
    cases: [...cases].sort(),
    pressureFamilies: [...pressureFamilies].sort(),
    seeds: [...seeds].sort((left, right) => left - right),
    labelCount,
    rollForwardLabelCount
  };
}

function buildScan(artifacts, options, benchmarkApi) {
  const generatedAt = new Date().toISOString();
  const sourceSummary = buildSourceSummary(artifacts);
  const sourceArtifacts = artifacts.map(
    ({
      artifactDir,
      replayJson,
      manifestJson,
      telemetryManifestJson,
      inputFingerprint,
      labelFingerprint,
      snapshot
    }) => ({
      artifactDir,
      replayJson,
      ...(manifestJson === null ? {} : { manifestJson }),
      ...(telemetryManifestJson === null ? {} : { telemetryManifestJson }),
      inputFingerprint,
      labelFingerprint,
      caseCount: snapshot.caseCount ?? snapshot.selectedCaseNames?.length ?? 0,
      seedCount: snapshot.seedCount ?? snapshot.seeds?.length ?? 0,
      stateCount: snapshot.stateCount ?? snapshot.cases?.length ?? 0,
      labelCount: snapshot.labelCount ?? 0,
      rollForwardLabelCount: snapshot.rollForwardLabelCount ?? 0
    })
  );
  const gates = Object.fromEntries(
    Object.entries(GATES).map(([name, gate]) => [name, summarizeGate(name, gate, artifacts)])
  );
  const scan = {
    schemaVersion: 1,
    generatedAt,
    sourceRoot: normalizeRepoRelativePath(options.sourceRoot),
    sourceSummary,
    sourceArtifacts,
    gates
  };
  return {
    ...scan,
    inputFingerprint: benchmarkApi.buildModelExperimentFingerprint({ sourceArtifacts }),
    scanFingerprint: benchmarkApi.buildModelExperimentFingerprint(scan)
  };
}

function formatGate(gate) {
  const lines = [
    `${gate.name}: selected=${gate.selected} improved=${gate.improved} regressed=${gate.regressed} neutral=${gate.neutral} unknown=${gate.unknown} best=${gate.bestDelta} worst=${gate.worstDelta} safe=${gate.safeNoRegression} promotion-pocket=${gate.promotionReadyPocket}`
  ];
  if (gate.repeatabilitySafeOverlap.selected > 0) {
    lines.push(
      `  repeatability-safe-overlap: selected=${gate.repeatabilitySafeOverlap.selected} improved=${gate.repeatabilitySafeOverlap.improved} regressed=${gate.repeatabilitySafeOverlap.regressed} neutral=${gate.repeatabilitySafeOverlap.neutral}`
    );
  }
  const riskyArtifacts = gate.bySourceArtifact.filter((entry) => entry.regressed > 0).slice(0, 5);
  if (riskyArtifacts.length > 0) {
    lines.push("  regressed-artifacts:");
    for (const artifact of riskyArtifacts) {
      lines.push(
        `  - ${artifact.sourceArtifact}: selected=${artifact.selected} improved=${artifact.improved} regressed=${artifact.regressed} neutral=${artifact.neutral} worst=${artifact.worstDelta}`
      );
    }
  }
  return lines.join("\n");
}

function formatScan(scan) {
  const header = [
    "LNS replay feature-gate safety scan",
    `generatedAt=${scan.generatedAt}`,
    `sourceRoot=${scan.sourceRoot}`,
    `sourceArtifacts=${scan.sourceSummary.sourceArtifactCount}`,
    `cases=${scan.sourceSummary.caseCount}`,
    `seeds=${scan.sourceSummary.seeds.join(",")}`,
    `labels=${scan.sourceSummary.labelCount}`,
    `rollForwardLabels=${scan.sourceSummary.rollForwardLabelCount}`,
    `inputFingerprint=${scan.inputFingerprint}`,
    `scanFingerprint=${scan.scanFingerprint}`
  ].join("\n");
  return [header, ...Object.values(scan.gates).map(formatGate)].join("\n\n");
}

function artifactPathsFor(artifacts) {
  return {
    scanJson: artifacts.artifactPath("feature-gate-scan.json"),
    scanText: artifacts.artifactPath("feature-gate-scan.txt"),
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
    `--source-root=${normalizeRepoRelativePath(options.sourceRoot)}`,
    `--artifact-dir=${options.artifactDir}`
  ];
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

const options = parseArgs(process.argv.slice(2));
const artifactHelpers = await loadArtifactBundleHelpers();
const benchmarkApi = await loadBenchmarkApi();
const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
  force: options.forceArtifactDir
});
const loadedArtifacts = loadArtifacts(options.sourceRoot);
if (loadedArtifacts.length === 0) {
  throw new Error(`No lns-window-replay-labels.json files found under ${options.sourceRoot}`);
}

const scan = buildScan(loadedArtifacts, options, benchmarkApi);
const artifactPaths = artifactPathsFor(artifacts);
const outputArtifacts = diagnosticArtifactPaths(artifactPaths);
const command = replayCommand(artifactHelpers.defaultCliReplayCommand, options);
const telemetryManifest = {
  schemaVersion: 1,
  source: "lns-window-replay-feature-gate-scan",
  command,
  generatedAt: scan.generatedAt,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  diagnosticsOnly: true,
  inputFingerprint: scan.inputFingerprint,
  scanFingerprint: scan.scanFingerprint,
  sourceRoot: scan.sourceRoot,
  outputArtifacts,
  metrics: {
    sourceArtifactCount: scan.sourceSummary.sourceArtifactCount,
    caseCount: scan.sourceSummary.caseCount,
    seedCount: scan.sourceSummary.seeds.length,
    labelCount: scan.sourceSummary.labelCount,
    rollForwardLabelCount: scan.sourceSummary.rollForwardLabelCount,
    gates: Object.fromEntries(
      Object.entries(scan.gates).map(([name, gate]) => [
        name,
        {
          selected: gate.selected,
          improved: gate.improved,
          regressed: gate.regressed,
          neutral: gate.neutral,
          unknown: gate.unknown,
          bestDelta: gate.bestDelta,
          worstDelta: gate.worstDelta,
          safeNoRegression: gate.safeNoRegression,
          promotionReadyPocket: gate.promotionReadyPocket,
          repeatabilitySafeOverlap: {
            selected: gate.repeatabilitySafeOverlap.selected,
            improved: gate.repeatabilitySafeOverlap.improved,
            regressed: gate.repeatabilitySafeOverlap.regressed,
            neutral: gate.repeatabilitySafeOverlap.neutral
          }
        }
      ])
    )
  },
  notes: "Static and repeatability-aware feature-gate scan over existing LNS replay labels; no solver default changed."
};
const registryEntryDraft = {
  schemaVersion: 1,
  runId: `lns-replay-feature-gate-scan-${scan.scanFingerprint.slice(-8)}`,
  artifactType: "ablation-gate",
  generatedAt: scan.generatedAt,
  commands: [command],
  artifactPaths: outputArtifacts,
  cases: scan.sourceSummary.cases,
  caseFamilies: ["lns-window-replay", ...scan.sourceSummary.pressureFamilies.map((family) => `lns-${family}`)].sort(),
  seeds: scan.sourceSummary.seeds,
  inputFingerprint: scan.inputFingerprint,
  datasetFingerprint: scan.scanFingerprint,
  splitStatus: {
    diagnosticsOnly: true,
    source: "existing-lns-window-replay-feature-gate-scan",
    sourceRoot: scan.sourceRoot,
    sourceArtifactCount: scan.sourceSummary.sourceArtifactCount
  },
  budget: {
    sourceArtifactCount: scan.sourceSummary.sourceArtifactCount,
    caseCount: scan.sourceSummary.caseCount,
    seedCount: scan.sourceSummary.seeds.length,
    labelCount: scan.sourceSummary.labelCount,
    rollForwardLabelCount: scan.sourceSummary.rollForwardLabelCount,
    gateCount: Object.keys(scan.gates).length
  },
  hardware: telemetryManifest.hardware,
  model: {
    trained: false,
    diagnosticsOnly: true,
    labelSource: "existing-lns-window-replay-labels",
    gateKind: "feature-predicate-with-repeatability-bucket-diagnostics"
  },
  decision: "diagnostics-only",
  summary:
    "Existing protected LNS replay labels scanned for static and repeatability-aware feature-gate safety; no solver default changed.",
  summaryMetrics: telemetryManifest.metrics
};
const manifest = {
  artifactDir: artifacts.artifactDir,
  artifactPaths,
  command,
  generatedAt: scan.generatedAt,
  inputFingerprint: scan.inputFingerprint,
  scanFingerprint: scan.scanFingerprint,
  sourceRoot: scan.sourceRoot,
  sourceSummary: scan.sourceSummary,
  gateNames: Object.keys(scan.gates),
  generator: {
    script: SCRIPT_PATH,
    requiresBuild: true,
    command
  }
};

artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("feature-gate-scan.json"), scan, {
  force: options.forceArtifactDir
});
artifactHelpers.writeTextArtifact(artifacts.absoluteArtifactPath("feature-gate-scan.txt"), `${formatScan(scan)}\n`, {
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

console.log(`Wrote LNS replay feature-gate scan to ${artifacts.artifactDir}`);
