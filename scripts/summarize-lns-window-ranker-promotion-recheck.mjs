#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/summarize-lns-window-ranker-promotion-recheck.mjs";
const RECHECK_FILE = "lns-window-ranker-promotion-recheck.json";
const RECHECK_TEXT_FILE = "lns-window-ranker-promotion-recheck.txt";
const REQUIRED_CORPORA = ["product", "protected", "default", "fresh"];
const CORPUS_SET = new Set(REQUIRED_CORPORA);

function usage() {
  return [
    "Usage: node scripts/summarize-lns-window-ranker-promotion-recheck.mjs --artifact-dir=<dir> --scorecard=<candidate>:<corpus>:<path> [options]",
    "",
    "Summarizes existing online LNS window-ranker scorecards into a promotion-gate recheck artifact.",
    "",
    "Options:",
    "  --candidate=<id>[:<label>]       Optional display label for a candidate. Repeatable.",
    "  --scorecard=<id>:<corpus>:<path> Scorecard JSON for product, protected, default, or fresh. Repeatable.",
    "  --artifact-dir=<dir>             Output artifact bundle directory under artifacts/.",
    "  --run-id=<id>                    Registry draft run id.",
    "  --decision=<text>                Registry draft decision. Default: diagnostics-only.",
    "  --summary=<text>                 Registry draft summary.",
    "  --force-artifact-dir             Reuse an existing artifact directory."
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
    "Missing dist/benchmarkApi.js. Run npm run build before summarizing LNS promotion rechecks."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before summarizing LNS promotion rechecks."
  );
}

function parseCandidateArg(value) {
  const separator = value.indexOf(":");
  if (separator === -1) return { id: value.trim(), label: value.trim() };
  return {
    id: value.slice(0, separator).trim(),
    label: value.slice(separator + 1).trim()
  };
}

function parseScorecardArg(value) {
  const firstSeparator = value.indexOf(":");
  const secondSeparator = value.indexOf(":", firstSeparator + 1);
  if (firstSeparator === -1 || secondSeparator === -1) {
    throw new Error("--scorecard must use <candidate>:<corpus>:<path>.");
  }
  const candidateId = value.slice(0, firstSeparator).trim();
  const corpus = value.slice(firstSeparator + 1, secondSeparator).trim();
  const scorecardPath = value.slice(secondSeparator + 1).trim();
  if (!candidateId) throw new Error("--scorecard candidate id must not be empty.");
  if (!CORPUS_SET.has(corpus)) {
    throw new Error(`--scorecard corpus must be one of ${REQUIRED_CORPORA.join(", ")}.`);
  }
  if (!scorecardPath) throw new Error("--scorecard path must not be empty.");
  return { candidateId, corpus, scorecardPath };
}

