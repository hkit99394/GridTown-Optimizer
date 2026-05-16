const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");

const {
  buildDeterministicAblationGateReport,
  createGreedyBenchmarkSnapshot,
  createGreedyDeterministicAblationSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_GREEDY_BENCHMARK_OPTIONS,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
  formatDeterministicAblationGateReport,
  formatGreedyBenchmarkSuite,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyDeterministicAblation,
  listGreedyBenchmarkCaseNames,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyDeterministicAblationCaseNames,
  normalizeGreedyBenchmarkOptions,
  runGreedyBenchmarkSuite,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyDeterministicAblation
} = require("city-builder/benchmarks");
const { solveGreedy, validateSolution, validateSolutionMap } = require("city-builder/solver");
const { sortedRoads } = require("../helpers/assertions.cjs");
const { materializeDeferredRoadNetwork } = require("../../dist/packages/core/roads.js");
const { rectangleBorderCells } = require("../../dist/packages/core/grid.js");

module.exports = {
  assert,
  childProcess,
  path,
  buildDeterministicAblationGateReport,
  createGreedyBenchmarkSnapshot,
  createGreedyDeterministicAblationSnapshot,
  DEFAULT_DETERMINISTIC_ABLATION_GATE_SEEDS,
  DEFAULT_GREEDY_BENCHMARK_CORPUS,
  DEFAULT_GREEDY_BENCHMARK_OPTIONS,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CASE_NAMES,
  DEFAULT_GREEDY_CONNECTIVITY_SHADOW_SCORING_ABLATION_CORPUS,
  DEFAULT_GREEDY_DETERMINISTIC_ABLATION_CASE_NAMES,
  formatDeterministicAblationGateReport,
  formatGreedyBenchmarkSuite,
  formatGreedyConnectivityShadowScoringAblation,
  formatGreedyDeterministicAblation,
  listGreedyBenchmarkCaseNames,
  listGreedyConnectivityShadowScoringAblationCaseNames,
  listGreedyDeterministicAblationCaseNames,
  normalizeGreedyBenchmarkOptions,
  runGreedyBenchmarkSuite,
  runGreedyConnectivityShadowScoringAblation,
  runGreedyDeterministicAblation,
  solveGreedy,
  validateSolution,
  validateSolutionMap,
  sortedRoads,
  materializeDeferredRoadNetwork,
  rectangleBorderCells
};
