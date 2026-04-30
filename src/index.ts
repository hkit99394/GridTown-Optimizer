/**
 * Compatibility public library entry point.
 *
 * New code should prefer `solverApi` for solver/domain behavior and
 * `benchmarkApi` for benchmark, label, and experiment-registry tooling.
 */

export * from "./solverApi.js";
export * from "./benchmarkApi.js";
