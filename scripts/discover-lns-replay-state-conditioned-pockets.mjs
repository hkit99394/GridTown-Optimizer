#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import {
  CATEGORICAL_FIELDS,
  DEFAULT_MAX_ATOMS,
  DEFAULT_MAX_GROUP_SIZE,
  DEFAULT_MIN_IMPROVED_LABELS,
  DEFAULT_SOURCE_ROOT,
  DEFAULT_TOP,
  NUMERIC_FIELDS,
  usage
} from "./lib/lns-replay-state-conditioned-pocket-config.mjs";
import { writeStateConditionedPocketArtifacts } from "./lib/lns-replay-state-conditioned-pocket-output.mjs";

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
    "Missing dist/benchmarkApi.js. Run npm run build before discovering LNS replay state-conditioned pockets."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before discovering LNS replay state-conditioned pockets."
  );
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv) {
  let sourceRoot = DEFAULT_SOURCE_ROOT;
  let artifactDir;
  let minImprovedLabels = DEFAULT_MIN_IMPROVED_LABELS;
  let maxAtoms = DEFAULT_MAX_ATOMS;
  let maxGroupSize = DEFAULT_MAX_GROUP_SIZE;
  let top = DEFAULT_TOP;
  let includePressureFamilies;
  let excludePressureFamilies = new Set();
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
    if (arg.startsWith("--include-pressure-family=")) {
      includePressureFamilies = csvSet(arg.slice("--include-pressure-family=".length), "--include-pressure-family");
      continue;
    }
    if (arg.startsWith("--exclude-pressure-family=")) {
      excludePressureFamilies = csvSet(arg.slice("--exclude-pressure-family=".length), "--exclude-pressure-family");
      continue;
    }
    if (arg.startsWith("--min-improved-labels=")) {
      minImprovedLabels = parsePositiveInteger(arg.slice("--min-improved-labels=".length), "--min-improved-labels");
      continue;
    }
    if (arg.startsWith("--max-atoms=")) {
      maxAtoms = parsePositiveInteger(arg.slice("--max-atoms=".length), "--max-atoms");
      continue;
    }
    if (arg.startsWith("--max-group-size=")) {
      maxGroupSize = parsePositiveInteger(arg.slice("--max-group-size=".length), "--max-group-size");
      if (maxGroupSize > 2) throw new Error("--max-group-size currently supports 1 or 2.");
      continue;
    }
    if (arg.startsWith("--top=")) {
      top = parsePositiveInteger(arg.slice("--top=".length), "--top");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!artifactDir) throw new Error("--artifact-dir=<path> is required.");
  return {
    sourceRoot,
    artifactDir,
    includePressureFamilies,
    excludePressureFamilies,
    minImprovedLabels,
    maxAtoms,
    maxGroupSize,
    top,
    forceArtifactDir
  };
}

function csvSet(value, label) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) throw new Error(`${label} must include at least one value.`);
  return new Set(entries);
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

function readJsonFile(repoRelativePath) {
  return JSON.parse(fs.readFileSync(absoluteRepoPath(repoRelativePath), "utf8"));
}

function readOptionalJsonFile(repoRelativePath) {
  const absolutePath = absoluteRepoPath(repoRelativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
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

function getPath(value, fieldPath) {
  return fieldPath.split(".").reduce((current, key) => current?.[key], value);
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (Number.isInteger(value)) return String(value);
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : String(value);
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

function repeatabilityMetadataFromBucket(bucket) {
  const conflicting = bucket.statusCounts.improved > 0 && bucket.statusCounts.regressed > 0;
  return {
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
    featureFingerprintCount: bucket.featureFingerprints.size,
    hasImproved: bucket.statusCounts.improved > 0,
    hasRegressed: bucket.statusCounts.regressed > 0,
    hasUnknown: bucket.statusCounts.unknown > 0
  };
}

function featureFingerprint(label) {
  return JSON.stringify(sortedObject(label.features ?? null));
}

function emptyStatusCounts() {
  return { improved: 0, neutral: 0, regressed: 0, unknown: 0 };
}

function statusFromLabel(label) {
  return label.rollForward?.statusVsBaseline ?? "unknown";
}

function finalDeltaFromLabel(label) {
  return label.rollForward?.populationDeltaVsBaseline ?? 0;
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
      label.repeatability = repeatabilityMetadataFromBucket(bucket);
    }
  }

  return buckets;
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
      snapshot,
      repeatabilityBuckets: null
    };
    artifact.repeatabilityBuckets = annotateRepeatabilityMetadata(artifact);
    return artifact;
  });
}

