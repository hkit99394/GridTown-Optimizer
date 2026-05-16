/**
 * Public benchmark and experiment API.
 *
 * Keep benchmarking, label generation, and registry tooling separate from the
 * solver/domain entry point so the future workspace split has a stable target.
 */

export * from "./packages/benchmarks/index.js";
