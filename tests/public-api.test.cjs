const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootApi = require("../dist/index.js");
const solverApi = require("../dist/solverApi.js");
const benchmarkApi = require("../dist/benchmarkApi.js");
const packageRootApi = require("city-builder");
const packageSolverApi = require("city-builder/solver");
const packageBenchmarkApi = require("city-builder/benchmarks");

function hasOwnExport(moduleExports, name) {
  return Object.prototype.hasOwnProperty.call(moduleExports, name);
}

function testSolverApiExposesDomainAndSolverSurface() {
  assert.equal(solverApi.solve, rootApi.solve);
  assert.equal(solverApi.solveGreedy, rootApi.solveGreedy);
  assert.equal(solverApi.evaluateLayout, rootApi.evaluateLayout);
  assert.equal(solverApi.validateSolution, rootApi.validateSolution);
  assert.equal(solverApi.OMITTED_SOLVER_OPTIMIZER, "auto");
}

function testSolverApiDoesNotExposeBenchmarkSurface() {
  assert.equal(hasOwnExport(solverApi, "runGreedyBenchmarkSuite"), false);
  assert.equal(hasOwnExport(solverApi, "appendExperimentRegistryEntry"), false);
}

function testBenchmarkApiExposesBenchmarkSurface() {
  assert.equal(benchmarkApi.runGreedyBenchmarkSuite, rootApi.runGreedyBenchmarkSuite);
  assert.equal(benchmarkApi.appendExperimentRegistryEntry, rootApi.appendExperimentRegistryEntry);
  assert.equal(typeof benchmarkApi.DEFAULT_GREEDY_BENCHMARK_CORPUS, "object");
}

function testBenchmarkApiDoesNotExposeSolverEntrypoints() {
  assert.equal(hasOwnExport(benchmarkApi, "solve"), false);
  assert.equal(hasOwnExport(benchmarkApi, "solveGreedy"), false);
  assert.equal(hasOwnExport(benchmarkApi, "evaluateLayout"), false);
}

function testPackageSubpathsResolveToStableEntrypoints() {
  assert.equal(packageRootApi.solve, rootApi.solve);
  assert.equal(packageRootApi.runGreedyBenchmarkSuite, rootApi.runGreedyBenchmarkSuite);
  assert.equal(packageSolverApi.solve, solverApi.solve);
  assert.equal(packageSolverApi.solveGreedy, solverApi.solveGreedy);
  assert.equal(packageBenchmarkApi.runGreedyBenchmarkSuite, benchmarkApi.runGreedyBenchmarkSuite);
  assert.equal(packageBenchmarkApi.appendExperimentRegistryEntry, benchmarkApi.appendExperimentRegistryEntry);
  assert.equal(hasOwnExport(packageSolverApi, "runGreedyBenchmarkSuite"), false);
  assert.equal(hasOwnExport(packageBenchmarkApi, "solve"), false);
}

function listFiles(dir, predicate) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, predicate);
    return entry.isFile() && predicate(entry.name) ? [entryPath] : [];
  });
}

function testInternalTestsUseDedicatedEntrypoints() {
  const legacyEntrypointPattern = /require\(["'](?:\.\.\/)+(?:dist\/index\.js|dist\/benchmarks\/index\.js)["']\)/;
  const offenders = listFiles(__dirname, (fileName) => fileName.endsWith(".cjs"))
    .filter((filePath) => path.basename(filePath) !== "public-api.test.cjs")
    .filter((filePath) => legacyEntrypointPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(offenders.map((filePath) => path.relative(__dirname, filePath)), []);
}

function testBenchmarkAppsUseBenchmarkApiBoundary() {
  const appsDir = path.join(__dirname, "..", "src", "apps");
  const legacyBenchmarkImportPattern = /\.\.\/benchmarks\/(?:index|experimentRegistry)\.js/;
  const offenders = listFiles(appsDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => legacyBenchmarkImportPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(offenders.map((filePath) => path.relative(path.join(__dirname, ".."), filePath)), []);
}

testSolverApiExposesDomainAndSolverSurface();
testSolverApiDoesNotExposeBenchmarkSurface();
testBenchmarkApiExposesBenchmarkSurface();
testBenchmarkApiDoesNotExposeSolverEntrypoints();
testPackageSubpathsResolveToStableEntrypoints();
testInternalTestsUseDedicatedEntrypoints();
testBenchmarkAppsUseBenchmarkApiBoundary();
