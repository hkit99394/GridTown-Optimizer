#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCRIPT_PATH = "scripts/generate-service-braid-replay-artifacts.mjs";
const BASE_CASE_NAME = "lns-holdout-service-braid-pressure";
const SERVICE_TYPE_INDEX = 1;

const COMMON_WIDE_OPTIONS = Object.freeze({
  stateCollectionIterations: 4,
  stateCollectionRepairTimeLimitSeconds: 0.2,
  maxWindows: 16,
  explorationWindowCount: 8,
  repairTimeLimitSeconds: 0.2,
  rollForwardIterations: 4,
  rollForwardRepairTimeLimitSeconds: 0.2
});

const COMPACT_SCREEN_OPTIONS = Object.freeze({
  stateCollectionIterations: 4,
  stateCollectionRepairTimeLimitSeconds: 0.1,
  maxWindows: 8,
  explorationWindowCount: 4,
  repairTimeLimitSeconds: 0.1,
  rollForwardIterations: 2,
  rollForwardRepairTimeLimitSeconds: 0.1
});

const SERVICE_BRAID_BASE_GRID = Object.freeze([
  Object.freeze([1, 1, 1, 1, 1, 1, 1]),
  Object.freeze([1, 1, 1, 0, 1, 1, 1]),
  Object.freeze([1, 1, 1, 1, 1, 1, 1]),
  Object.freeze([1, 0, 1, 1, 1, 0, 1]),
  Object.freeze([1, 1, 1, 1, 1, 1, 1]),
  Object.freeze([1, 1, 0, 1, 1, 1, 1])
]);

const SERVICE_BRAID_BASE_BLOCKERS = Object.freeze([
  ...SERVICE_BRAID_BASE_GRID.flatMap((row, r) =>
    row.flatMap((value, c) => (value === 0 ? [Object.freeze({ r, c })] : []))
  )
]);

function generatedGrid(rows, cols, blockers) {
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1));
  for (const { r, c } of blockers) {
    if (!grid[r] || grid[r][c] === undefined) {
      throw new Error(`Generated blocker is out of bounds: r=${r}, c=${c}, rows=${rows}, cols=${cols}`);
    }
    grid[r][c] = 0;
  }
  return grid;
}

function embeddedServiceBraidGrid({ rows, cols, top = 0, left = 0, mirrorColumns = false }) {
  const baseCols = SERVICE_BRAID_BASE_GRID[0].length;
  return generatedGrid(
    rows,
    cols,
    SERVICE_BRAID_BASE_BLOCKERS.map(({ r, c }) => ({
      r: top + r,
      c: left + (mirrorColumns ? baseCols - 1 - c : c)
    }))
  );
}

function generatedServiceBraidFamilyMutations() {
  return [
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-origin-screen-candidate",
      description: "Generated service-braid family candidate embedding the base blocker pattern in a 7x8 board.",
      generatedGridFamily: "base-blocker-embed",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-down-screen-candidate",
      description: "Generated service-braid family candidate shifting the base blocker pattern down in a 7x8 board.",
      generatedGridFamily: "base-blocker-embed",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, top: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-screen-candidate",
      description: "Generated service-braid family candidate shifting the base blocker pattern right in a 7x8 board.",
      generatedGridFamily: "base-blocker-embed",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-mirror-screen-candidate",
      description: "Generated service-braid family candidate mirroring the base blocker pattern in a 7x8 board.",
      generatedGridFamily: "base-blocker-embed",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1, mirrorColumns: true })
    }
  ];
}

