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

const DEFAULT_ONLINE_LNS_OPTIONS = Object.freeze({
  iterations: 1,
  maxNoImprovementIterations: 4,
  neighborhoodRows: 3,
  neighborhoodCols: 3,
  repairTimeLimitSeconds: 0.5
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

function generatedServiceBraidRightNeighborhoodMutations() {
  return [
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-neighborhood-anchor-candidate",
      description: "Generated service-braid right-shift anchor candidate from the prior repeatability hit.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-8x8-down-right-neighborhood-candidate",
      description:
        "Generated service-braid candidate shifting the base blocker pattern down and right in an 8x8 board.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 8, cols: 8, top: 1, left: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x9-wide-right-neighborhood-candidate",
      description: "Generated service-braid right-shift candidate with an extra eastern lane.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 9, left: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-open-upper-neighborhood-candidate",
      description: "Generated service-braid right-shift candidate opening the upper central braid blocker.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 }),
      gridCellMutations: [{ r: 1, c: 4, value: 1 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-open-lower-neighborhood-candidate",
      description: "Generated service-braid right-shift candidate opening the lower-left notch blocker.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 }),
      gridCellMutations: [{ r: 5, c: 3, value: 1 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-choke-inward-neighborhood-candidate",
      description: "Generated service-braid right-shift candidate moving the right-side choke one cell inward.",
      generatedGridFamily: "base-blocker-embed-right-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 }),
      gridCellMutations: [
        { r: 3, c: 6, value: 1 },
        { r: 3, c: 5, value: 0 }
      ]
    }
  ];
}

function generatedServiceBraidRightValueNeighborhoodMutations() {
  const rightAnchorGrid = embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 });
  return [
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-big-service85-value-candidate",
      description: "Generated service-braid right-shift candidate with the large service bonus reduced to 85.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      bonus: 85
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-big-service105-value-candidate",
      description: "Generated service-braid right-shift candidate with the large service bonus raised to 105.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      bonus: 105
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-big-service120-value-candidate",
      description: "Generated service-braid right-shift candidate with the large service bonus raised to 120.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      bonus: 120
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-range1-big-service95-value-candidate",
      description: "Generated service-braid right-shift candidate with the large service range constrained to 1.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 1,
      bonus: 95
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-range1-big-service120-value-candidate",
      description:
        "Generated service-braid right-shift candidate with the large service range constrained to 1 and bonus raised to 120.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 1,
      bonus: 120
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-range3-big-service95-value-candidate",
      description: "Generated service-braid right-shift candidate with the large service range expanded to 3.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      range: 3,
      bonus: 95
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-res-headroom-plus20-value-candidate",
      description: "Generated service-braid right-shift candidate with residential max values raised by about 20%.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      residentialTypeMutations: [
        { typeIndex: 0, max: 290 },
        { typeIndex: 1, max: 480 }
      ]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-premium-scarcity-value-candidate",
      description:
        "Generated service-braid right-shift candidate with higher premium residential max and scarcity pressure.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: rightAnchorGrid,
      residentialTypeMutations: [
        { typeIndex: 0, max: 260 },
        { typeIndex: 1, min: 220, max: 560 }
      ]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-8x8-down-right-big-service105-value-candidate",
      description: "Generated down-right service-braid neighbor with the large service bonus raised to 105.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 8, cols: 8, top: 1, left: 1 }),
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      bonus: 105
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x9-wide-right-big-service85-value-candidate",
      description: "Generated wide right service-braid neighbor with the large service bonus reduced to 85.",
      generatedGridFamily: "base-blocker-embed-right-value-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 9, left: 1 }),
      serviceTypeIndex: SERVICE_TYPE_INDEX,
      bonus: 85
    }
  ];
}

function generatedServiceBraidRightGeometryNeighborhoodMutations() {
  const rightAnchorGrid = embeddedServiceBraidGrid({ rows: 7, cols: 8, left: 1 });
  return [
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-upper-cap-geometry-candidate",
      description: "Generated right-shift service-braid candidate adding an upper cap blocker near the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 0, c: 4, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-upper-left-cap-geometry-candidate",
      description:
        "Generated right-shift service-braid candidate adding an upper-left cap blocker near the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 0, c: 2, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-central-double-geometry-candidate",
      description: "Generated right-shift service-braid candidate doubling the upper central choke.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 2, c: 4, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-left-double-geometry-candidate",
      description:
        "Generated right-shift service-braid candidate doubling the left-side choke inside the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 2, c: 2, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-outer-upper-choke-geometry-candidate",
      description:
        "Generated right-shift service-braid candidate adding an outer upper choke east of the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 2, c: 6, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-outer-lower-choke-geometry-candidate",
      description:
        "Generated right-shift service-braid candidate adding an outer lower choke east of the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [{ r: 4, c: 6, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-window-pair-geometry-candidate",
      description: "Generated right-shift service-braid candidate adding paired blockers around the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [
        { r: 0, c: 4, value: 0 },
        { r: 2, c: 2, value: 0 }
      ]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x8-right-outer-pair-geometry-candidate",
      description: "Generated right-shift service-braid candidate adding paired blockers on the eastern braid.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: rightAnchorGrid,
      gridCellMutations: [
        { r: 2, c: 6, value: 0 },
        { r: 4, c: 6, value: 0 }
      ]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-8x8-right-bottom-shelf-geometry-candidate",
      description:
        "Generated right-shift service-braid candidate adding a southern shelf row and lower central blocker.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 8, cols: 8, left: 1 }),
      gridCellMutations: [{ r: 7, c: 4, value: 0 }]
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-8x8-right-bottom-open-shelf-geometry-candidate",
      description: "Generated right-shift service-braid candidate adding a southern open shelf row.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 8, cols: 8, left: 1 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x9-right-west-lane-geometry-candidate",
      description: "Generated service-braid candidate shifting the anchor one more cell right to add a western lane.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 9, left: 2 })
    },
    {
      caseName: "lns-holdout-service-braid-family-embed-7x9-right-west-lane-upper-cap-geometry-candidate",
      description: "Generated west-lane service-braid candidate with an upper cap blocker near the useful window.",
      generatedGridFamily: "base-blocker-embed-right-geometry-neighborhood",
      gridOverride: embeddedServiceBraidGrid({ rows: 7, cols: 9, left: 2 }),
      gridCellMutations: [{ r: 0, c: 5, value: 0 }]
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
  },
  "service-braid-generated-grid-right-neighborhood-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-generated-grid-right-neighborhood-screen-roll-forward-2x0.1",
    description:
      "Protected service-braid compact generated-grid right-neighborhood screen around the right-shift family hit.",
    mutations: generatedServiceBraidRightNeighborhoodMutations(),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid generated-grid right-neighborhood compact screen selectivity summary"
  },
  "service-braid-generated-grid-right-value-neighborhood-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-generated-grid-right-value-neighborhood-screen-roll-forward-2x0.1",
    description: "Protected service-braid compact generated-grid value/range screen around the right-shift family hit.",
    mutations: generatedServiceBraidRightValueNeighborhoodMutations(),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle: "Service-braid generated-grid right value-neighborhood compact screen selectivity summary"
  },
  "service-braid-generated-grid-right-geometry-neighborhood-screen": {
    artifactDir:
      "artifacts/lns-window-replay-labels/2026-05-10/protected-service-braid-generated-grid-right-geometry-neighborhood-screen-roll-forward-2x0.1",
    description: "Protected service-braid compact generated-grid geometry screen around the right-shift family hit.",
    mutations: generatedServiceBraidRightGeometryNeighborhoodMutations(),
    options: {
      seeds: [7, 19, 37],
      statePolicies: ["initial-incumbent", "post-stagnation"],
      ...COMPACT_SCREEN_OPTIONS
    },
    candidateSummaryMode: "byCase",
    selectivitySummary: true,
    selectivitySummaryTitle:
      "Service-braid generated-grid right geometry-neighborhood compact screen selectivity summary"
  }
});