function isRepeatabilitySafeMetadata(repeatability) {
  return (
    repeatability?.hasImproved === true && repeatability?.hasRegressed !== true && repeatability?.hasUnknown !== true
  );
}

function isRepeatabilitySafeBucket(label) {
  return isRepeatabilitySafeMetadata(label.repeatability);
}

function flattenRows(artifacts) {
  const rows = [];
  for (const artifact of artifacts) {
    for (const [caseIndex, caseResult] of (artifact.snapshot.cases ?? []).entries()) {
      for (const [labelIndex, label] of (caseResult.labels ?? []).entries()) {
        if (!label.rollForward) continue;
        rows.push({
          ...label,
          sourceArtifact: artifact.artifactDir,
          replayJson: artifact.replayJson,
          caseIndex,
          labelIndex,
          caseName: label.caseName ?? caseResult.name ?? `case-${caseIndex}`,
          pressureFamily: label.pressureFamily ?? caseResult.pressureFamily ?? null,
          seed: label.seed ?? caseResult.seed ?? null,
          statePolicy: label.statePolicy ?? caseResult.statePolicy ?? null,
          stateIndex: label.stateIndex ?? caseResult.stateIndex ?? null,
          artifactRepeatability: label.repeatability ?? null,
          repeatabilitySafeBucket: isRepeatabilitySafeBucket(label),
          finalStatus: statusFromLabel(label),
          finalDelta: finalDeltaFromLabel(label)
        });
      }
    }
  }
  return rows;
}

function rowRepeatabilityBucketKey(row) {
  return [row.caseName ?? "unknown", row.statePolicy ?? "unknown", row.operator ?? "unknown", formatWindow(row)].join(
    "\0"
  );
}

function annotateGlobalRepeatabilityMetadata(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = rowRepeatabilityBucketKey(row);
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
    addStatusCount(bucket.statusCounts, row.finalStatus);
    bucket.featureFingerprints.add(featureFingerprint(row));
  }

  for (const row of rows) {
    const bucket = buckets.get(rowRepeatabilityBucketKey(row));
    row.repeatability = repeatabilityMetadataFromBucket(bucket);
    row.repeatabilitySafeBucket = isRepeatabilitySafeMetadata(row.repeatability);
  }

  return buckets;
}

function filterRows(rows, options) {
  return rows.filter((row) => {
    const family = row.pressureFamily ?? "unknown";
    if (options.includePressureFamilies && !options.includePressureFamilies.has(family)) return false;
    return !options.excludePressureFamilies.has(family);
  });
}

function emptyCounts() {
  return {
    selected: 0,
    improved: 0,
    regressed: 0,
    neutral: 0,
    unknown: 0,
    repeatabilitySafeSelected: 0,
    repeatabilitySafeImproved: 0,
    bestDelta: null,
    worstDelta: null
  };
}

function addRow(counts, row) {
  counts.selected += 1;
  if (row.finalStatus === "improved") counts.improved += 1;
  else if (row.finalStatus === "regressed") counts.regressed += 1;
  else if (row.finalStatus === "neutral") counts.neutral += 1;
  else counts.unknown += 1;
  if (row.repeatabilitySafeBucket) {
    counts.repeatabilitySafeSelected += 1;
    if (row.finalStatus === "improved") counts.repeatabilitySafeImproved += 1;
  }
  counts.bestDelta = counts.bestDelta === null ? row.finalDelta : Math.max(counts.bestDelta, row.finalDelta);
  counts.worstDelta = counts.worstDelta === null ? row.finalDelta : Math.min(counts.worstDelta, row.finalDelta);
}

function finalizedCounts(counts, options) {
  const selected = counts.selected;
  return {
    ...counts,
    bestDelta: counts.bestDelta ?? 0,
    worstDelta: counts.worstDelta ?? 0,
    safeNoRegression: selected > 0 && counts.regressed === 0 && counts.unknown === 0,
    durablePocket:
      selected > 0 && counts.improved >= options.minImprovedLabels && counts.regressed === 0 && counts.unknown === 0,
    improvedRate: selected === 0 ? 0 : counts.improved / selected,
    repeatabilitySafeRate: selected === 0 ? 0 : counts.repeatabilitySafeSelected / selected
  };
}

