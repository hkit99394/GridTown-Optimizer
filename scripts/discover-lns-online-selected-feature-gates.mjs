#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/discover-lns-online-selected-feature-gates.mjs";
const SCORECARD_FILE = "lns-window-ranker-online-ablation.json";
const DISCOVERY_TARGETS = new Set(["selection-improved", "final-improved"]);
const DISCOVERY_ARTIFACT_SCHEMA_VERSION = 2;
const DISCOVERY_IDENTITY_SCHEMA_VERSION = 3;
const TELEMETRY_MANIFEST_SCHEMA_VERSION = 2;
const REPORT_IDENTITY_SCHEMA_VERSION = 1;
const METRIC_SEMANTICS_VERSION = 2;
const ATOM_CAP_SUMMARY_SEMANTICS_VERSION = 2;
const METRIC_SEMANTICS = {
  targetImproved:
    "Counts rows that match the selected discovery target. final-improved is attributed only to the terminal override trace with selectedFeatures in each variant.",
  terminalFinalImproved:
    "Counts selected terminal override traces with selectedFeatures whose whole variant final outcome improved versus baseline.",
  terminalFinalRegressed:
    "Counts selected terminal override traces with selectedFeatures whose whole variant final outcome regressed versus baseline.",
  safetyRegressed:
    "Counts selected traces with either a regressed immediate selection outcome or a regressed whole-variant final outcome. Whole-variant final regression is applied to every selected trace in that variant."
};
const V2_DEPRECATED_METRIC_ALIASES = {
  schemaVersion: 2,
  note: "Schema-v2 compatibility aliases only. Do not use these aliases to reinterpret schema-v1 artifacts, where finalRegressed represented combined safety regression.",
  aliases: {
    finalImproved: "terminalFinalImproved",
    finalRegressed: "terminalFinalRegressed"
  }
};

function usage() {
  return [
    "Usage: node scripts/discover-lns-online-selected-feature-gates.mjs --source-artifact=<dir> --artifact-dir=<dir> [options]",
    "",
    "Discovers diagnostics-only selected-feature gate groups from online LNS window-ranker override traces.",
    "",
    "Options:",
    "  --source-artifact=<dir>       Online ablation artifact dir containing lns-window-ranker-online-ablation.json. Repeatable.",
    "  --source-scorecard=<path>     Direct path to an online ablation JSON file. Repeatable.",
    "  --validation-source-artifact=<dir>",
    "                                  Optional validation artifact dir containing lns-window-ranker-online-ablation.json. Repeatable.",
    "  --validation-source-scorecard=<path>",
    "                                  Optional direct validation online ablation JSON path. Repeatable.",
    "  --artifact-dir=<dir>          Artifact bundle output directory under artifacts/.",
    "  --feature-allowlist=<csv>     Restrict candidate features to these selectedFeatures names.",
    "  --target=<name>               Gate objective: selection-improved or final-improved. Default: selection-improved.",
    "  --max-group-size=<n>          Maximum conjunction size in atoms. Default: 2.",
    "  --max-atoms-per-feature=<n>   Candidate atom cap per feature. Default: 12.",
    "  --max-total-atoms=<n>         Global atom cap after per-feature ranking. Default: 120.",
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

function scorecardPathFromArtifact(artifactDir, label) {
  const repoRelativeArtifactDir = normalizeRepoRelativePath(artifactDir, label);
  return artifactHelpers.resolveRepoInputArtifactPath(path.posix.join(repoRelativeArtifactDir, SCORECARD_FILE), label, {
    mustExist: true
  });
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

function stableNumberKey(value) {
  return Number.isInteger(value) ? String(value) : value.toString();
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

function isPositive(row, target) {
  return target === "final-improved"
    ? row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved"
    : row.selectionOutcomeStatus === "improved";
}

function isSelectionRegression(row) {
  return row.selectionOutcomeStatus === "regressed";
}

function isFinalRegression(row) {
  return row.finalOutcomeAttributed && row.finalOutcomeStatus === "regressed";
}

function isSafetyRegression(row) {
  return isSelectionRegression(row) || row.finalOutcomeStatus === "regressed";
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
  return `${atom.feature}:${atom.kind}:${stableNumberKey(atom.value)}`;
}

function gateCliArg(gate) {
  return gate.minValue === undefined
    ? `${gate.feature}<=${stableNumberKey(gate.maxValue)}`
    : `${gate.feature}>=${stableNumberKey(gate.minValue)}`;
}

function gatesCliArg(gates) {
  return gates.map(gateCliArg).join(",");
}

function evaluatePredicate(rows, predicate, target) {
  const selectedRows = rows.filter(predicate);
  const selectedKeys = selectedRows.map((row) => row.key);
  const positiveKeys = selectedRows.filter((row) => isPositive(row, target)).map((row) => row.key);
  const selectionRegressionRows = selectedRows.filter(isSelectionRegression);
  const finalRegressionRows = selectedRows.filter(isFinalRegression);
  const safetyRegressionRows = selectedRows.filter(isSafetyRegression);
  return {
    selected: selectedRows.length,
    targetImproved: positiveKeys.length,
    selectionImproved: selectedRows.filter((row) => row.selectionOutcomeStatus === "improved").length,
    selectionRegressed: selectionRegressionRows.length,
    terminalFinalImproved: selectedRows.filter(
      (row) => row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved"
    ).length,
    terminalFinalRegressed: finalRegressionRows.length,
    finalImproved: selectedRows.filter((row) => row.finalOutcomeAttributed && row.finalOutcomeStatus === "improved")
      .length,
    finalRegressed: finalRegressionRows.length,
    safetyRegressed: safetyRegressionRows.length,
    neutral: selectedRows.filter((row) => !isPositive(row, target) && !isSafetyRegression(row)).length,
    unknown: selectedRows.filter(
      (row) => row.selectionOutcomeStatus === "unknown" || row.finalOutcomeStatus === "unknown"
    ).length,
    bestFinalDelta: selectedRows.length ? Math.max(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    worstFinalDelta: selectedRows.length ? Math.min(...selectedRows.map((row) => row.finalPopulationDelta ?? 0)) : 0,
    selectedKeys,
    positiveKeys,
    regressionExamples: safetyRegressionRows.slice(0, 8).map(rowExample),
    selectionRegressionExamples: selectionRegressionRows.slice(0, 8).map(rowExample),
    finalRegressionExamples: finalRegressionRows.slice(0, 8).map(rowExample),
    safetyRegressionExamples: safetyRegressionRows.slice(0, 8).map(rowExample),
    positiveExamples: selectedRows
      .filter((row) => isPositive(row, target))
      .slice(0, 8)
      .map(rowExample)
  };
}

function evaluateGates(rows, gates, target) {
  return evaluatePredicate(rows, (row) => gates.every((gate) => gatePasses(row, gate)), target);
}

function withSafetyFlag(metrics) {
  return {
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0
  };
}

function rowSummaryFromMetrics(metrics) {
  return {
    overrideTraceCount: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta
  };
}

function rowExample(row) {
  return {
    sourceScorecard: row.sourceScorecard,
    caseIndex: row.caseIndex,
    caseName: row.caseName,
    pressureFamily: row.pressureFamily,
    seed: row.seed,
    variantIndex: row.variantIndex,
    traceIndex: row.traceIndex,
    iteration: row.iteration,
    transition: row.transition,
    selectedOperator: row.selectedOperator,
    selectedWindow: row.selectedWindow,
    selectionOutcomeStatus: row.selectionOutcomeStatus,
    finalOutcomeAttributed: row.finalOutcomeAttributed,
    finalOutcomeAttribution: row.finalOutcomeAttribution,
    finalOutcomeStatus: row.finalOutcomeStatus,
    finalPopulationDelta: row.finalPopulationDelta,
    selectedFeatures: row.selectedFeatures
  };
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])])
  );
}