function usage() {
  const names = Object.keys(BUNDLES)
    .map((name) => `  - ${name}`)
    .join("\n");
  return [
    "Usage: node scripts/generate-service-braid-replay-artifacts.mjs --bundle=<name> [--force-artifact-dir]",
    "       node scripts/generate-service-braid-replay-artifacts.mjs --bundle=<name> --online-ablation --online-artifact-dir=<dir> --window-ranker-model=<path> --window-ranker-min-score-delta=<n> [--window-ranker-selected-feature-gates=<feature>=...] [--window-ranker-selected-feature-gate-groups=<gates;gates>] [--lns-iterations=<n>] [--force-artifact-dir]",
    "",
    "Regenerates custom protected service-braid LNS replay-label artifacts from built dist/ modules.",
    "With --online-ablation, generates diagnostics-only online ranker scorecards for the custom candidate cases.",
    "Run npm run build first when dist/ is stale or absent.",
    "",
    "Bundles:",
    names
  ].join("\n");
}

function parseFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
  return number;
}

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function parseSelectedFeatureGates(value) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("--window-ranker-selected-feature-gates must include at least one feature comparison.");
  }
  return entries.map((entry) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*(<=|>=)\s*(-?(?:\d+\.?\d*|\.\d+))$/.exec(entry);
    if (!match) {
      throw new Error(
        "--window-ranker-selected-feature-gates entries must look like serviceCandidateBonus>=5.58 or roadCountInside<=0."
      );
    }
    const threshold = Number(match[3]);
    if (!Number.isFinite(threshold)) {
      throw new Error("--window-ranker-selected-feature-gates thresholds must be finite numbers.");
    }
    return match[2] === "<=" ? { feature: match[1], maxValue: threshold } : { feature: match[1], minValue: threshold };
  });
}