function buildSourceSummary(rows) {
  const sourceArtifacts = new Set();
  const cases = new Set();
  const pressureFamilies = new Set();
  const seeds = new Set();
  const states = new Set();
  for (const row of rows) {
    sourceArtifacts.add(row.sourceArtifact);
    if (row.caseName) cases.add(row.caseName);
    if (row.pressureFamily) pressureFamilies.add(row.pressureFamily);
    if (row.seed !== null && row.seed !== undefined) seeds.add(row.seed);
    states.add(
      `${row.sourceArtifact}\0${row.caseIndex}\0${row.statePolicy ?? "unknown"}\0${row.stateIndex ?? "unknown"}`
    );
  }
  return {
    sourceArtifactCount: sourceArtifacts.size,
    caseCount: cases.size,
    cases: [...cases].sort(),
    pressureFamilies: [...pressureFamilies].sort(),
    seeds: [...seeds].sort((left, right) => Number(left) - Number(right)),
    stateCount: states.size,
    labelCount: rows.length,
    rollForwardLabelCount: rows.length,
    scannedRollForwardLabels: rows.length
  };
}

function buildSourceArtifacts(artifacts, rows) {
  const filteredCounts = new Map();
  for (const row of rows) {
    filteredCounts.set(row.sourceArtifact, (filteredCounts.get(row.sourceArtifact) ?? 0) + 1);
  }
  return artifacts
    .filter((artifact) => filteredCounts.has(artifact.artifactDir))
    .map(
      ({
        artifactDir,
        replayJson,
        manifestJson,
        telemetryManifestJson,
        inputFingerprint,
        labelFingerprint,
        snapshot,
        repeatabilityBuckets
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
        rollForwardLabelCount: snapshot.rollForwardLabelCount ?? 0,
        filteredRollForwardLabelCount: filteredCounts.get(artifactDir) ?? 0,
        repeatabilityBucketCount: repeatabilityBuckets?.size ?? 0
      })
    );
}

function buildOracleSummary(rows, options) {
  const safeRows = rows.filter((row) => row.repeatabilitySafeBucket);
  const safeCounts = emptyCounts();
  const allCounts = emptyCounts();
  for (const row of rows) addRow(allCounts, row);
  for (const row of safeRows) addRow(safeCounts, row);

  const buckets = new Map();
  for (const row of rows) {
    if (row.repeatability?.bucketKey) buckets.set(row.repeatability.bucketKey, row.repeatability);
  }
  let safeBucketCount = 0;
  let featureIdenticalConflictBucketCount = 0;
  for (const bucket of buckets.values()) {
    const safe =
      bucket.statusCounts.improved > 0 && bucket.statusCounts.regressed === 0 && bucket.statusCounts.unknown === 0;
    if (safe) safeBucketCount += 1;
    if (bucket.featureIdenticalConflictBucket) featureIdenticalConflictBucketCount += 1;
  }

  return {
    repeatabilityScope: "global-filtered-rows",
    bucketCount: buckets.size,
    repeatabilitySafeBucketCount: safeBucketCount,
    featureIdenticalConflictBucketCount,
    allLabels: finalizedCounts(allCounts, options),
    repeatabilitySafeBucketLabels: finalizedCounts(safeCounts, options)
  };
}

function candidateThresholds(values, targetValues) {
  const uniqueTargetValues = [...new Set(targetValues.filter(Number.isFinite))].sort((left, right) => left - right);
  if (uniqueTargetValues.length <= 12) return uniqueTargetValues;
  const indexes = new Set([0, uniqueTargetValues.length - 1]);
  for (let i = 1; i <= 10; i += 1) {
    indexes.add(Math.floor((i * (uniqueTargetValues.length - 1)) / 11));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => uniqueTargetValues[index]);
}

function atomKey(field, operator, value) {
  return `${field.label}${operator}${formatValue(value)}`;
}

function makeAtom(field, operator, value) {
  const expression = `${field.label}${operator}${formatValue(value)}`;
  return {
    key: atomKey(field, operator, value),
    expression,
    field: field.label,
    fieldPath: field.path,
    kind: field.kind,
    operator,
    value,
    predicate: (row) => {
      const observed = getPath(row, field.path);
      if (operator === "==") return observed === value;
      if (!Number.isFinite(observed)) return false;
      if (operator === "<=") return observed <= value;
      if (operator === ">=") return observed >= value;
      return false;
    }
  };
}