const BUNDLES = Object.freeze({
  "service-braid-range1-big-service120": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-09/protected-service-braid-range1-big-service120-candidate-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-range1-big-service120-candidate",
    description:
      "Protected service-braid construction probe with the large service constrained to range 1 and bonus 120.",
    mutation: { serviceTypeIndex: SERVICE_TYPE_INDEX, range: 1, bonus: 120 },
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-first-improvement", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "byState"
  },
  "service-braid-range1-big-service135": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-09/protected-service-braid-range1-big-service135-candidate-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-range1-big-service135-candidate",
    description:
      "Protected service-braid construction probe with the large service constrained to range 1 and bonus 135.",
    mutation: { serviceTypeIndex: SERVICE_TYPE_INDEX, range: 1, bonus: 135 },
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-first-improvement", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "byState"
  },
  "service-braid-range1-big-service140": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-09/protected-service-braid-range1-big-service140-candidate-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-range1-big-service140-candidate",
    description:
      "Protected service-braid construction probe with the large service constrained to range 1 and bonus 140.",
    mutation: { serviceTypeIndex: SERVICE_TYPE_INDEX, range: 1, bonus: 140 },
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-first-improvement", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "byState"
  },
  "service-braid-range1-big-service140-initial-stagnation-repeatability": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-range1-big-service140-initial-stagnation-repeatability-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-range1-big-service140-initial-stagnation-candidate",
    description:
      "Protected service-braid repeatability probe with the large service constrained to range 1 and bonus 140, limited to initial-incumbent and post-stagnation states.",
    mutation: { serviceTypeIndex: SERVICE_TYPE_INDEX, range: 1, bonus: 140 },
    options: {
      seeds: [5, 7, 11, 13, 17, 19, 23, 29, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "bySeed",
    selectivitySummary: true
  },
  "service-braid-range1-big-service138-142-initial-stagnation-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-range1-big-service138-142-initial-stagnation-screen-roll-forward-2x0.1",
    caseNamePrefix: "lns-holdout-service-braid-range1-big-service",
    description:
      "Protected service-braid compact bonus sweep with the large service constrained to range 1, limited to initial-incumbent and post-stagnation states.",
    mutations: [138, 140, 142].map((bonus) => ({
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 1,
      bonus
    })),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid compact bonus sweep selectivity summary"
  },
  "service-braid-range2-big-service120-160-initial-stagnation-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-range2-big-service120-160-initial-stagnation-screen-roll-forward-2x0.1",
    caseNamePrefix: "lns-holdout-service-braid-range2-big-service",
    description:
      "Protected service-braid compact bonus sweep with the large service kept at range 2, limited to initial-incumbent and post-stagnation states.",
    mutations: [120, 140, 160].map((bonus) => ({
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 2,
      bonus
    })),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid range2 compact bonus sweep selectivity summary"
  },
  "service-braid-residential-headroom-initial-stagnation-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-residential-headroom-initial-stagnation-screen-roll-forward-2x0.1",
    description:
      "Protected service-braid compact residential-headroom sweep with the original service ranges, limited to initial-incumbent and post-stagnation states.",
    mutations: [
      {
        caseName: "lns-holdout-service-braid-res-headroom-plus20-screen-candidate",
        description: "Protected service-braid candidate with residential max values raised by about 20%.",
        residentialTypeMutations: [
          { typeIndex: 0, max: 290 },
          { typeIndex: 1, max: 480 }
        ]
      },
      {
        caseName: "lns-holdout-service-braid-res-headroom-plus40-screen-candidate",
        description: "Protected service-braid candidate with residential max values raised by about 40%.",
        residentialTypeMutations: [
          { typeIndex: 0, max: 335 },
          { typeIndex: 1, max: 560 }
        ]
      },
      {
        caseName: "lns-holdout-service-braid-premium-scarcity-screen-candidate",
        description: "Protected service-braid candidate with higher premium residential max and scarcity pressure.",
        residentialTypeMutations: [
          { typeIndex: 0, max: 260 },
          { typeIndex: 1, min: 220, max: 560 }
        ]
      }
    ],
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid residential headroom compact sweep selectivity summary"
  },
  "service-braid-geometry-initial-stagnation-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-geometry-initial-stagnation-screen-roll-forward-2x0.1",
    description:
      "Protected service-braid compact geometry sweep with original service and residential values, limited to initial-incumbent and post-stagnation states.",
    mutations: [
      {
        caseName: "lns-holdout-service-braid-open-upper-braid-screen-candidate",
        description: "Protected service-braid candidate that opens the upper central braid blocker.",
        gridCellMutations: [{ r: 1, c: 3, value: 1 }]
      },
      {
        caseName: "lns-holdout-service-braid-open-lower-notch-screen-candidate",
        description: "Protected service-braid candidate that opens the lower-left notch blocker.",
        gridCellMutations: [{ r: 5, c: 2, value: 1 }]
      },
      {
        caseName: "lns-holdout-service-braid-shift-right-choke-screen-candidate",
        description: "Protected service-braid candidate that shifts the right-side choke one cell inward.",
        gridCellMutations: [
          { r: 3, c: 5, value: 1 },
          { r: 3, c: 4, value: 0 }
        ]
      }
    ],
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid geometry compact sweep selectivity summary"
  },
  "service-braid-range1-big-service140-structural-geometry-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-range1-big-service140-structural-geometry-screen-roll-forward-2x0.1",
    description:
      "Protected service-braid compact structural geometry sweep with the large service constrained to range 1 and bonus 140, limited to initial-incumbent and post-stagnation states.",
    mutations: [
      {
        caseName: "lns-holdout-service-braid-range1-big-service140-south-shelf-screen-candidate",
        description: "Protected service-braid range1/bonus140 candidate with an added southern shelf row.",
        serviceTypeIndex: SERVICE_TYPE_INDEX,
        range: 1,
        bonus: 140,
        gridOverride: [
          [1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 0, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1],
          [1, 0, 1, 1, 1, 0, 1],
          [1, 1, 1, 1, 1, 1, 1],
          [1, 1, 0, 1, 1, 1, 1],
          [1, 1, 1, 0, 1, 1, 1]
        ]
      },
      {
        caseName: "lns-holdout-service-braid-range1-big-service140-east-lane-screen-candidate",
        description: "Protected service-braid range1/bonus140 candidate with an added eastern lane.",
        serviceTypeIndex: SERVICE_TYPE_INDEX,
        range: 1,
        bonus: 140,
        gridOverride: [
          [1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 0, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1],
          [1, 0, 1, 1, 1, 0, 1, 1],
          [1, 1, 1, 1, 1, 1, 1, 1],
          [1, 1, 0, 1, 1, 1, 1, 1]
        ]
      },
      {
        caseName: "lns-holdout-service-braid-range1-big-service140-double-choke-screen-candidate",
        description: "Protected service-braid range1/bonus140 candidate with a stronger central double choke.",
        serviceTypeIndex: SERVICE_TYPE_INDEX,
        range: 1,
        bonus: 140,
        gridOverride: [
          [1, 1, 1, 1, 1, 1, 1],
          [1, 1, 1, 0, 1, 1, 1],
          [1, 1, 1, 0, 1, 1, 1],
          [1, 0, 1, 1, 1, 0, 1],
          [1, 1, 1, 0, 1, 1, 1],
          [1, 1, 0, 1, 1, 1, 1]
        ]
      }
    ],
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid range1/bonus140 structural geometry compact sweep selectivity summary"
  },
  "service-braid-range1-big-service140-south-shelf-repeatability": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-range1-big-service140-south-shelf-repeatability-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-range1-big-service140-south-shelf-repeatability-candidate",
    description:
      "Protected service-braid repeatability probe with the large service constrained to range 1 and bonus 140 on the added-southern-shelf structural geometry.",
    mutation: {
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 1,
      bonus: 140,
      gridOverride: [
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 0, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [1, 0, 1, 1, 1, 0, 1],
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 0, 1, 1, 1, 1],
        [1, 1, 1, 0, 1, 1, 1]
      ]
    },
    options: {
      seeds: [5, 7, 11, 13, 17, 19, 23, 29, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "bySeed",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid range1/bonus140 south-shelf repeatability selectivity summary"
  },
  "service-braid-generated-grid-family-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-generated-grid-family-screen-roll-forward-2x0.1",
    description:
      "Protected service-braid compact generated-grid family screen with original service and residential values, limited to initial-incumbent and post-stagnation states.",
    mutations: generatedServiceBraidFamilyMutations(),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid generated-grid family compact sweep selectivity summary"
  },
  "service-braid-generated-grid-family-right-repeatability": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-generated-grid-family-right-repeatability-wide-state-search-roll-forward-4x0.2",
    caseName: "lns-holdout-service-braid-family-embed-7x8-right-repeatability-candidate",
    description:
      "Protected service-braid generated-grid repeatability probe for the right-shifted 7x8 embedded blocker pattern with original service and residential values.",
    mutation: {
      generatedGridFamily: "base-blocker-embed",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 })
    },
    options: {
      seeds: [5, 7, 11, 13, 17, 19, 23, 29, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMMON_WIDE_OPTIONS
    },
    candidateSummaryMode: "bySeed",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid generated-grid right-shift repeatability selectivity summary"
  }
});

