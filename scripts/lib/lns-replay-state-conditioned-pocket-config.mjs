export const SCRIPT_PATH = "scripts/discover-lns-replay-state-conditioned-pockets.mjs";
export const DEFAULT_SOURCE_ROOT = "artifacts/lns-window-replay-labels";
export const DEFAULT_TOP = 25;
export const DEFAULT_MAX_ATOMS = 160;
export const DEFAULT_MAX_GROUP_SIZE = 2;
export const DEFAULT_MIN_IMPROVED_LABELS = 1;

export const CATEGORICAL_FIELDS = Object.freeze([
  { path: "statePolicy", label: "statePolicy", kind: "state" },
  { path: "stateSourceStatus", label: "stateSourceStatus", kind: "state" },
  { path: "operator", label: "operator", kind: "operator" },
  { path: "selectionSource", label: "selectionSource", kind: "operator" },
  { path: "selectedByBaseline", label: "selectedByBaseline", kind: "operator" }
]);

export const NUMERIC_FIELDS = Object.freeze([
  { path: "operatorScore", label: "operatorScore", kind: "operator" },
  { path: "incumbentPopulation", label: "incumbentPopulation", kind: "state" },
  { path: "stateSourceIteration", label: "stateSourceIteration", kind: "state" },
  { path: "stateStagnantIterations", label: "stateStagnantIterations", kind: "state" },
  { path: "window.top", label: "windowTop", kind: "window" },
  { path: "window.left", label: "windowLeft", kind: "window" },
  { path: "window.rows", label: "windowRows", kind: "window" },
  { path: "window.cols", label: "windowCols", kind: "window" },
  { path: "features.area", label: "area", kind: "feature" },
  { path: "features.roadCountInside", label: "roadCountInside", kind: "feature" },
  { path: "features.serviceCountInside", label: "serviceCountInside", kind: "feature" },
  { path: "features.residentialCountInside", label: "residentialCountInside", kind: "feature" },
  { path: "features.residentialHeadroomInside", label: "residentialHeadroomInside", kind: "feature" },
  { path: "features.serviceBonusInside", label: "serviceBonusInside", kind: "feature" },
  {
    path: "features.connectivityShadow.reachableEmptyCellsBefore",
    label: "reachableBefore",
    kind: "feature"
  },
  {
    path: "features.connectivityShadow.reachableEmptyCellsAfterClearingWindow",
    label: "reachableAfter",
    kind: "feature"
  },
  {
    path: "features.connectivityShadow.newlyReachableEmptyCellsIfCleared",
    label: "newlyReachable",
    kind: "feature"
  },
  {
    path: "features.connectivityShadow.disconnectedEmptyCellsBefore",
    label: "disconnectedBefore",
    kind: "feature"
  },
  {
    path: "features.connectivityShadow.disconnectedEmptyCellsAfterClearingWindow",
    label: "disconnectedAfter",
    kind: "feature"
  },
  {
    path: "features.connectivityShadow.clearedBuildingFootprintCells",
    label: "clearedFootprint",
    kind: "feature"
  },
  {
    path: "features.fragmentation.emptyComponentCountBefore",
    label: "componentsBefore",
    kind: "feature"
  },
  {
    path: "features.fragmentation.emptyComponentCountAfterClearingWindow",
    label: "componentsAfter",
    kind: "feature"
  },
  {
    path: "features.fragmentation.componentDeltaAfterClearingWindow",
    label: "componentDelta",
    kind: "feature"
  },
  {
    path: "features.fragmentation.allowedWindowCellCount",
    label: "allowedWindowCells",
    kind: "feature"
  },
  {
    path: "features.fragmentation.anchorReachableWindowCellCount",
    label: "anchorReachableWindowCells",
    kind: "feature"
  },
  {
    path: "features.fragmentation.narrowGateCellCount",
    label: "narrowGateCells",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.serviceCandidatesIntersectingWindow",
    label: "serviceCandidatesIntersecting",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.residentialCandidatesIntersectingWindow",
    label: "residentialCandidatesIntersecting",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.serviceCandidatesBlockedByIncumbent",
    label: "serviceCandidatesBlocked",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.residentialCandidatesBlockedByIncumbent",
    label: "residentialCandidatesBlocked",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.serviceCandidateBonusInside",
    label: "serviceCandidateBonus",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.maxServiceCandidateBonusInside",
    label: "maxServiceCandidateBonus",
    kind: "feature"
  },
  {
    path: "features.candidateLoss.residentialCandidateHeadroomInside",
    label: "residentialCandidateHeadroom",
    kind: "feature"
  }
]);

export function usage() {
  return [
    "Usage: node scripts/discover-lns-replay-state-conditioned-pockets.mjs --artifact-dir=<path> [options]",
    "",
    "Discovers diagnostics-only state-conditioned durable opportunity pockets from LNS replay-label artifacts.",
    "",
    "Options:",
    `  --source-root=<path>          Root to scan for lns-window-replay-labels.json files. Default: ${DEFAULT_SOURCE_ROOT}`,
    "  --artifact-dir=<path>         Artifact bundle output directory under artifacts/.",
    "  --include-pressure-family=<csv>  Restrict scanned labels to these pressure families.",
    "  --exclude-pressure-family=<csv>  Exclude scanned labels from these pressure families.",
    "  --min-improved-labels=<n>     Minimum improved labels for a durable candidate. Default: 1.",
    "  --max-atoms=<n>               Candidate atom cap before conjunction search. Default: 160.",
    "  --max-group-size=<n>          Maximum atom conjunction size, 1 or 2. Default: 2.",
    "  --top=<n>                     Number of safe and blocked candidates to keep. Default: 25.",
    "  --force-artifact-dir          Replace an existing artifact directory."
  ].join("\n");
}