function buildAtoms(rows) {
  const atoms = new Map();
  const targetRows = rows.filter((row) => row.repeatabilitySafeBucket && row.finalStatus === "improved");

  for (const field of CATEGORICAL_FIELDS) {
    const values = new Set();
    for (const row of targetRows) {
      const value = getPath(row, field.path);
      if (value !== null && value !== undefined) values.add(value);
    }
    for (const value of values) {
      const atom = makeAtom(field, "==", value);
      atoms.set(atom.key, atom);
    }
  }

  for (const field of NUMERIC_FIELDS) {
    const allValues = rows.map((row) => getPath(row, field.path)).filter(Number.isFinite);
    const targetValues = targetRows.map((row) => getPath(row, field.path)).filter(Number.isFinite);
    if (targetValues.length === 0) continue;
    const uniqueAllValues = [...new Set(allValues)].sort((left, right) => left - right);
    if (uniqueAllValues.length <= 16) {
      for (const value of new Set(targetValues)) {
        const atom = makeAtom(field, "==", value);
        atoms.set(atom.key, atom);
      }
    }
    for (const value of candidateThresholds(allValues, targetValues)) {
      const minAtom = makeAtom(field, ">=", value);
      const maxAtom = makeAtom(field, "<=", value);
      atoms.set(minAtom.key, minAtom);
      atoms.set(maxAtom.key, maxAtom);
    }
  }

  return [...atoms.values()];
}

function groupedCounts(rows, field, options) {
  const groups = {};
  for (const row of rows) {
    const value = row[field] ?? "unknown";
    groups[value] ??= emptyCounts();
    addRow(groups[value], row);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, counts]) => [key, finalizedCounts(counts, options)]));
}

function candidateExample(row) {
  return {
    sourceArtifact: row.sourceArtifact,
    caseName: row.caseName,
    pressureFamily: row.pressureFamily,
    seed: row.seed,
    statePolicy: row.statePolicy,
    stateIndex: row.stateIndex,
    stateSourceStatus: row.stateSourceStatus ?? null,
    stateSourceIteration: row.stateSourceIteration ?? null,
    stateStagnantIterations: row.stateStagnantIterations ?? null,
    operator: row.operator,
    selectionSource: row.selectionSource ?? null,
    window: row.window ?? null,
    status: row.finalStatus,
    delta: row.finalDelta,
    repeatability: row.repeatability
      ? {
          bucketKey: row.repeatability.bucketKey,
          labelCount: row.repeatability.labelCount,
          statusCounts: row.repeatability.statusCounts,
          featureIdenticalConflictBucket: row.repeatability.featureIdenticalConflictBucket
        }
      : null,
    selectedFeatures: {
      area: row.features?.area ?? null,
      roadCountInside: row.features?.roadCountInside ?? null,
      serviceCandidateBonusInside: row.features?.candidateLoss?.serviceCandidateBonusInside ?? null,
      residentialCandidatesBlockedByIncumbent:
        row.features?.candidateLoss?.residentialCandidatesBlockedByIncumbent ?? null,
      componentsBefore: row.features?.fragmentation?.emptyComponentCountBefore ?? null,
      componentsAfter: row.features?.fragmentation?.emptyComponentCountAfterClearingWindow ?? null,
      allowedWindowCells: row.features?.fragmentation?.allowedWindowCellCount ?? null,
      newlyReachable: row.features?.connectivityShadow?.newlyReachableEmptyCellsIfCleared ?? null,
      incumbentPopulation: row.incumbentPopulation ?? null,
      operatorScore: row.operatorScore ?? null
    }
  };
}

function evaluateCandidate(atoms, rows, options) {
  const selectedRows = rows.filter((row) => atoms.every((atom) => atom.predicate(row)));
  const counts = emptyCounts();
  for (const row of selectedRows) addRow(counts, row);
  const finalized = finalizedCounts(counts, options);
  return {
    expression: atoms.map((atom) => atom.expression).join(" AND "),
    atomCount: atoms.length,
    atoms: atoms.map(({ expression, field, fieldPath, kind, operator, value }) => ({
      expression,
      field,
      fieldPath,
      kind,
      operator,
      value
    })),
    ...finalized,
    byStatePolicy: groupedCounts(selectedRows, "statePolicy", options),
    byPressureFamily: groupedCounts(selectedRows, "pressureFamily", options),
    bySourceArtifact: groupedCounts(selectedRows, "sourceArtifact", options),
    examples: selectedRows
      .filter((row) => row.finalStatus !== "neutral")
      .slice(0, 12)
      .map(candidateExample)
  };
}