function exampleReportProjection(example) {
  return {
    sourceScorecard: example.sourceScorecard,
    caseIndex: example.caseIndex,
    caseName: example.caseName,
    pressureFamily: example.pressureFamily,
    seed: example.seed,
    variantIndex: example.variantIndex,
    traceIndex: example.traceIndex,
    iteration: example.iteration,
    transition: example.transition,
    selectedOperator: example.selectedOperator,
    selectedWindow: canonicalJsonValue(example.selectedWindow),
    selectionOutcomeStatus: example.selectionOutcomeStatus,
    finalOutcomeAttributed: example.finalOutcomeAttributed,
    finalOutcomeAttribution: example.finalOutcomeAttribution,
    finalOutcomeStatus: example.finalOutcomeStatus,
    finalPopulationDelta: example.finalPopulationDelta,
    selectedFeatures: canonicalJsonValue(example.selectedFeatures)
  };
}

function compareCandidates(left, right) {
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  if (left.atomCount !== right.atomCount) return left.atomCount - right.atomCount;
  return left.cliArg.localeCompare(right.cliArg);
}

function compareCandidatesWithValidation(left, right) {
  const leftValidation = left.validation;
  const rightValidation = right.validation;
  if (!leftValidation || !rightValidation) return compareCandidates(left, right);

  const leftSafePositive = leftValidation.safeNoRegression && leftValidation.targetImproved > 0 ? 1 : 0;
  const rightSafePositive = rightValidation.safeNoRegression && rightValidation.targetImproved > 0 ? 1 : 0;
  if (leftSafePositive !== rightSafePositive) return rightSafePositive - leftSafePositive;
  if (leftValidation.safetyRegressed !== rightValidation.safetyRegressed) {
    return leftValidation.safetyRegressed - rightValidation.safetyRegressed;
  }
  if (leftValidation.targetImproved !== rightValidation.targetImproved) {
    return rightValidation.targetImproved - leftValidation.targetImproved;
  }
  if (leftValidation.neutral !== rightValidation.neutral) return leftValidation.neutral - rightValidation.neutral;
  if (leftValidation.selected !== rightValidation.selected) return leftValidation.selected - rightValidation.selected;
  return compareCandidates(left, right);
}

function compareAtoms(left, right) {
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  return left.signature.localeCompare(right.signature);
}

function compareAtomsSafetyFirst(left, right) {
  if (left.safetyRegressed !== right.safetyRegressed) return left.safetyRegressed - right.safetyRegressed;
  if (left.targetImproved !== right.targetImproved) return right.targetImproved - left.targetImproved;
  if (left.neutral !== right.neutral) return left.neutral - right.neutral;
  if (left.selected !== right.selected) return left.selected - right.selected;
  return left.signature.localeCompare(right.signature);
}

function atomComparatorForTarget(target) {
  return target === "final-improved" ? compareAtomsSafetyFirst : compareAtoms;
}

function sortedUniqueAtoms(atoms, compareAtomsForTarget) {
  const seen = new Set();
  const unique = [];
  for (const atom of atoms.sort(compareAtomsForTarget)) {
    if (seen.has(atom.signature)) continue;
    seen.add(atom.signature);
    unique.push(atom);
  }
  return unique;
}

