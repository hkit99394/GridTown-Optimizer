export const SCRIPT_PATH = "scripts/generate-service-braid-replay-artifacts.mjs";
export const BASE_CASE_NAME = "lns-holdout-service-braid-pressure";
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

export const DEFAULT_ONLINE_LNS_OPTIONS = Object.freeze({
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

export const BUNDLES = Object.freeze({
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