function parseSelectedFeatureGateGroups(value) {
  const groups = value
    .split(";")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
  if (groups.length === 0) {
    throw new Error(
      "--window-ranker-selected-feature-gate-groups must include at least one semicolon-separated gate group."
    );
  }
  return groups.map((group) => parseSelectedFeatureGates(group));
}

function parseArgs(argv) {
  let bundleName;
  let forceArtifactDir = false;
  let mode = "replay";
  let onlineArtifactDir;
  let windowRankerModelPath;
  let windowRankerMinScoreDelta;
  let windowRankerSelectedFeatureGates;
  let windowRankerSelectedFeatureGateGroups;
  let onlineLnsIterations = DEFAULT_ONLINE_LNS_OPTIONS.iterations;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--online-ablation" || arg === "--online-ranker" || arg === "--mode=online") {
      mode = "online";
      continue;
    }
    if (arg === "--force-artifact-dir") {
      forceArtifactDir = true;
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      bundleName = arg.slice("--bundle=".length);
      continue;
    }
    if (arg.startsWith("--online-artifact-dir=")) {
      onlineArtifactDir = arg.slice("--online-artifact-dir=".length);
      continue;
    }
    if (arg.startsWith("--window-ranker-model=")) {
      windowRankerModelPath = arg.slice("--window-ranker-model=".length);
      continue;
    }
    if (arg.startsWith("--window-ranker-min-score-delta=")) {
      windowRankerMinScoreDelta = parseFiniteNumber(
        arg.slice("--window-ranker-min-score-delta=".length),
        "--window-ranker-min-score-delta"
      );
      if (windowRankerMinScoreDelta < 0) throw new Error("--window-ranker-min-score-delta must be non-negative.");
      continue;
    }
    if (arg.startsWith("--window-ranker-selected-feature-gates=")) {
      windowRankerSelectedFeatureGates = parseSelectedFeatureGates(
        arg.slice("--window-ranker-selected-feature-gates=".length)
      );
      continue;
    }
    if (arg.startsWith("--window-ranker-feature-value-gates=")) {
      windowRankerSelectedFeatureGates = parseSelectedFeatureGates(
        arg.slice("--window-ranker-feature-value-gates=".length)
      );
      continue;
    }
    if (arg.startsWith("--window-ranker-selected-feature-gate-groups=")) {
      windowRankerSelectedFeatureGateGroups = parseSelectedFeatureGateGroups(
        arg.slice("--window-ranker-selected-feature-gate-groups=".length)
      );
      continue;
    }
    if (arg.startsWith("--window-ranker-feature-value-gate-groups=")) {
      windowRankerSelectedFeatureGateGroups = parseSelectedFeatureGateGroups(
        arg.slice("--window-ranker-feature-value-gate-groups=".length)
      );
      continue;
    }
    if (arg.startsWith("--lns-iterations=")) {
      onlineLnsIterations = parsePositiveInteger(arg.slice("--lns-iterations=".length), "--lns-iterations");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!bundleName) throw new Error("--bundle=<name> is required.");
  const bundle = BUNDLES[bundleName];
  if (!bundle) throw new Error(`Unknown bundle '${bundleName}'.\n\n${usage()}`);
  if (mode === "online") {
    if (!onlineArtifactDir) throw new Error("--online-artifact-dir=<dir> is required with --online-ablation.");
    if (!windowRankerModelPath) throw new Error("--window-ranker-model=<path> is required with --online-ablation.");
    if (windowRankerMinScoreDelta === undefined) {
      throw new Error("--window-ranker-min-score-delta=<n> is required with --online-ablation.");
    }
  }
  return {
    bundleName,
    bundle,
    forceArtifactDir,
    mode,
    onlineArtifactDir,
    windowRankerModelPath,
    windowRankerMinScoreDelta,
    windowRankerSelectedFeatureGates,
    windowRankerSelectedFeatureGateGroups,
    onlineLnsIterations
  };
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