function parseArgs(argv) {
  const candidates = [];
  const scorecards = [];
  let artifactDir;
  let runId;
  let decision = "diagnostics-only";
  let summary = "Promotion-gate recheck for existing online LNS window-ranker candidates; no solver default changed.";
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
    if (arg.startsWith("--candidate=")) {
      candidates.push(parseCandidateArg(arg.slice("--candidate=".length)));
      continue;
    }
    if (arg.startsWith("--scorecard=")) {
      scorecards.push(parseScorecardArg(arg.slice("--scorecard=".length)));
      continue;
    }
    if (arg.startsWith("--artifact-dir=")) {
      artifactDir = arg.slice("--artifact-dir=".length);
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      runId = arg.slice("--run-id=".length);
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
  if (scorecards.length === 0) throw new Error("At least one --scorecard is required.");
  return { artifactDir, candidates, scorecards, runId, decision, summary, forceArtifactDir };
}

function commandString(defaultCliReplayCommand, options) {
  const argv = [`--artifact-dir=${options.artifactDir}`];
  for (const candidate of options.candidates) {
    argv.push(
      candidate.id === candidate.label
        ? `--candidate=${candidate.id}`
        : `--candidate=${candidate.id}:${candidate.label}`
    );
  }
  for (const scorecard of options.scorecards) {
    argv.push(`--scorecard=${scorecard.candidateId}:${scorecard.corpus}:${scorecard.scorecardPath}`);
  }
  if (options.runId) argv.push(`--run-id=${options.runId}`);
  if (options.decision !== "diagnostics-only") argv.push(`--decision=${options.decision}`);
  if (
    options.summary !==
    "Promotion-gate recheck for existing online LNS window-ranker candidates; no solver default changed."
  ) {
    argv.push(`--summary=${options.summary}`);
  }
  if (options.forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value) {
  const parsed = asNumber(value);
  return parsed === null ? 0 : parsed;
}

function asBoolean(value) {
  return value === true ? true : value === false ? false : null;
}

function findWindowRankerSummary(scorecard, label) {
  const summary = scorecard.variantSummaries?.find((variant) => variant?.variantName === "window-ranker");
  if (!summary) throw new Error(`${label} does not contain a window-ranker variant summary.`);
  return summary;
}

function findWindowRankerConfig(scorecard) {
  for (const testCase of scorecard.cases ?? []) {
    for (const variant of testCase.variants ?? []) {
      if (variant?.variantName === "window-ranker" && variant.windowRanker) {
        return structuredClone(variant.windowRanker);
      }
    }
  }
  return {};
}

function scorecardSeeds(scorecard) {
  const seeds = new Set();
  for (const seed of scorecard.seeds ?? []) {
    if (Number.isInteger(seed)) seeds.add(seed);
  }
  for (const testCase of scorecard.cases ?? []) {
    if (Number.isInteger(testCase?.seed)) seeds.add(testCase.seed);
  }
  return [...seeds].sort((a, b) => a - b);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function evaluateCorpus({ corpus, scorecardPath, scorecard }) {
  const summary = findWindowRankerSummary(scorecard, scorecardPath);
  const model = findWindowRankerConfig(scorecard);
  const comparisonCount = asCount(summary.comparisonCount ?? scorecard.comparisonCount);
  const improvedCaseCount = asCount(summary.improvedCaseCount);
  const regressedCaseCount = asCount(summary.regressedCaseCount);
  const unchangedCaseCount = asCount(summary.unchangedCaseCount);
  const rankerOverrideCount = asCount(summary.rankerOverrideCount);
  const rankerFallbackDecisionCount = asCount(summary.rankerFallbackDecisionCount);
  const overrideFinalImprovedCaseCount = asCount(summary.overrideFinalImprovedCaseCount);
  const overrideFinalNeutralCaseCount = asCount(summary.overrideFinalNeutralCaseCount);
  const overrideFinalRegressedCaseCount = asCount(summary.overrideFinalRegressedCaseCount);
  const worstPopulationDeltaVsBaseline = asNumber(summary.worstPopulationDeltaVsBaseline);
  const meanPopulationDeltaVsBaseline = asNumber(summary.meanPopulationDeltaVsBaseline);
  const populationSafe =
    regressedCaseCount === 0 &&
    overrideFinalRegressedCaseCount === 0 &&
    worstPopulationDeltaVsBaseline !== null &&
    worstPopulationDeltaVsBaseline >= 0;
  const activeOverride = rankerOverrideCount > 0;
  const allFallback = !activeOverride && rankerFallbackDecisionCount > 0;
  const finalNeutralClean = overrideFinalNeutralCaseCount === 0;
  const activeFinalValue = populationSafe && overrideFinalImprovedCaseCount > 0 && finalNeutralClean;
  const populationValue =
    activeOverride &&
    populationSafe &&
    improvedCaseCount > 0 &&
    meanPopulationDeltaVsBaseline !== null &&
    meanPopulationDeltaVsBaseline > 0;
  const equalPopulationTimeToBestGatePassed = asBoolean(summary.equalPopulationTimeToBestGatePassed);
  const timeToBestPromotionGatePassed = asBoolean(summary.timeToBestPromotionGatePassed);
  const timeToBestValue = activeOverride && timeToBestPromotionGatePassed === true;
  const axisPassed = activeFinalValue || timeToBestValue || (corpus === "product" && populationValue);

  return {
    corpus,
    scorecardPath,
    caseCount: asCount(scorecard.caseCount),
    seedCount: asCount(scorecard.seedCount),
    comparisonCount,
    seeds: scorecardSeeds(scorecard),
    selectedCaseNames: scorecard.selectedCaseNames ?? [],
    model,
    meanPopulationDeltaVsBaseline,
    medianPopulationDeltaVsBaseline: asNumber(summary.medianPopulationDeltaVsBaseline),
    worstPopulationDeltaVsBaseline,
    bestPopulationDeltaVsBaseline: asNumber(summary.bestPopulationDeltaVsBaseline),
    improvedCaseCount,
    regressedCaseCount,
    unchangedCaseCount,
    rankerDecisionCount: asCount(summary.rankerDecisionCount),
    rankerOverrideCount,
    rankerFallbackDecisionCount,
    overrideFinalImprovedCaseCount,
    overrideFinalNeutralCaseCount,
    overrideFinalRegressedCaseCount,
    overrideTransitionCounts: summary.overrideTransitionCounts ?? {},
    overrideTransitionPressureFamilyCounts: summary.overrideTransitionPressureFamilyCounts ?? {},
    equalPopulationTimeToBestGatePassed,
    timeToBestPromotionGatePassed,
    meanTimeToBestWallClockRatioVsBaseline: asNumber(summary.meanTimeToBestWallClockRatioVsBaseline),
    medianTimeToBestWallClockRatioVsBaseline: asNumber(summary.medianTimeToBestWallClockRatioVsBaseline),
    timeToBestWallClockKnownPairCount: asCount(summary.timeToBestWallClockKnownPairCount),
    timeToBestWallClockUnknownPairCount: asCount(summary.timeToBestWallClockUnknownPairCount),
    timeToBestWallClockFaster10PercentCount: asCount(summary.timeToBestWallClockFaster10PercentCount),
    timeToBestWallClockSlower10PercentCount: asCount(summary.timeToBestWallClockSlower10PercentCount),
    populationSafe,
    activeOverride,
    allFallback,
    finalNeutralClean,
    activeFinalValue,
    populationValue,
    timeToBestValue,
    axisPassed
  };
}

function addIf(target, condition, value) {
  if (condition) target.push(value);
}

function candidateBlockers(corpora) {
  const blockers = [];
  const diagnostics = [];
  for (const corpus of REQUIRED_CORPORA) {
    const report = corpora[corpus];
    addIf(blockers, report === undefined, `${corpus}-scorecard-missing`);
    if (!report) continue;
    addIf(blockers, !report.populationSafe, `${corpus}-population-safety-failed`);
    addIf(
      blockers,
      report.overrideFinalNeutralCaseCount > 0,
      `${corpus}-final-neutral-overrides-${report.overrideFinalNeutralCaseCount}`
    );
    addIf(diagnostics, report.timeToBestPromotionGatePassed !== true, `${corpus}-time-to-best-gate-failed`);
    addIf(diagnostics, report.allFallback, `${corpus}-all-fallback`);
  }
  const product = corpora.product;
  const protectedReport = corpora.protected;
  const fresh = corpora.fresh;
  addIf(blockers, product !== undefined && !product.axisPassed, "product-axis-value-missing");
  addIf(
    blockers,
    protectedReport !== undefined && !protectedReport.axisPassed,
    "protected-active-value-or-time-to-best-missing"
  );
  addIf(blockers, fresh !== undefined && !fresh.axisPassed, "fresh-active-value-or-time-to-best-missing");
  return {
    blockers: uniqueStrings(blockers),
    diagnostics: uniqueStrings(diagnostics)
  };
}

function summarizeCandidate(candidate) {
  const corpora = Object.fromEntries(candidate.corpora.map((report) => [report.corpus, report]));
  const { blockers, diagnostics } = candidateBlockers(corpora);
  const requiredCorporaPresent = REQUIRED_CORPORA.every((corpus) => corpora[corpus] !== undefined);
  const populationSafe = candidate.corpora.every((report) => report.populationSafe);
  const finalNeutralClean = candidate.corpora.every((report) => report.finalNeutralClean);
  const productAxisPassed = corpora.product?.axisPassed === true;
  const protectedAxisPassed = corpora.protected?.axisPassed === true;
  const freshAxisPassed = corpora.fresh?.axisPassed === true;
  const promotionReady =
    requiredCorporaPresent &&
    populationSafe &&
    finalNeutralClean &&
    productAxisPassed &&
    protectedAxisPassed &&
    freshAxisPassed;
  const modelFingerprints = uniqueStrings(candidate.corpora.map((report) => report.model.modelFingerprint));
  const suppressionModelFingerprints = uniqueStrings(
    candidate.corpora.map((report) => report.model.suppressionModelFingerprint)
  );
  const suppressionMinScoreDeltas = [
    ...new Set(candidate.corpora.map((report) => report.model.suppressionMinScoreDelta).filter(Number.isFinite))
  ].sort((a, b) => a - b);
  return {
    id: candidate.id,
    label: candidate.label,
    corpusCount: candidate.corpora.length,
    requiredCorporaPresent,
    promotionReady,
    populationSafe,
    finalNeutralClean,
    productAxisPassed,
    productTimeToBestPassed: corpora.product?.timeToBestPromotionGatePassed === true,
    protectedAxisPassed,
    protectedTimeToBestPassed: corpora.protected?.timeToBestPromotionGatePassed === true,
    freshAxisPassed,
    freshTimeToBestPassed: corpora.fresh?.timeToBestPromotionGatePassed === true,
    blockerCount: blockers.length,
    blockers,
    diagnostics,
    modelFingerprints,
    suppressionModelFingerprints,
    suppressionMinScoreDeltas,
    corpora: REQUIRED_CORPORA.map((corpus) => corpora[corpus]).filter(Boolean)
  };
}

function buildCandidates(options, artifactHelpers) {
  const candidateMap = new Map();
  for (const candidate of options.candidates) {
    if (!candidate.id) throw new Error("--candidate id must not be empty.");
    candidateMap.set(candidate.id, { id: candidate.id, label: candidate.label || candidate.id, corpora: [] });
  }
  for (const scorecardInput of options.scorecards) {
    if (!candidateMap.has(scorecardInput.candidateId)) {
      candidateMap.set(scorecardInput.candidateId, {
        id: scorecardInput.candidateId,
        label: scorecardInput.candidateId,
        corpora: []
      });
    }
    const candidate = candidateMap.get(scorecardInput.candidateId);
    if (candidate.corpora.some((report) => report.corpus === scorecardInput.corpus)) {
      throw new Error(`Duplicate scorecard for ${scorecardInput.candidateId}:${scorecardInput.corpus}.`);
    }
    const { repoRelativePath, value } = artifactHelpers.readJsonRepoInputArtifact(
      scorecardInput.scorecardPath,
      `--scorecard=${scorecardInput.candidateId}:${scorecardInput.corpus}`,
      { mustExist: true }
    );
    candidate.corpora.push(
      evaluateCorpus({
        corpus: scorecardInput.corpus,
        scorecardPath: repoRelativePath,
        scorecard: value
      })
    );
  }
  return [...candidateMap.values()].map((candidate) => ({
    ...candidate,
    corpora: [...candidate.corpora].sort(
      (a, b) => REQUIRED_CORPORA.indexOf(a.corpus) - REQUIRED_CORPORA.indexOf(b.corpus)
    )
  }));
}

function allSeeds(candidates) {
  const seeds = new Set();
  for (const candidate of candidates) {
    for (const corpus of candidate.corpora) {
      for (const seed of corpus.seeds) seeds.add(seed);
    }
  }
  return [...seeds].sort((a, b) => a - b);
}

function caseFamilies(candidates) {
  const families = new Set();
  for (const candidate of candidates) {
    for (const corpus of candidate.corpora) {
      families.add(`lns-window-ranker-online-${corpus.corpus}`);
    }
  }
  return [...families].sort();
}

function casesByCorpus(candidates) {
  const cases = {};
  for (const corpus of REQUIRED_CORPORA) {
    const names = new Set();
    for (const candidate of candidates) {
      for (const report of candidate.corpora) {
        if (report.corpus !== corpus) continue;
        for (const caseName of report.selectedCaseNames) {
          if (typeof caseName === "string") names.add(caseName);
        }
      }
    }
    cases[corpus] = [...names].sort();
  }
  return cases;
}

function promotionSummary(candidates) {
  const summaries = candidates.map(summarizeCandidate);
  return {
    candidateCount: summaries.length,
    scorecardCount: candidates.reduce((total, candidate) => total + candidate.corpora.length, 0),
    promotionReadyCandidateCount: summaries.filter((candidate) => candidate.promotionReady).length,
    populationSafeCandidateCount: summaries.filter((candidate) => candidate.populationSafe).length,
    finalNeutralCleanCandidateCount: summaries.filter((candidate) => candidate.finalNeutralClean).length,
    productAxisPassedCandidateCount: summaries.filter((candidate) => candidate.productAxisPassed).length,
    productTimeToBestPassedCandidateCount: summaries.filter((candidate) => candidate.productTimeToBestPassed).length,
    protectedAxisPassedCandidateCount: summaries.filter((candidate) => candidate.protectedAxisPassed).length,
    freshAxisPassedCandidateCount: summaries.filter((candidate) => candidate.freshAxisPassed).length,
    candidateSummaries: summaries
  };
}

function identityPayload(recheck) {
  return {
    schemaVersion: recheck.schemaVersion,
    requiredCorpora: recheck.requiredCorpora,
    inputArtifacts: recheck.inputArtifacts,
    candidates: recheck.candidates,
    summaryMetrics: recheck.summaryMetrics
  };
}

function formatNumber(value) {
  if (value === null || value === undefined) return "n/a";
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) < 1e-9) return "0";
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatGate(value) {
  return value === true ? "pass" : value === false ? "fail" : "n/a";
}

function formatCorpus(report) {
  return [
    `${report.corpus}: mean=${formatNumber(report.meanPopulationDeltaVsBaseline)}`,
    `worst=${formatNumber(report.worstPopulationDeltaVsBaseline)}`,
    `improved=${report.improvedCaseCount}/${report.comparisonCount}`,
    `regressed=${report.regressedCaseCount}`,
    `overrides=${report.rankerOverrideCount}`,
    `finalImproved=${report.overrideFinalImprovedCaseCount}`,
    `finalNeutral=${report.overrideFinalNeutralCaseCount}`,
    `axis=${formatGate(report.axisPassed)}`,
    `ttb=${formatGate(report.timeToBestPromotionGatePassed)}`,
    `medianRatio=${formatNumber(report.medianTimeToBestWallClockRatioVsBaseline)}`,
    `faster10=${report.timeToBestWallClockFaster10PercentCount}`,
    `slower10=${report.timeToBestWallClockSlower10PercentCount}`
  ].join(", ");
}

function formatRecheck(recheck) {
  const lines = [
    "LNS Window-Ranker Promotion Recheck",
    `Generated: ${recheck.generatedAt}`,
    `Decision: ${recheck.decision}`,
    `Summary: ${recheck.summary}`,
    `Candidates: ${recheck.summaryMetrics.candidateCount}`,
    `Promotion-ready candidates: ${recheck.summaryMetrics.promotionReadyCandidateCount}`,
    ""
  ];
  for (const candidate of recheck.summaryMetrics.candidateSummaries) {
    lines.push(
      `${candidate.id} (${candidate.label}): promotionReady=${candidate.promotionReady ? "yes" : "no"}, ` +
        `productAxis=${formatGate(candidate.productAxisPassed)}, productTTB=${formatGate(
          candidate.productTimeToBestPassed
        )}, protectedAxis=${formatGate(candidate.protectedAxisPassed)}, freshAxis=${formatGate(
          candidate.freshAxisPassed
        )}`
    );
    for (const corpus of candidate.corpora) lines.push(`  - ${formatCorpus(corpus)}`);
    lines.push(
      `  blockers: ${candidate.blockers.length > 0 ? candidate.blockers.join(", ") : "none"}`,
      `  diagnostics: ${candidate.diagnostics.length > 0 ? candidate.diagnostics.join(", ") : "none"}`,
      ""
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const options = parseArgs(process.argv.slice(2));
const [benchmarkApi, artifactHelpers] = await Promise.all([loadBenchmarkApi(), loadArtifactBundleHelpers()]);
const artifacts = artifactHelpers.prepareArtifactBundleDirectory(options.artifactDir, "--artifact-dir", {
  force: options.forceArtifactDir
});
const generatedAt = new Date().toISOString();
const command = commandString(artifactHelpers.defaultCliReplayCommand, options);
const candidates = buildCandidates(options, artifactHelpers);
const summaryMetrics = promotionSummary(candidates);
const inputArtifacts = candidates.flatMap((candidate) => candidate.corpora.map((corpus) => corpus.scorecardPath));
const recheckPayload = {
  schemaVersion: 1,
  generatedAt,
  decision: options.decision,
  summary: options.summary,
  requiredCorpora: REQUIRED_CORPORA,
  inputArtifacts,
  candidates,
  summaryMetrics
};
const recheckFingerprint = benchmarkApi.buildModelExperimentFingerprint(identityPayload(recheckPayload));
const recheck = {
  ...recheckPayload,
  recheckFingerprint
};
const artifactPaths = {
  recheckJson: artifacts.artifactPath(RECHECK_FILE),
  recheckText: artifacts.artifactPath(RECHECK_TEXT_FILE),
  telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
  registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
  manifestJson: artifacts.artifactPath("manifest.json")
};
const outputArtifacts = Object.entries(artifactPaths)
  .filter(([name]) => name !== "registryEntryDraftJson")
  .map(([, artifactPath]) => artifactPath);
const model = {
  trained: false,
  diagnosticsOnly: true,
  modelType: "lns-window-ranker-promotion-recheck",
  requiredCorpora: REQUIRED_CORPORA,
  candidateModels: summaryMetrics.candidateSummaries.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    modelFingerprints: candidate.modelFingerprints,
    suppressionModelFingerprints: candidate.suppressionModelFingerprints,
    suppressionMinScoreDeltas: candidate.suppressionMinScoreDeltas
  }))
};
const telemetryManifest = benchmarkApi.buildModelExperimentTelemetryManifest({
  command,
  generatedAt,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  model,
  inputArtifacts,
  outputArtifacts,
  datasetFingerprint: recheckFingerprint,
  metrics: summaryMetrics,
  notes:
    "Diagnostics-only promotion-gate recheck over existing online LNS window-ranker scorecards; no solver default changed."
});
const registryEntryDraft = benchmarkApi.buildModelExperimentRegistryEntryDraft({
  runId: options.runId ?? `lns-window-ranker-promotion-recheck-${recheckFingerprint.slice(-8)}`,
  commands: [command],
  artifactPaths: outputArtifacts,
  generatedAt,
  cases: casesByCorpus(candidates),
  caseFamilies: caseFamilies(candidates),
  seeds: allSeeds(candidates),
  splitStatus: {
    diagnosticsOnly: true,
    source: "existing-online-lns-window-ranker-scorecard-recheck",
    requiredCorpora: REQUIRED_CORPORA,
    leakage: "existing scorecards only; no new solver runs in this summarizer"
  },
  budget: {
    requiredCorpusCount: REQUIRED_CORPORA.length,
    candidateCount: summaryMetrics.candidateCount,
    scorecardCount: summaryMetrics.scorecardCount,
    promotionReadyCandidateCount: summaryMetrics.promotionReadyCandidateCount,
    populationSafeCandidateCount: summaryMetrics.populationSafeCandidateCount,
    finalNeutralCleanCandidateCount: summaryMetrics.finalNeutralCleanCandidateCount,
    productAxisPassedCandidateCount: summaryMetrics.productAxisPassedCandidateCount,
    productTimeToBestPassedCandidateCount: summaryMetrics.productTimeToBestPassedCandidateCount,
    protectedAxisPassedCandidateCount: summaryMetrics.protectedAxisPassedCandidateCount,
    freshAxisPassedCandidateCount: summaryMetrics.freshAxisPassedCandidateCount
  },
  model,
  decision: options.decision,
  summary: options.summary,
  datasetFingerprint: recheckFingerprint,
  summaryMetrics
});
const manifest = {
  artifactDir: artifacts.artifactDir,
  artifactPaths,
  command,
  generatedAt,
  inputArtifacts,
  recheckFingerprint,
  generator: {
    script: SCRIPT_PATH,
    requiresBuild: true,
    command
  }
};

artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath(RECHECK_FILE), recheck, {
  force: options.forceArtifactDir
});
artifactHelpers.writeTextArtifact(artifacts.absoluteArtifactPath(RECHECK_TEXT_FILE), formatRecheck(recheck), {
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

console.log(`Wrote LNS window-ranker promotion recheck to ${artifacts.artifactDir}`);