function compareCandidates(left, right) {
  if (left.durablePocket !== right.durablePocket) return left.durablePocket ? -1 : 1;
  if (left.regressed !== right.regressed) return left.regressed - right.regressed;
  if (left.unknown !== right.unknown) return left.unknown - right.unknown;
  if (left.repeatabilitySafeImproved !== right.repeatabilitySafeImproved) {
    return right.repeatabilitySafeImproved - left.repeatabilitySafeImproved;
  }
  if (left.improved !== right.improved) return right.improved - left.improved;
  if (left.improvedRate !== right.improvedRate) return right.improvedRate - left.improvedRate;
  if (left.selected !== right.selected) return left.selected - right.selected;
  if (left.atomCount !== right.atomCount) return left.atomCount - right.atomCount;
  return left.expression.localeCompare(right.expression);
}

function rankAtoms(atoms, rows, options) {
  return atoms
    .map((atom) => evaluateCandidate([atom], rows, options))
    .filter((candidate) => candidate.improved > 0 || candidate.repeatabilitySafeImproved > 0)
    .sort(compareCandidates);
}

function atomCombinationKey(atoms) {
  return atoms
    .map((atom) => atom.key)
    .sort()
    .join("\0");
}

function discoverCandidates(rows, options) {
  const atoms = buildAtoms(rows);
  const rankedAtomCandidates = rankAtoms(atoms, rows, options);
  const usableAtoms = rankedAtomCandidates
    .slice(0, options.maxAtoms)
    .map((candidate) => atoms.find((atom) => atom.expression === candidate.expression))
    .filter(Boolean);
  const combinations = new Map();

  for (const atom of usableAtoms) {
    combinations.set(atomCombinationKey([atom]), [atom]);
  }
  if (options.maxGroupSize >= 2) {
    for (let leftIndex = 0; leftIndex < usableAtoms.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < usableAtoms.length; rightIndex += 1) {
        const left = usableAtoms[leftIndex];
        const right = usableAtoms[rightIndex];
        if (left.fieldPath === right.fieldPath) continue;
        combinations.set(atomCombinationKey([left, right]), [left, right]);
      }
    }
  }

  const candidates = [...combinations.values()]
    .map((candidateAtoms) => evaluateCandidate(candidateAtoms, rows, options))
    .filter((candidate) => candidate.selected > 0 && candidate.improved > 0)
    .sort(compareCandidates);
  const safeCandidates = candidates.filter((candidate) => candidate.durablePocket).slice(0, options.top);
  const blockedCandidates = candidates
    .filter((candidate) => !candidate.durablePocket && candidate.regressed > 0)
    .slice(0, options.top);

  return {
    atomCount: atoms.length,
    rankedAtomCount: rankedAtomCandidates.length,
    searchedCandidateCount: combinations.size,
    safeCandidateCount: candidates.filter((candidate) => candidate.durablePocket).length,
    blockedCandidateCount: candidates.filter((candidate) => !candidate.durablePocket && candidate.regressed > 0).length,
    topAtoms: rankedAtomCandidates.slice(0, Math.min(options.top, rankedAtomCandidates.length)),
    safeCandidates,
    blockedCandidates
  };
}

function buildScan(artifacts, options, benchmarkApi) {
  const generatedAt = new Date().toISOString();
  const rows = filterRows(flattenRows(artifacts), options);
  if (rows.length === 0) {
    throw new Error("No LNS replay roll-forward labels remained after applying pressure-family filters.");
  }
  annotateGlobalRepeatabilityMetadata(rows);
  const sourceArtifacts = buildSourceArtifacts(artifacts, rows);
  const scan = {
    schemaVersion: 1,
    generatedAt,
    sourceRoot: normalizeRepoRelativePath(options.sourceRoot),
    options: {
      ...(options.includePressureFamilies === undefined
        ? {}
        : { includePressureFamilies: [...options.includePressureFamilies].sort() }),
      ...(options.excludePressureFamilies.size === 0
        ? {}
        : { excludePressureFamilies: [...options.excludePressureFamilies].sort() }),
      minImprovedLabels: options.minImprovedLabels,
      maxAtoms: options.maxAtoms,
      maxGroupSize: options.maxGroupSize,
      top: options.top
    },
    sourceSummary: buildSourceSummary(rows),
    sourceArtifacts,
    oracleSummary: buildOracleSummary(rows, options),
    discovery: discoverCandidates(rows, options)
  };
  return {
    ...scan,
    inputFingerprint: benchmarkApi.buildModelExperimentFingerprint({ sourceArtifacts }),
    scanFingerprint: benchmarkApi.buildModelExperimentFingerprint(scan)
  };
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
writeStateConditionedPocketArtifacts({
  artifactHelpers,
  benchmarkApi,
  artifacts,
  options,
  scan,
  normalizeRepoRelativePath
});
console.log(`Wrote LNS replay state-conditioned pocket discovery to ${artifacts.artifactDir}`);