function discoverConjunctionReservations(rawAtoms, rows, target, maxGroupSize, maxTotalAtoms) {
  if (maxGroupSize < 2 || maxTotalAtoms < 2) {
    return {
      reservedAtoms: [],
      reservedConjunctions: [],
      reservedPairs: [],
      requestedMaxGroupSize: maxGroupSize,
      searchMaxGroupSize: maxGroupSize < 2 ? 1 : maxGroupSize,
      supportsRequestedMaxGroupSize: true,
      reservationSearchExhaustive: true,
      coversRequestedMaxGroupSize: true,
      searchDescription: "No conjunction reservation search needed for singleton-only discovery.",
      availableUnsafeTargetAtomCount: 0,
      consideredUnsafeTargetAtomCount: 0,
      availablePartnerAtomCount: 0,
      consideredPartnerAtomCount: 0,
      evaluatedConjunctionGroupCount: 0,
      maxEvaluatedConjunctionGroupCount: 0,
      evaluatedPairCount: 0,
      maxEvaluatedPairCount: 0
    };
  }
  const compareTargetAtoms = atomComparatorForTarget(target);
  const availableUnsafeTargetAtoms = rawAtoms
    .filter((atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0)
    .sort(compareTargetAtoms);
  const availablePartnerAtoms = rawAtoms.filter((atom) => atom.targetImproved > 0).sort(compareTargetAtoms);
  const unsafeTargetAtomConsiderationLimit = Math.max(maxTotalAtoms, 8);
  const partnerAtomConsiderationLimit = Math.max(maxTotalAtoms * 4, 16);
  const unsafeTargetAtoms = availableUnsafeTargetAtoms.slice(0, unsafeTargetAtomConsiderationLimit);
  const partnerAtoms = availablePartnerAtoms.slice(0, partnerAtomConsiderationLimit);
  const slicedUnsafeTargetAtoms = unsafeTargetAtoms.length < availableUnsafeTargetAtoms.length;
  const slicedPartnerAtoms = partnerAtoms.length < availablePartnerAtoms.length;
  const maxEvaluatedConjunctionGroupCount = Math.max(maxTotalAtoms * 128 * (maxGroupSize - 1), 128);
  const reserved = new Map();
  const reservedConjunctions = [];
  const evaluatedSignatures = new Set();
  let evaluatedConjunctionGroupCount = 0;
  let evaluatedConjunctionPairCount = 0;
  let exhaustedSearchBudget = false;
  let reachedReservationAtomCap = false;

  for (const unsafeAtom of unsafeTargetAtoms) {
    const group = [unsafeAtom];
    const usedFeatures = new Set([unsafeAtom.feature]);

    function visit(start) {
      if (reserved.size >= maxTotalAtoms || exhaustedSearchBudget) {
        if (reserved.size >= maxTotalAtoms) reachedReservationAtomCap = true;
        return;
      }
      if (group.length >= 2) {
        const signature = group
          .map((atom) => atom.signature)
          .sort()
          .join("|");
        if (!evaluatedSignatures.has(signature)) {
          evaluatedSignatures.add(signature);
          evaluatedConjunctionGroupCount += 1;
          if (group.length === 2) evaluatedConjunctionPairCount += 1;
          if (evaluatedConjunctionGroupCount > maxEvaluatedConjunctionGroupCount) {
            exhaustedSearchBudget = true;
            return;
          }
          const missingAtoms = group.filter((atom) => !reserved.has(atom.signature));
          if (reserved.size + missingAtoms.length <= maxTotalAtoms) {
            const candidate = buildCandidate(group, rows, target);
            if (candidate.safeNoRegression) {
              for (const atom of missingAtoms) reserved.set(atom.signature, atom);
              reservedConjunctions.push({
                atomCount: candidate.atomCount,
                cliArg: candidate.cliArg,
                targetImproved: candidate.targetImproved,
                selected: candidate.selected
              });
              if (reserved.size >= maxTotalAtoms) {
                reachedReservationAtomCap = true;
                return;
              }
            }
          }
        }
      }
      if (group.length >= maxGroupSize) return;
      for (let index = start; index < partnerAtoms.length; index += 1) {
        const partnerAtom = partnerAtoms[index];
        if (unsafeAtom.signature === partnerAtom.signature || usedFeatures.has(partnerAtom.feature)) continue;
        usedFeatures.add(partnerAtom.feature);
        group.push(partnerAtom);
        visit(index + 1);
        group.pop();
        usedFeatures.delete(partnerAtom.feature);
        if (reserved.size >= maxTotalAtoms || exhaustedSearchBudget) return;
      }
    }

    visit(0);
    if (exhaustedSearchBudget || reserved.size >= maxTotalAtoms) {
      if (reserved.size >= maxTotalAtoms) reachedReservationAtomCap = true;
      break;
    }
  }

  const reservedPairs = reservedConjunctions.filter((candidate) => candidate.atomCount === 2);
  const searchMaxGroupSize = maxGroupSize;
  const supportsRequestedMaxGroupSize = searchMaxGroupSize >= maxGroupSize;
  const reservationSearchExhaustive =
    !slicedUnsafeTargetAtoms && !slicedPartnerAtoms && !exhaustedSearchBudget && !reachedReservationAtomCap;
  return {
    reservedAtoms: sortedUniqueAtoms([...reserved.values()], compareTargetAtoms),
    reservedConjunctions,
    reservedPairs,
    requestedMaxGroupSize: maxGroupSize,
    searchMaxGroupSize,
    supportsRequestedMaxGroupSize,
    reservationSearchExhaustive,
    coversRequestedMaxGroupSize: supportsRequestedMaxGroupSize && reservationSearchExhaustive,
    searchDescription: reservationSearchExhaustive
      ? "Exhaustive recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size."
      : "Bounded recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size.",
    availableUnsafeTargetAtomCount: availableUnsafeTargetAtoms.length,
    consideredUnsafeTargetAtomCount: unsafeTargetAtoms.length,
    availablePartnerAtomCount: availablePartnerAtoms.length,
    consideredPartnerAtomCount: partnerAtoms.length,
    slicedUnsafeTargetAtoms,
    slicedPartnerAtoms,
    reachedReservationAtomCap,
    exhaustedSearchBudget,
    evaluatedConjunctionGroupCount,
    maxEvaluatedConjunctionGroupCount,
    evaluatedPairCount: evaluatedConjunctionPairCount,
    maxEvaluatedPairCount: maxEvaluatedConjunctionGroupCount
  };
}

function selectCappedAtoms(
  rawAtoms,
  maxTotalAtoms,
  target,
  { rows = [], maxGroupSize = 1, reservationAtoms = rawAtoms } = {}
) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const sortedRawAtoms = rawAtoms.slice().sort(compareTargetAtoms);
  const sortedReservationAtoms = sortedUniqueAtoms(reservationAtoms.slice(), compareTargetAtoms);
  const conjunctionReservations = discoverConjunctionReservations(
    sortedReservationAtoms,
    rows,
    target,
    maxGroupSize,
    maxTotalAtoms
  );
  const rawAtomSignatures = new Set(sortedRawAtoms.map((atom) => atom.signature));
  const hasExternalReservedAtom = conjunctionReservations.reservedAtoms.some(
    (atom) => !rawAtomSignatures.has(atom.signature)
  );
  if (rawAtoms.length <= maxTotalAtoms && !hasExternalReservedAtom) {
    return {
      atoms: sortedRawAtoms,
      capDetails: {
        strategy: "uncapped",
        reservationCandidateAtomCount: sortedReservationAtoms.length,
        conjunctionReservations
      }
    };
  }

  const selectedAtoms = [];
  const selectedSignatures = new Set();
  const addAtom = (atom) => {
    if (selectedAtoms.length >= maxTotalAtoms || selectedSignatures.has(atom.signature)) return false;
    selectedAtoms.push(atom);
    selectedSignatures.add(atom.signature);
    return true;
  };

  const safeTargetAtoms = sortedRawAtoms.filter((atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0);
  for (const atom of conjunctionReservations.reservedAtoms) addAtom(atom);

  const safeSingletonCapacity = Math.max(0, maxTotalAtoms - selectedAtoms.length);
  const safeSingletonAdmissionQuota =
    safeTargetAtoms.length === 0 || safeSingletonCapacity === 0
      ? 0
      : Math.min(safeTargetAtoms.length, safeSingletonCapacity, Math.max(1, Math.ceil(maxTotalAtoms / 2)));
  for (const safeAtom of safeTargetAtoms.slice(0, safeSingletonAdmissionQuota)) addAtom(safeAtom);

  const safeAtoms = sortedRawAtoms.filter((atom) => atom.safetyRegressed === 0);
  for (const safeAtom of safeAtoms) addAtom(safeAtom);

  for (const atom of sortedRawAtoms) addAtom(atom);

  return {
    atoms: selectedAtoms.sort(compareTargetAtoms),
    capDetails: {
      strategy: maxGroupSize > 1 ? "conjunction-reservations-first-safe-singleton-fill" : "safe-singleton-first",
      safeSingletonAdmissionQuota,
      reservationCandidateAtomCount: sortedReservationAtoms.length,
      conjunctionReservations
    }
  };
}

function atomCapSummary(totalCandidateAtoms, perFeatureCappedAtoms, atoms, capDetails) {
  const included = new Set(atoms.map((atom) => atom.signature));
  const perFeatureCapped = new Set(perFeatureCappedAtoms.map((atom) => atom.signature));
  const safeTargetAtoms = totalCandidateAtoms.filter((atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0);
  const unsafeTargetAtoms = totalCandidateAtoms.filter((atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0);
  const perFeatureCappedSafeTargetAtoms = perFeatureCappedAtoms.filter(
    (atom) => atom.safetyRegressed === 0 && atom.targetImproved > 0
  );
  const perFeatureCappedUnsafeTargetAtoms = perFeatureCappedAtoms.filter(
    (atom) => atom.safetyRegressed > 0 && atom.targetImproved > 0
  );
  const reservedConjunctionAtoms = capDetails?.conjunctionReservations?.reservedAtoms ?? [];
  const reservedConjunctionAtomSignatures = new Set(reservedConjunctionAtoms.map((atom) => atom.signature));
  return {
    strategy: capDetails?.strategy ?? "unknown",
    safeSingletonAdmissionQuota: capDetails?.safeSingletonAdmissionQuota ?? 0,
    candidateAtomUniverseCount: totalCandidateAtoms.length,
    perFeatureCappedAtomCount: perFeatureCappedAtoms.length,
    perFeatureOmittedAtomCount: totalCandidateAtoms.filter((atom) => !perFeatureCapped.has(atom.signature)).length,
    reservationCandidateAtomCount:
      capDetails?.reservationCandidateAtomCount ?? capDetails?.conjunctionReservations?.reservedAtoms?.length ?? 0,
    safeTargetAtomCount: safeTargetAtoms.length,
    unsafeTargetAtomCount: unsafeTargetAtoms.length,
    perFeatureCappedSafeTargetAtomCount: perFeatureCappedSafeTargetAtoms.length,
    perFeatureCappedUnsafeTargetAtomCount: perFeatureCappedUnsafeTargetAtoms.length,
    includedSafeTargetAtomCount: safeTargetAtoms.filter((atom) => included.has(atom.signature)).length,
    omittedSafeTargetAtomCount: safeTargetAtoms.filter((atom) => !included.has(atom.signature)).length,
    includedUnsafeTargetAtomCount: unsafeTargetAtoms.filter((atom) => included.has(atom.signature)).length,
    omittedUnsafeTargetAtomCount: unsafeTargetAtoms.filter((atom) => !included.has(atom.signature)).length,
    reservedConjunctionAtomCount: reservedConjunctionAtoms.length,
    reservedPerFeatureOmittedConjunctionAtomCount: reservedConjunctionAtoms.filter(
      (atom) => !perFeatureCapped.has(atom.signature)
    ).length,
    includedReservedConjunctionAtomCount: reservedConjunctionAtoms.filter((atom) => included.has(atom.signature))
      .length,
    omittedReservedConjunctionAtomCount: reservedConjunctionAtoms.filter((atom) => !included.has(atom.signature))
      .length,
    reservedUnsafeConjunctionAtomCount: unsafeTargetAtoms.filter((atom) =>
      reservedConjunctionAtomSignatures.has(atom.signature)
    ).length,
    conjunctionReservationRequestedMaxGroupSize: capDetails?.conjunctionReservations?.requestedMaxGroupSize ?? 1,
    conjunctionReservationSearchMaxGroupSize: capDetails?.conjunctionReservations?.searchMaxGroupSize ?? 1,
    conjunctionReservationSupportsRequestedMaxGroupSize:
      capDetails?.conjunctionReservations?.supportsRequestedMaxGroupSize ?? true,
    conjunctionReservationSearchExhaustive: capDetails?.conjunctionReservations?.reservationSearchExhaustive ?? true,
    conjunctionReservationCoversRequestedMaxGroupSize:
      capDetails?.conjunctionReservations?.coversRequestedMaxGroupSize ?? true,
    conjunctionReservationSearchDescription:
      capDetails?.conjunctionReservations?.searchDescription ??
      "Bounded recursive reservation search up to requested --max-group-size; full candidate enumeration honors --max-group-size.",
    conjunctionReservationAvailableUnsafeTargetAtomCount:
      capDetails?.conjunctionReservations?.availableUnsafeTargetAtomCount ?? 0,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      capDetails?.conjunctionReservations?.consideredUnsafeTargetAtomCount ?? 0,
    conjunctionReservationAvailablePartnerAtomCount:
      capDetails?.conjunctionReservations?.availablePartnerAtomCount ?? 0,
    conjunctionReservationConsideredPartnerAtomCount:
      capDetails?.conjunctionReservations?.consideredPartnerAtomCount ?? 0,
    conjunctionReservationSlicedUnsafeTargetAtoms:
      capDetails?.conjunctionReservations?.slicedUnsafeTargetAtoms ?? false,
    conjunctionReservationSlicedPartnerAtoms: capDetails?.conjunctionReservations?.slicedPartnerAtoms ?? false,
    conjunctionReservationReachedReservationAtomCap:
      capDetails?.conjunctionReservations?.reachedReservationAtomCap ?? false,
    reservedConjunctionGroupCount: capDetails?.conjunctionReservations?.reservedConjunctions?.length ?? 0,
    reservedConjunctionPairCount: capDetails?.conjunctionReservations?.reservedPairs?.length ?? 0,
    reservedConjunctionTripleCount:
      capDetails?.conjunctionReservations?.reservedConjunctions?.filter((candidate) => candidate.atomCount === 3)
        .length ?? 0,
    conjunctionReservationExhaustedSearchBudget: capDetails?.conjunctionReservations?.exhaustedSearchBudget ?? false,
    conjunctionReservationEvaluatedGroupCount: capDetails?.conjunctionReservations?.evaluatedConjunctionGroupCount ?? 0,
    conjunctionReservationMaxEvaluatedGroupCount:
      capDetails?.conjunctionReservations?.maxEvaluatedConjunctionGroupCount ?? 0,
    conjunctionReservationEvaluatedPairCount: capDetails?.conjunctionReservations?.evaluatedPairCount ?? 0,
    conjunctionReservationMaxEvaluatedPairCount: capDetails?.conjunctionReservations?.maxEvaluatedPairCount ?? 0,
    reservedConjunctionExamples: (capDetails?.conjunctionReservations?.reservedConjunctions ?? []).slice(0, 8)
  };
}

function selectCappedFeatureAtoms(featureAtoms, maxAtomsPerFeature, target, maxGroupSize) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const sortedFeatureAtoms = featureAtoms.slice().sort(compareTargetAtoms);
  if (sortedFeatureAtoms.length <= maxAtomsPerFeature) return sortedFeatureAtoms;

  const selectedAtoms = [];
  const selectedSignatures = new Set();
  const addAtom = (atom) => {
    if (selectedAtoms.length >= maxAtomsPerFeature || selectedSignatures.has(atom.signature)) return false;
    selectedAtoms.push(atom);
    selectedSignatures.add(atom.signature);
    return true;
  };

  const unsafeReservation =
    maxGroupSize > 1 && maxAtomsPerFeature >= 2
      ? Math.min(
          sortedFeatureAtoms.filter((atom) => atom.safetyRegressed > 0).length,
          Math.max(1, Math.floor(maxAtomsPerFeature / 3))
        )
      : 0;
  const safeCapacity = Math.max(0, maxAtomsPerFeature - unsafeReservation);
  for (const atom of sortedFeatureAtoms.filter((candidate) => candidate.safetyRegressed === 0).slice(0, safeCapacity)) {
    addAtom(atom);
  }
  for (const atom of sortedFeatureAtoms
    .filter((candidate) => candidate.safetyRegressed > 0)
    .slice(0, unsafeReservation)) {
    addAtom(atom);
  }
  for (const atom of sortedFeatureAtoms) addAtom(atom);
  return selectedAtoms.sort(compareTargetAtoms);
}

function buildAtoms(rows, features, maxAtomsPerFeature, target, maxGroupSize) {
  const compareTargetAtoms = atomComparatorForTarget(target);
  const totalCandidateAtoms = [];
  const perFeatureCappedAtoms = [];
  for (const feature of features) {
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
        ...evaluatePredicate(rows, (row) => atomToGates(atom).every((gate) => gatePasses(row, gate)), target)
      }))
      .filter((atom) => atom.targetImproved > 0)
      .sort(compareTargetAtoms);
    totalCandidateAtoms.push(...featureAtoms);
    perFeatureCappedAtoms.push(...selectCappedFeatureAtoms(featureAtoms, maxAtomsPerFeature, target, maxGroupSize));
  }
  return {
    totalCandidateAtoms: sortedUniqueAtoms(totalCandidateAtoms, compareTargetAtoms),
    perFeatureCappedAtoms: sortedUniqueAtoms(perFeatureCappedAtoms, compareTargetAtoms)
  };
}

