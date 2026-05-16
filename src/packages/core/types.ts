/**
 * City Builder - public type facade (see docs/requirements/SPEC.md).
 *
 * Domain-specific type surfaces live under ./types/ so solver modules can
 * depend on focused contracts while existing imports keep working.
 */

export * from "./types/baseTypes.js";
export * from "./types/autoTypes.js";
export * from "./types/cpSatTypes.js";
export * from "./types/greedyTypes.js";
export * from "./types/lnsTypes.js";
export * from "./types/solverParamTypes.js";
export * from "./types/solutionTypes.js";
export * from "./types/cpSatContinuationTypes.js";
export * from "./types/layoutTypes.js";