function usage() {
  const names = Object.keys(BUNDLES)
    .map((name) => `  - ${name}`)
    .join("\n");
  return [
    "Usage: node scripts/generate-service-braid-replay-artifacts.mjs --bundle=<name> [--force-artifact-dir]",
    "",
    "Regenerates custom protected service-braid LNS replay-label artifacts from built dist/ modules.",
    "Run npm run build first when dist/ is stale or absent.",
    "",
    "Bundles:",
    names
  ].join("\n");
}

function parseArgs(argv) {
  let bundleName;
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
    if (arg.startsWith("--bundle=")) {
      bundleName = arg.slice("--bundle=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!bundleName) throw new Error("--bundle=<name> is required.");
  const bundle = BUNDLES[bundleName];
  if (!bundle) throw new Error(`Unknown bundle '${bundleName}'.\n\n${usage()}`);
  return { bundleName, bundle, forceArtifactDir };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateGridOverride(caseName, grid) {
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) {
    throw new Error(`Grid override for ${caseName} must be a non-empty rectangular grid.`);
  }
  const width = grid[0].length;
  for (const [r, row] of grid.entries()) {
    if (!Array.isArray(row) || row.length !== width) {
      throw new Error(`Grid override for ${caseName} must be rectangular; row ${r} is invalid.`);
    }
    for (const [c, value] of row.entries()) {
      if (value !== 0 && value !== 1) {
        throw new Error(`Grid override for ${caseName} must contain only 0/1 cells: r=${r}, c=${c}`);
      }
    }
  }
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
    "Missing dist/benchmarkApi.js. Run npm run build before regenerating service-braid artifacts."
  );
}

function loadArtifactBundleHelpers() {
  return loadDistModule(
    ["dist", "tools", "cli", "artifactBundleHelpers.js"],
    "Missing dist/tools/cli/artifactBundleHelpers.js. Run npm run build before regenerating service-braid artifacts."
  );
}

function loadLnsWindowReplayArtifactBundle() {
  return loadDistModule(
    ["dist", "tools", "cli", "lnsWindowReplayArtifactBundle.js"],
    "Missing dist/tools/cli/lnsWindowReplayArtifactBundle.js. Run npm run build before regenerating service-braid artifacts."
  );
}

function candidateDefinitions(bundle) {
  if (Array.isArray(bundle.mutations)) {
    return bundle.mutations.map((mutation) => ({
      caseName:
        mutation.caseName ??
        `${bundle.caseNamePrefix}${mutation.bonus}${bundle.caseNameSuffix ?? "-initial-stagnation-screen-candidate"}`,
      description:
        mutation.description ?? `${bundle.description} Candidate bonus=${mutation.bonus}, range=${mutation.range}.`,
      mutation
    }));
  }
  return [
    {
      caseName: bundle.caseName,
      description: bundle.description,
      mutation: bundle.mutation
    }
  ];
}

function buildCandidateCase(baseCase, definition) {
  const candidate = clone(baseCase);
  candidate.name = definition.caseName;
  candidate.description = definition.description;
  if (Array.isArray(definition.mutation.gridOverride)) {
    validateGridOverride(definition.caseName, definition.mutation.gridOverride);
    candidate.grid = clone(definition.mutation.gridOverride);
  }
  if (Array.isArray(definition.mutation.gridCellMutations)) {
    for (const { r, c, value } of definition.mutation.gridCellMutations) {
      if (!candidate.grid[r] || candidate.grid[r][c] === undefined) {
        throw new Error(`Grid mutation for ${definition.caseName} is out of bounds: r=${r}, c=${c}`);
      }
      if (value !== 0 && value !== 1) {
        throw new Error(`Grid mutation for ${definition.caseName} must set value 0 or 1: r=${r}, c=${c}`);
      }
      candidate.grid[r][c] = value;
    }
  }
  if (definition.mutation.serviceTypeIndex !== undefined) {
    candidate.params.serviceTypes = candidate.params.serviceTypes.map((serviceType, index) =>
      index === definition.mutation.serviceTypeIndex
        ? {
            ...serviceType,
            ...(definition.mutation.range === undefined ? {} : { range: definition.mutation.range }),
            ...(definition.mutation.bonus === undefined ? {} : { bonus: definition.mutation.bonus })
          }
        : serviceType
    );
  }
  if (Array.isArray(definition.mutation.residentialTypeMutations)) {
    candidate.params.residentialTypes = candidate.params.residentialTypes.map((residentialType, index) => {
      const mutation = definition.mutation.residentialTypeMutations.find((entry) => entry.typeIndex === index);
      if (!mutation) return residentialType;
      const { typeIndex: _typeIndex, ...fields } = mutation;
      return { ...residentialType, ...fields };
    });
  }
  return candidate;
}

function artifactPathsFor(artifacts, includeSelectivitySummary) {
  return {
    replayJson: artifacts.artifactPath("lns-window-replay-labels.json"),
    replayText: artifacts.artifactPath("lns-window-replay-labels.txt"),
    repeatabilitySummaryJson: artifacts.artifactPath("repeatability-summary.json"),
    candidateSummaryJson: artifacts.artifactPath("candidate-summary.json"),
    ...(includeSelectivitySummary
      ? {
          selectivitySummaryJson: artifacts.artifactPath("selectivity-summary.json"),
          selectivitySummaryText: artifacts.artifactPath("selectivity-summary.txt")
        }
      : {}),
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

function replayCommand(defaultCliReplayCommand, bundleName, forceArtifactDir) {
  const argv = [`--bundle=${bundleName}`];
  if (forceArtifactDir) argv.push("--force-artifact-dir");
  return defaultCliReplayCommand(SCRIPT_PATH, argv);
}

function statusFromLabel(label) {
  return label.rollForward?.statusVsBaseline ?? "unknown";
}

function finalDeltaFromLabel(label) {
  return label.rollForward?.populationDeltaVsBaseline ?? 0;
}

function emptyCounts() {
  return { pos: 0, neg: 0, neu: 0 };
}

function addLabelCounts(counts, label) {
  const status = statusFromLabel(label);
  if (status === "improved") counts.pos += 1;
  else if (status === "regressed") counts.neg += 1;
  else counts.neu += 1;
}

function summarizeLabelSet(labels) {
  const counts = emptyCounts();
  let best = null;
  let worst = null;
  for (const label of labels) {
    addLabelCounts(counts, label);
    const delta = finalDeltaFromLabel(label);
    best = best === null ? delta : Math.max(best, delta);
    worst = worst === null ? delta : Math.min(worst, delta);
  }
  return { ...counts, best: best ?? 0, worst: worst ?? 0 };
}

function baselineFinalPopulation(caseResult) {
  const baseline = caseResult.labels.find((label) => label.selectedByBaseline && label.rollForward);
  return baseline?.rollForward?.totalPopulation ?? null;
}

function stateSummary(caseResult) {
  const summary = summarizeLabelSet(caseResult.labels);
  return {
    seed: caseResult.seed,
    statePolicy: caseResult.statePolicy,
    stateIndex: caseResult.stateIndex,
    stateSourceStatus: caseResult.stateSourceStatus,
    incumbentPopulation: caseResult.incumbentPopulation,
    baseline: caseResult.baselineSelectedWindow,
    pos: summary.pos,
    neg: summary.neg,
    neu: summary.neu,
    best: summary.best,
    worst: summary.worst,
    baselineFinal: baselineFinalPopulation(caseResult)
  };
}

function buildCandidateSummary(result, artifactDir, repeatabilitySummary, mode, definitions = []) {
  const labels = result.cases.flatMap((caseResult) => caseResult.labels);
  const summary = summarizeLabelSet(labels);
  const common = {
    outDir: artifactDir,
    labels: result.labelCount,
    states: result.stateCount,
    pos: summary.pos,
    neg: summary.neg,
    neu: summary.neu,
    immPos: labels.filter((label) => label.improvement > 0).length,
    best: summary.best,
    worst: summary.worst,
    repeatabilitySummary
  };

  const nonNeutralStates = result.cases.map(stateSummary).filter((state) => state.pos > 0 || state.neg > 0);

  if (mode === "bySeed") {
    const bySeed = {};
    for (const caseResult of result.cases) {
      const seedKey = String(caseResult.seed);
      bySeed[seedKey] ??= { pos: 0, neg: 0, neu: 0, best: null, worst: null, states: 0 };
      const state = stateSummary(caseResult);
      bySeed[seedKey].pos += state.pos;
      bySeed[seedKey].neg += state.neg;
      bySeed[seedKey].neu += state.neu;
      bySeed[seedKey].best = bySeed[seedKey].best === null ? state.best : Math.max(bySeed[seedKey].best, state.best);
      bySeed[seedKey].worst =
        bySeed[seedKey].worst === null ? state.worst : Math.min(bySeed[seedKey].worst, state.worst);
      bySeed[seedKey].states += 1;
    }
    for (const seedSummary of Object.values(bySeed)) {
      seedSummary.best ??= 0;
      seedSummary.worst ??= 0;
    }
    return { ...common, bySeed, nonNeutralStates };
  }

  if (mode === "byCase") {
    const definitionByCase = new Map(definitions.map((definition) => [definition.caseName, definition]));
    const byCase = {};
    for (const caseResult of result.cases) {
      const caseKey = caseResult.name;
      byCase[caseKey] ??= {
        mutation: definitionByCase.get(caseKey)?.mutation ?? null,
        pos: 0,
        neg: 0,
        neu: 0,
        immPos: 0,
        best: null,
        worst: null,
        states: 0,
        nonNeutralStates: []
      };
      const state = stateSummary(caseResult);
      byCase[caseKey].pos += state.pos;
      byCase[caseKey].neg += state.neg;
      byCase[caseKey].neu += state.neu;
      byCase[caseKey].immPos += caseResult.labels.filter((label) => label.improvement > 0).length;
      byCase[caseKey].best = byCase[caseKey].best === null ? state.best : Math.max(byCase[caseKey].best, state.best);
      byCase[caseKey].worst =
        byCase[caseKey].worst === null ? state.worst : Math.min(byCase[caseKey].worst, state.worst);
      byCase[caseKey].states += 1;
      if (state.pos > 0 || state.neg > 0) byCase[caseKey].nonNeutralStates.push(state);
    }
    for (const caseSummary of Object.values(byCase)) {
      caseSummary.best ??= 0;
      caseSummary.worst ??= 0;
    }
    return { ...common, byCase };
  }

  return { ...common, byState: nonNeutralStates };
}

function gateExample(caseResult, label) {
  return {
    seed: label.seed,
    state: `${caseResult.statePolicy}#${caseResult.stateIndex}`,
    operator: label.operator,
    window: label.window,
    delta: finalDeltaFromLabel(label),
    area: label.features.area,
    componentsAfter: label.features.fragmentation.emptyComponentCountAfterClearingWindow,
    newReach: label.features.connectivityShadow.newlyReachableEmptyCellsIfCleared,
    source: label.selectionSource
  };
}

function buildGateSummary(result, predicate) {
  const labels = [];
  for (const caseResult of result.cases) {
    for (const label of caseResult.labels) {
      if (predicate(label)) labels.push({ caseResult, label });
    }
  }

  const counts = summarizeLabelSet(labels.map(({ label }) => label));
  const bySeed = {};
  const byCase = {};
  for (const { label } of labels) {
    const seedKey = String(label.seed);
    bySeed[seedKey] ??= emptyCounts();
    addLabelCounts(bySeed[seedKey], label);
    const caseKey = label.caseName ?? "unknown";
    byCase[caseKey] ??= emptyCounts();
    addLabelCounts(byCase[caseKey], label);
  }

  return {
    selected: labels.length,
    pos: counts.pos,
    neg: counts.neg,
    neu: counts.neu,
    best: counts.best,
    worst: counts.worst,
    bySeed,
    byCase,
    examples: labels
      .filter(({ label }) => statusFromLabel(label) !== "neutral")
      .slice(0, 10)
      .map(({ caseResult, label }) => gateExample(caseResult, label))
  };
}

function buildSelectivitySummary(result, artifactDir, title) {
  const sliding = (label) => label.operator === "sliding" && !label.selectedByBaseline;
  const componentsMax2 = (label) => label.features.fragmentation.emptyComponentCountAfterClearingWindow <= 2;
  const gates = {
    slidingArea12: (label) => sliding(label) && label.features.area === 12,
    slidingArea12ComponentsMax2: (label) => sliding(label) && label.features.area === 12 && componentsMax2(label),
    slidingComponentsMax2: (label) => sliding(label) && componentsMax2(label),
    slidingTopOrLeft2: (label) =>
      sliding(label) && (label.window.top === 0 || (label.window.top === 2 && label.window.left === 1)),
    allNonBaselineSliding: sliding
  };

  return {
    generatedAt: new Date().toISOString(),
    title,
    sourceArtifact: artifactDir,
    totalLabels: result.labelCount,
    gates: Object.fromEntries(
      Object.entries(gates).map(([name, predicate]) => [name, buildGateSummary(result, predicate)])
    )
  };
}

function formatSelectivitySummary(summary) {
  return [
    summary.title ?? "Service-braid selectivity summary",
    `generatedAt=${summary.generatedAt}`,
    `source=${summary.sourceArtifact}`,
    `totalLabels=${summary.totalLabels}`,
    "",
    ...Object.entries(summary.gates).map(
      ([name, gate]) =>
        `${name}: selected=${gate.selected} pos=${gate.pos} neg=${gate.neg} neu=${gate.neu} best=${gate.best} worst=${gate.worst}`
    )
  ].join("\n");
}

const { bundleName, bundle, forceArtifactDir } = parseArgs(process.argv.slice(2));
const artifactHelpers = await loadArtifactBundleHelpers();
const artifacts = artifactHelpers.prepareArtifactBundleDirectory(bundle.artifactDir, "--artifact-dir", {
  force: forceArtifactDir
});
const benchmarkApi = await loadBenchmarkApi();
const replayArtifactBundle = await loadLnsWindowReplayArtifactBundle();
const baseCase = benchmarkApi.DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS.find(
  (benchmarkCase) => benchmarkCase.name === BASE_CASE_NAME
);
if (!baseCase) throw new Error(`Missing protected holdout base case: ${BASE_CASE_NAME}`);

const definitions = candidateDefinitions(bundle);
const candidateCases = definitions.map((definition) => buildCandidateCase(baseCase, definition));
const result = benchmarkApi.runLnsWindowReplayLabels(candidateCases, {
  names: candidateCases.map((candidateCase) => candidateCase.name),
  ...bundle.options
});
const repeatabilitySummary = benchmarkApi.summarizeLnsWindowReplayRepeatability(result);
const artifactDir = artifacts.artifactDir;
const artifactPaths = artifactPathsFor(artifacts, Boolean(bundle.selectivitySummary));
const command = replayCommand(artifactHelpers.defaultCliReplayCommand, bundleName, forceArtifactDir);
const registryArtifactPaths = diagnosticArtifactPaths(artifactPaths);
const telemetryManifest = replayArtifactBundle.buildLnsWindowReplayTelemetryManifest(result, {
  command,
  git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
  hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
  outputArtifacts: registryArtifactPaths,
  notes: `Service-braid diagnostics generated by ${SCRIPT_PATH} bundle ${bundleName}.`
});
const registryEntryDraft = replayArtifactBundle.buildLnsWindowReplayRegistryEntryDraft(result, {
  runId: `service-braid-${bundleName}`,
  commands: [command],
  artifactPaths: registryArtifactPaths,
  decision: "diagnostics-only",
  summary: "Protected service-braid LNS replay diagnostic label bundle; no solver default changed."
});

const manifest = {
  artifactDir,
  artifactPaths,
  command,
  generatedAt: result.generatedAt,
  inputFingerprint: telemetryManifest.inputFingerprint,
  labelFingerprint: telemetryManifest.labelFingerprint,
  caseCount: result.caseCount,
  seedCount: result.seedCount,
  stateCount: result.stateCount,
  labelCount: result.labelCount,
  rollForwardLabelCount: result.rollForwardLabelCount,
  selectedCaseNames: [...result.selectedCaseNames],
  pressureFamilies: [...result.pressureFamilies],
  options: clone(bundle.options),
  candidateMutation: {
    baseCase: BASE_CASE_NAME,
    ...(definitions.length === 1
      ? clone(definitions[0].mutation)
      : {
          mutations: definitions.map((definition) => ({
            caseName: definition.caseName,
            ...clone(definition.mutation)
          }))
        }),
    ...(bundle.options.statePolicies.length === 2 ? { stateGate: bundle.options.statePolicies.join(",") } : {})
  },
  generator: {
    script: SCRIPT_PATH,
    bundle: bundleName,
    requiresBuild: true,
    baseCorpus: "DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS",
    baseCase: BASE_CASE_NAME,
    candidateCases: candidateCases.map((candidateCase) => candidateCase.name),
    command
  },
  repeatabilitySummary
};

artifactHelpers.writeJsonArtifact(
  artifacts.absoluteArtifactPath("lns-window-replay-labels.json"),
  benchmarkApi.createLnsWindowReplaySnapshot(result),
  {
    force: forceArtifactDir
  }
);
artifactHelpers.writeTextArtifact(
  artifacts.absoluteArtifactPath("lns-window-replay-labels.txt"),
  `${benchmarkApi.formatLnsWindowReplayLabels(result)}\n`,
  { force: forceArtifactDir }
);
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("repeatability-summary.json"), repeatabilitySummary, {
  force: forceArtifactDir
});
artifactHelpers.writeJsonArtifact(
  artifacts.absoluteArtifactPath("candidate-summary.json"),
  buildCandidateSummary(result, artifactDir, repeatabilitySummary, bundle.candidateSummaryMode, definitions),
  { force: forceArtifactDir }
);
if (bundle.selectivitySummary) {
  const selectivitySummary = buildSelectivitySummary(
    result,
    artifactDir,
    bundle.selectivitySummaryTitle ?? "Service-braid bonus140 initial/stagnation selectivity summary"
  );
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("selectivity-summary.json"), selectivitySummary, {
    force: forceArtifactDir
  });
  artifactHelpers.writeTextArtifact(
    artifacts.absoluteArtifactPath("selectivity-summary.txt"),
    `${formatSelectivitySummary(selectivitySummary)}\n`,
    { force: forceArtifactDir }
  );
}
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
  force: forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
  force: forceArtifactDir
});
artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, {
  force: forceArtifactDir
});

console.log(`Regenerated ${bundleName} at ${artifactDir}`);