function buildCandidate(atomGroup, rows, target, validationRows = []) {
  const gates = atomGroup.flatMap(atomToGates);
  const cliArg = gatesCliArg(gates);
  const metrics = evaluateGates(rows, gates, target);
  const validationMetrics =
    validationRows.length > 0 ? withSafetyFlag(evaluateGates(validationRows, gates, target)) : null;
  return {
    atomCount: atomGroup.length,
    atoms: atomGroup.map(({ feature, kind, value, signature }) => ({ feature, kind, value, signature })),
    gates,
    cliArg,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0,
    validation: validationMetrics
  };
}

function enumerateCandidates(rows, atoms, maxGroupSize, target, validationRows = []) {
  const candidates = [];
  const seen = new Set();

  function visit(start, group, usedFeatures) {
    if (group.length > 0) {
      const candidate = buildCandidate(group, rows, target, validationRows);
      const signature = candidate.cliArg;
      if (!seen.has(signature)) {
        seen.add(signature);
        if (candidate.targetImproved > 0 && candidate.safetyRegressed === 0) candidates.push(candidate);
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
  return candidates.sort(validationRows.length > 0 ? compareCandidatesWithValidation : compareCandidates);
}

function buildGreedyGroupSet(rows, candidates, target) {
  const uncovered = new Set(rows.filter((row) => isPositive(row, target)).map((row) => row.key));
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
  const metrics = evaluatePredicate(rows, (row) => selectedKeys.has(row.key), target);
  return {
    groups: selectedGroups.map((candidate) => ({
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      targetImproved: candidate.targetImproved,
      selectionImproved: candidate.selectionImproved,
      selectionRegressed: candidate.selectionRegressed,
      terminalFinalImproved: candidate.terminalFinalImproved,
      terminalFinalRegressed: candidate.terminalFinalRegressed,
      finalImproved: candidate.finalImproved,
      finalRegressed: candidate.finalRegressed,
      safetyRegressed: candidate.safetyRegressed,
      neutral: candidate.neutral,
      selected: candidate.selected
    })),
    selectedFeatureGateGroups: selectedGroups.map((candidate) => candidate.gates),
    cliArg: selectedGroups.map((candidate) => candidate.cliArg).join(";"),
    uncoveredPositiveCount: uncovered.size,
    ...metrics,
    safeNoRegression: metrics.selected > 0 && metrics.targetImproved > 0 && metrics.safetyRegressed === 0
  };
}

function gatesGroupPredicate(selectedGateGroups) {
  return (row) => selectedGateGroups.some((gates) => gates.every((gate) => gatePasses(row, gate)));
}

function buildValidationGreedyGroupSet(rows, validationRows, candidates, target) {
  if (validationRows.length === 0) return null;
  const uncovered = new Set(validationRows.filter((row) => isPositive(row, target)).map((row) => row.key));
  const selectedGroups = [];
  const selectedValidationKeys = new Set();
  for (const candidate of candidates.filter((candidate) => candidate.validation?.safeNoRegression)) {
    const positiveGain = candidate.validation.positiveKeys.filter((key) => uncovered.has(key)).length;
    if (positiveGain === 0) continue;
    selectedGroups.push(candidate);
    for (const key of candidate.validation.selectedKeys) selectedValidationKeys.add(key);
    for (const key of candidate.validation.positiveKeys) uncovered.delete(key);
    if (uncovered.size === 0) break;
  }
  const selectedFeatureGateGroups = selectedGroups.map((candidate) => candidate.gates);
  const validationMetrics = withSafetyFlag(
    evaluatePredicate(validationRows, (row) => selectedValidationKeys.has(row.key), target)
  );
  const sourceMetrics = withSafetyFlag(
    selectedFeatureGateGroups.length === 0
      ? evaluatePredicate(rows, () => false, target)
      : evaluatePredicate(rows, gatesGroupPredicate(selectedFeatureGateGroups), target)
  );
  return {
    groups: selectedGroups.map((candidate) => ({
      gates: candidate.gates,
      cliArg: candidate.cliArg,
      source: compactMetrics(candidate),
      validation: compactMetrics(candidate.validation)
    })),
    selectedFeatureGateGroups,
    cliArg: selectedGroups.map((candidate) => candidate.cliArg).join(";"),
    uncoveredPositiveCount: uncovered.size,
    source: sourceMetrics,
    validation: validationMetrics,
    ...validationMetrics,
    safeNoRegression: validationMetrics.safeNoRegression
  };
}

function compactMetrics(metrics) {
  return {
    selected: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta,
    safeNoRegression: metrics.safeNoRegression
  };
}

function metricsReportProjection(metrics) {
  return {
    selected: metrics.selected,
    targetImproved: metrics.targetImproved,
    selectionImproved: metrics.selectionImproved,
    selectionRegressed: metrics.selectionRegressed,
    terminalFinalImproved: metrics.terminalFinalImproved,
    terminalFinalRegressed: metrics.terminalFinalRegressed,
    finalImproved: metrics.finalImproved,
    finalRegressed: metrics.finalRegressed,
    safetyRegressed: metrics.safetyRegressed,
    neutral: metrics.neutral,
    unknown: metrics.unknown,
    bestFinalDelta: metrics.bestFinalDelta,
    worstFinalDelta: metrics.worstFinalDelta,
    safeNoRegression: metrics.safeNoRegression,
    positiveExamples: metrics.positiveExamples.map(exampleReportProjection),
    regressionExamples: metrics.regressionExamples.map(exampleReportProjection),
    selectionRegressionExamples: metrics.selectionRegressionExamples.map(exampleReportProjection),
    finalRegressionExamples: metrics.finalRegressionExamples.map(exampleReportProjection),
    safetyRegressionExamples: metrics.safetyRegressionExamples.map(exampleReportProjection)
  };
}

function candidateReportProjection(candidate) {
  return {
    atomCount: candidate.atomCount,
    atoms: candidate.atoms,
    gates: candidate.gates,
    cliArg: candidate.cliArg,
    ...metricsReportProjection(candidate),
    validation: candidate.validation ? metricsReportProjection(candidate.validation) : null
  };
}

function canonicalCappedAtomSummary(summary) {
  return {
    semanticsVersion: ATOM_CAP_SUMMARY_SEMANTICS_VERSION,
    strategy: summary.strategy,
    safeSingletonAdmissionQuota: summary.safeSingletonAdmissionQuota,
    candidateAtomUniverseCount: summary.candidateAtomUniverseCount,
    perFeatureCappedAtomCount: summary.perFeatureCappedAtomCount,
    perFeatureOmittedAtomCount: summary.perFeatureOmittedAtomCount,
    reservationCandidateAtomCount: summary.reservationCandidateAtomCount,
    safeTargetAtomCount: summary.safeTargetAtomCount,
    unsafeTargetAtomCount: summary.unsafeTargetAtomCount,
    perFeatureCappedSafeTargetAtomCount: summary.perFeatureCappedSafeTargetAtomCount,
    perFeatureCappedUnsafeTargetAtomCount: summary.perFeatureCappedUnsafeTargetAtomCount,
    includedSafeTargetAtomCount: summary.includedSafeTargetAtomCount,
    omittedSafeTargetAtomCount: summary.omittedSafeTargetAtomCount,
    includedUnsafeTargetAtomCount: summary.includedUnsafeTargetAtomCount,
    omittedUnsafeTargetAtomCount: summary.omittedUnsafeTargetAtomCount,
    reservedConjunctionAtomCount: summary.reservedConjunctionAtomCount,
    reservedPerFeatureOmittedConjunctionAtomCount: summary.reservedPerFeatureOmittedConjunctionAtomCount,
    includedReservedConjunctionAtomCount: summary.includedReservedConjunctionAtomCount,
    omittedReservedConjunctionAtomCount: summary.omittedReservedConjunctionAtomCount,
    reservedUnsafeConjunctionAtomCount: summary.reservedUnsafeConjunctionAtomCount,
    conjunctionReservationRequestedMaxGroupSize: summary.conjunctionReservationRequestedMaxGroupSize,
    conjunctionReservationSearchMaxGroupSize: summary.conjunctionReservationSearchMaxGroupSize,
    conjunctionReservationSupportsRequestedMaxGroupSize: summary.conjunctionReservationSupportsRequestedMaxGroupSize,
    conjunctionReservationSearchExhaustive: summary.conjunctionReservationSearchExhaustive,
    conjunctionReservationCoversRequestedMaxGroupSize: summary.conjunctionReservationCoversRequestedMaxGroupSize,
    conjunctionReservationAvailableUnsafeTargetAtomCount: summary.conjunctionReservationAvailableUnsafeTargetAtomCount,
    conjunctionReservationConsideredUnsafeTargetAtomCount:
      summary.conjunctionReservationConsideredUnsafeTargetAtomCount,
    conjunctionReservationAvailablePartnerAtomCount: summary.conjunctionReservationAvailablePartnerAtomCount,
    conjunctionReservationConsideredPartnerAtomCount: summary.conjunctionReservationConsideredPartnerAtomCount,
    conjunctionReservationSlicedUnsafeTargetAtoms: summary.conjunctionReservationSlicedUnsafeTargetAtoms,
    conjunctionReservationSlicedPartnerAtoms: summary.conjunctionReservationSlicedPartnerAtoms,
    conjunctionReservationReachedReservationAtomCap: summary.conjunctionReservationReachedReservationAtomCap,
    reservedConjunctionGroupCount: summary.reservedConjunctionGroupCount,
    reservedConjunctionPairCount: summary.reservedConjunctionPairCount,
    reservedConjunctionTripleCount: summary.reservedConjunctionTripleCount,
    conjunctionReservationExhaustedSearchBudget: summary.conjunctionReservationExhaustedSearchBudget,
    conjunctionReservationEvaluatedGroupCount: summary.conjunctionReservationEvaluatedGroupCount,
    conjunctionReservationMaxEvaluatedGroupCount: summary.conjunctionReservationMaxEvaluatedGroupCount,
    conjunctionReservationEvaluatedPairCount: summary.conjunctionReservationEvaluatedPairCount,
    conjunctionReservationMaxEvaluatedPairCount: summary.conjunctionReservationMaxEvaluatedPairCount,
    reservedConjunctionExamples: summary.reservedConjunctionExamples.map((candidate) => ({
      atomCount: candidate.atomCount,
      cliArg: candidate.cliArg,
      targetImproved: candidate.targetImproved,
      selected: candidate.selected
    }))
  };
}

function canonicalGreedyGroupSet(greedy) {
  return {
    groups: greedy.groups,
    selectedFeatureGateGroups: greedy.selectedFeatureGateGroups,
    cliArg: greedy.cliArg,
    uncoveredPositiveCount: greedy.uncoveredPositiveCount,
    selected: greedy.selected,
    targetImproved: greedy.targetImproved,
    selectionImproved: greedy.selectionImproved,
    selectionRegressed: greedy.selectionRegressed,
    terminalFinalImproved: greedy.terminalFinalImproved,
    terminalFinalRegressed: greedy.terminalFinalRegressed,
    finalImproved: greedy.finalImproved,
    finalRegressed: greedy.finalRegressed,
    safetyRegressed: greedy.safetyRegressed,
    neutral: greedy.neutral,
    unknown: greedy.unknown,
    bestFinalDelta: greedy.bestFinalDelta,
    worstFinalDelta: greedy.worstFinalDelta,
    selectedKeys: greedy.selectedKeys.slice().sort(),
    positiveKeys: greedy.positiveKeys.slice().sort(),
    safeNoRegression: greedy.safeNoRegression
  };
}

function canonicalValidationGreedyGroupSet(greedy) {
  if (!greedy) return null;
  return {
    groups: greedy.groups,
    selectedFeatureGateGroups: greedy.selectedFeatureGateGroups,
    cliArg: greedy.cliArg,
    uncoveredPositiveCount: greedy.uncoveredPositiveCount,
    source: {
      ...compactMetrics(greedy.source),
      selectedKeys: greedy.source.selectedKeys.slice().sort(),
      positiveKeys: greedy.source.positiveKeys.slice().sort()
    },
    validation: {
      ...compactMetrics(greedy.validation),
      selectedKeys: greedy.validation.selectedKeys.slice().sort(),
      positiveKeys: greedy.validation.positiveKeys.slice().sort()
    }
  };
}

function discoveryIdentityPayload(payload) {
  return {
    schemaVersion: DISCOVERY_IDENTITY_SCHEMA_VERSION,
    artifactSchemaVersion: payload.schemaVersion,
    target: payload.target,
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
    v2DeprecatedMetricAliasSchemaVersion: payload.v2DeprecatedMetricAliases.schemaVersion,
    sourceScorecards: payload.sourceScorecards,
    validationSourceScorecards: payload.validationSourceScorecards,
    featureAllowlist: payload.featureAllowlist,
    features: payload.features,
    maxGroupSize: payload.maxGroupSize,
    maxAtomsPerFeature: payload.maxAtomsPerFeature,
    maxTotalAtoms: payload.maxTotalAtoms,
    totalCandidateAtomCount: payload.totalCandidateAtomCount,
    perFeatureCappedAtomCount: payload.perFeatureCappedAtomCount,
    atomCount: payload.atomCount,
    cappedAtomSummary: canonicalCappedAtomSummary(payload.cappedAtomSummary),
    rowSummary: payload.rowSummary,
    validationRowSummary: payload.validationRowSummary,
    candidateCount: payload.candidateCount,
    greedySelectedGateGroups: canonicalGreedyGroupSet(payload.greedySelectedGateGroups),
    validationGreedySelectedGateGroups: canonicalValidationGreedyGroupSet(payload.validationGreedySelectedGateGroups)
  };
}

function reportMetricsPayload(discovery) {
  return {
    sourceScorecardCount: discovery.sourceScorecards.length,
    validationSourceScorecardCount: discovery.validationSourceScorecards.length,
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
    cappedAtomSummary: canonicalCappedAtomSummary(discovery.cappedAtomSummary),
    candidateCount: discovery.candidateCount,
    topCandidateCount: discovery.topCandidateCount,
    topCandidateCliArg: discovery.topCandidates[0]?.cliArg ?? null,
    topCandidates: discovery.topCandidates.map(candidateReportProjection),
    greedySelectedGateGroups: {
      groups: discovery.greedySelectedGateGroups.groups,
      selectedFeatureGateGroups: discovery.greedySelectedGateGroups.selectedFeatureGateGroups,
      cliArg: discovery.greedySelectedGateGroups.cliArg,
      selected: discovery.greedySelectedGateGroups.selected,
      targetImproved: discovery.greedySelectedGateGroups.targetImproved,
      selectionImproved: discovery.greedySelectedGateGroups.selectionImproved,
      selectionRegressed: discovery.greedySelectedGateGroups.selectionRegressed,
      terminalFinalImproved: discovery.greedySelectedGateGroups.terminalFinalImproved,
      terminalFinalRegressed: discovery.greedySelectedGateGroups.terminalFinalRegressed,
      finalImproved: discovery.greedySelectedGateGroups.finalImproved,
      finalRegressed: discovery.greedySelectedGateGroups.finalRegressed,
      safetyRegressed: discovery.greedySelectedGateGroups.safetyRegressed,
      neutral: discovery.greedySelectedGateGroups.neutral,
      safeNoRegression: discovery.greedySelectedGateGroups.safeNoRegression
    },
    validationGreedySelectedGateGroups: discovery.validationGreedySelectedGateGroups
      ? {
          groups: discovery.validationGreedySelectedGateGroups.groups,
          selectedFeatureGateGroups: discovery.validationGreedySelectedGateGroups.selectedFeatureGateGroups,
          cliArg: discovery.validationGreedySelectedGateGroups.cliArg,
          selected: discovery.validationGreedySelectedGateGroups.selected,
          targetImproved: discovery.validationGreedySelectedGateGroups.targetImproved,
          selectionImproved: discovery.validationGreedySelectedGateGroups.selectionImproved,
          selectionRegressed: discovery.validationGreedySelectedGateGroups.selectionRegressed,
          terminalFinalImproved: discovery.validationGreedySelectedGateGroups.terminalFinalImproved,
          terminalFinalRegressed: discovery.validationGreedySelectedGateGroups.terminalFinalRegressed,
          finalImproved: discovery.validationGreedySelectedGateGroups.finalImproved,
          finalRegressed: discovery.validationGreedySelectedGateGroups.finalRegressed,
          safetyRegressed: discovery.validationGreedySelectedGateGroups.safetyRegressed,
          neutral: discovery.validationGreedySelectedGateGroups.neutral,
          safeNoRegression: discovery.validationGreedySelectedGateGroups.safeNoRegression,
          source: compactMetrics(discovery.validationGreedySelectedGateGroups.source),
          validation: compactMetrics(discovery.validationGreedySelectedGateGroups.validation)
        }
      : null
  };
}

function registryDisplayProjection(rows) {
  return {
    cases: [...new Set(rows.map((row) => row.caseName))].sort(),
    caseFamilies: [
      "lns-window-ranker-online",
      ...new Set(rows.map((row) => row.pressureFamily).filter(Boolean))
    ].sort(),
    seeds: [...new Set(rows.map((row) => row.seed).filter((seed) => seed !== null))].sort((left, right) => left - right)
  };
}

function reportIdentityPayload({ discovery, command, artifactDir, outputArtifacts, top, registryDisplay }) {
  return {
    schemaVersion: REPORT_IDENTITY_SCHEMA_VERSION,
    source: "lns-online-selected-feature-gate-discovery",
    discoveryFingerprint: discovery.discoveryFingerprint,
    top,
    reportMetrics: reportMetricsPayload(discovery),
    registryDisplay,
    command,
    artifactDir,
    outputArtifacts
  };
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