function repoRelativeExistingPath(inputPath, label) {
  const absolutePath = path.resolve(repoRoot(), inputPath);
  if (!fs.existsSync(absolutePath)) throw new Error(`${label} does not exist: ${inputPath}`);
  const relativePath = path.relative(repoRoot(), absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be inside the repository: ${inputPath}`);
  }
  return relativePath;
}

function readWindowRankerModel(modelPath) {
  const repoRelativePath = repoRelativeExistingPath(modelPath, "--window-ranker-model");
  const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot(), repoRelativePath), "utf8"));
  const candidate =
    parsed && typeof parsed === "object" && parsed.model && parsed.model.weights ? parsed.model : parsed;
  if (!candidate || typeof candidate !== "object" || !candidate.weights || typeof candidate.weights !== "object") {
    throw new Error("--window-ranker-model must point to a model JSON object with a weights object.");
  }
  return { model: candidate, repoRelativePath };
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

function selectedFeatureGateArg(gate) {
  if (gate.minValue === undefined) return `${gate.feature}<=${gate.maxValue}`;
  if (gate.maxValue === undefined) return `${gate.feature}>=${gate.minValue}`;
  return `${gate.minValue}<=${gate.feature}<=${gate.maxValue}`;
}

function slugForId(value) {
  return String(value)
    .trim()
    .replace(/[^0-9a-zA-Z]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function onlineCommand(defaultCliReplayCommand, args) {
  const argv = [
    `--bundle=${args.bundleName}`,
    "--online-ablation",
    `--online-artifact-dir=${args.onlineArtifactDir}`,
    `--window-ranker-model=${args.windowRankerModelPath}`,
    `--window-ranker-min-score-delta=${args.windowRankerMinScoreDelta}`,
    `--lns-iterations=${args.onlineLnsIterations}`
  ];
  if (args.windowRankerSelectedFeatureGates?.length) {
    argv.push(
      `--window-ranker-selected-feature-gates=${args.windowRankerSelectedFeatureGates.map(selectedFeatureGateArg).join(",")}`
    );
  }
  if (args.windowRankerSelectedFeatureGateGroups?.length) {
    argv.push(
      `--window-ranker-selected-feature-gate-groups=${args.windowRankerSelectedFeatureGateGroups
        .map((group) => group.map(selectedFeatureGateArg).join(","))
        .join(";")}`
    );
  }
  if (args.forceArtifactDir) argv.push("--force-artifact-dir");
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

const args = parseArgs(process.argv.slice(2));
const { bundleName, bundle, forceArtifactDir } = args;
const artifactHelpers = await loadArtifactBundleHelpers();
const benchmarkApi = await loadBenchmarkApi();
const baseCase = benchmarkApi.DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS.find(
  (benchmarkCase) => benchmarkCase.name === BASE_CASE_NAME
);
if (!baseCase) throw new Error(`Missing protected holdout base case: ${BASE_CASE_NAME}`);

const definitions = candidateDefinitions(bundle);
const candidateCases = definitions.map((definition) => buildCandidateCase(baseCase, definition));

if (args.mode === "online") {
  const artifacts = artifactHelpers.prepareArtifactBundleDirectory(args.onlineArtifactDir, "--online-artifact-dir", {
    force: forceArtifactDir
  });
  const { model, repoRelativePath: modelPath } = readWindowRankerModel(args.windowRankerModelPath);
  const result = benchmarkApi.runLnsWindowRankerOnlineAblation(candidateCases, {
    names: candidateCases.map((candidateCase) => candidateCase.name),
    seeds: bundle.options.seeds,
    model,
    minScoreDelta: args.windowRankerMinScoreDelta,
    ...(args.windowRankerSelectedFeatureGates === undefined
      ? {}
      : { selectedFeatureGates: args.windowRankerSelectedFeatureGates }),
    ...(args.windowRankerSelectedFeatureGateGroups === undefined
      ? {}
      : { selectedFeatureGateGroups: args.windowRankerSelectedFeatureGateGroups }),
    lns: {
      ...DEFAULT_ONLINE_LNS_OPTIONS,
      iterations: args.onlineLnsIterations
    }
  });
  const artifactPaths = {
    scorecardJson: artifacts.artifactPath("lns-window-ranker-online-ablation.json"),
    scorecardText: artifacts.artifactPath("lns-window-ranker-online-ablation.txt"),
    telemetryManifestJson: artifacts.artifactPath("telemetry-manifest.json"),
    registryEntryDraftJson: artifacts.artifactPath("registry-entry-draft.json"),
    manifestJson: artifacts.artifactPath("manifest.json")
  };
  const command = onlineCommand(artifactHelpers.defaultCliReplayCommand, args);
  const registryArtifactPaths = [
    artifactPaths.scorecardJson,
    artifactPaths.scorecardText,
    artifactPaths.telemetryManifestJson,
    artifactPaths.manifestJson
  ];
  const telemetryManifest = benchmarkApi.buildLnsWindowRankerOnlineAblationTelemetryManifest(result, {
    command,
    git: benchmarkApi.resolveExperimentRegistryGitMetadata(),
    hardware: benchmarkApi.captureExperimentRegistryHardwareMetadata(),
    inputArtifacts: [modelPath],
    outputArtifacts: [artifactPaths.scorecardJson, artifactPaths.scorecardText, artifactPaths.telemetryManifestJson]
  });
  const runSlug = slugForId(path.basename(args.onlineArtifactDir) || bundleName);
  const registryEntryDraft = benchmarkApi.buildLnsWindowRankerOnlineAblationRegistryEntryDraft(result, {
    runId: `service-braid-${runSlug}`,
    commands: [command],
    artifactPaths: registryArtifactPaths,
    decision: "diagnostics-only",
    summary: "Custom service-braid generated-case online LNS window-ranker diagnostic; no solver default changed.",
    modelPath,
    protectedHoldout: false
  });
  const summary = result.variantSummaries.find((entry) => entry.variantName === "window-ranker");
  const manifest = {
    artifactDir: artifacts.artifactDir,
    artifactPaths,
    command,
    generatedAt: result.generatedAt,
    modelPath,
    modelFingerprint: summary?.modelFingerprint ?? telemetryManifest.modelFingerprint ?? null,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    comparisonCount: result.comparisonCount,
    selectedCaseNames: [...result.selectedCaseNames],
    pressureFamilies: [...new Set(result.cases.map((entry) => entry.pressureFamily))],
    options: {
      seeds: [...bundle.options.seeds],
      lns: { ...DEFAULT_ONLINE_LNS_OPTIONS, iterations: args.onlineLnsIterations },
      minScoreDelta: args.windowRankerMinScoreDelta,
      ...(args.windowRankerSelectedFeatureGates === undefined
        ? {}
        : { selectedFeatureGates: args.windowRankerSelectedFeatureGates }),
      ...(args.windowRankerSelectedFeatureGateGroups === undefined
        ? {}
        : { selectedFeatureGateGroups: args.windowRankerSelectedFeatureGateGroups })
    },
    summary: summary
      ? {
          meanPopulationDeltaVsBaseline: summary.meanPopulationDeltaVsBaseline,
          worstPopulationDeltaVsBaseline: summary.worstPopulationDeltaVsBaseline,
          improvedCaseCount: summary.improvedCaseCount,
          regressedCaseCount: summary.regressedCaseCount,
          unchangedCaseCount: summary.unchangedCaseCount,
          rankerDecisionCount: summary.rankerDecisionCount,
          rankerOverrideCount: summary.rankerOverrideCount,
          rankerFallbackDecisionCount: summary.rankerFallbackDecisionCount,
          changedFinalLayoutCount: summary.changedFinalLayoutCount,
          timeToBestPromotionGatePassed: summary.timeToBestPromotionGatePassed
        }
      : null,
    candidateMutation: {
      baseCase: BASE_CASE_NAME,
      ...(definitions.length === 1
        ? clone(definitions[0].mutation)
        : {
            mutations: definitions.map((definition) => ({
              caseName: definition.caseName,
              ...clone(definition.mutation)
            }))
          })
    },
    generator: {
      script: SCRIPT_PATH,
      mode: "online",
      bundle: bundleName,
      requiresBuild: true,
      baseCorpus: "DEFAULT_LNS_WINDOW_RANKER_ONLINE_PROTECTED_HOLDOUT_CORPUS",
      baseCase: BASE_CASE_NAME,
      candidateCases: candidateCases.map((candidateCase) => candidateCase.name),
      command
    }
  };
  artifactHelpers.writeJsonArtifact(
    artifacts.absoluteArtifactPath("lns-window-ranker-online-ablation.json"),
    { ...benchmarkApi.createLnsWindowRankerOnlineAblationSnapshot(result), generatedAt: result.generatedAt },
    { force: forceArtifactDir }
  );
  artifactHelpers.writeTextArtifact(
    artifacts.absoluteArtifactPath("lns-window-ranker-online-ablation.txt"),
    `${benchmarkApi.formatLnsWindowRankerOnlineAblation(result)}\n`,
    { force: forceArtifactDir }
  );
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("telemetry-manifest.json"), telemetryManifest, {
    force: forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("registry-entry-draft.json"), registryEntryDraft, {
    force: forceArtifactDir
  });
  artifactHelpers.writeJsonArtifact(artifacts.absoluteArtifactPath("manifest.json"), manifest, {
    force: forceArtifactDir
  });
  console.log(`Generated online ${bundleName} at ${artifacts.artifactDir}`);
  process.exit(0);
}

const artifacts = artifactHelpers.prepareArtifactBundleDirectory(bundle.artifactDir, "--artifact-dir", {
  force: forceArtifactDir
});
const replayArtifactBundle = await loadLnsWindowReplayArtifactBundle();
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
