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
  assert.equal(typeof benchmarkApi.runGreedyBenchmarkSuite, "function");
  assert.equal(typeof benchmarkApi.appendExperimentRegistryEntry, "function");
  assert.equal(typeof benchmarkApi.DEFAULT_GREEDY_BENCHMARK_CORPUS, "object");
}

function testBenchmarkApiDoesNotExposeSolverEntrypoints() {
  assert.equal(hasOwnExport(benchmarkApi, "solve"), false);
  assert.equal(hasOwnExport(benchmarkApi, "solveGreedy"), false);
  assert.equal(hasOwnExport(benchmarkApi, "evaluateLayout"), false);
}

function testPackageSubpathsResolveToStableEntrypoints() {
  assert.equal(packageRootApi.solve, rootApi.solve);
  assert.equal(packageSolverApi.solve, solverApi.solve);
  assert.equal(packageSolverApi.solveGreedy, solverApi.solveGreedy);
  assert.equal(packageBenchmarkApi.runGreedyBenchmarkSuite, benchmarkApi.runGreedyBenchmarkSuite);
  assert.equal(packageBenchmarkApi.appendExperimentRegistryEntry, benchmarkApi.appendExperimentRegistryEntry);
  assert.equal(hasOwnExport(packageRootApi, "runGreedyBenchmarkSuite"), false);
  assert.equal(hasOwnExport(packageRootApi, "appendExperimentRegistryEntry"), false);
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

function relativeImportToPattern(targetDir, minParentSegments = 1, options = {}) {
  const parentPrefix = `(?:\\.\\.\\/){${minParentSegments},}`;
  const prefix = options.includeCurrent ? `(?:\\.\\/|${parentPrefix})` : parentPrefix;
  const relativeTarget = `${prefix}${targetDir}\\/`;
  return new RegExp(
    [
      `from\\s*["']${relativeTarget}`,
      `import\\s*["']${relativeTarget}`,
      `import\\(\\s*["']${relativeTarget}`,
      `export\\s+[^"']*\\s+from\\s*["']${relativeTarget}`,
    ].join("|")
  );
}

function findRelativeImportOffenders(rootDirs, targetDir, options = {}) {
  const roots = Array.isArray(rootDirs) ? rootDirs : [rootDirs];
  const {
    minParentSegments = 1,
    includeCurrent = false,
    relativeBaseDir = roots[0],
    allowRelativePaths = new Set(),
  } = options;
  const importPattern = relativeImportToPattern(targetDir, minParentSegments, { includeCurrent });
  return roots.flatMap((rootDir) =>
    listFiles(rootDir, (fileName) => fileName.endsWith(".ts"))
      .filter((filePath) => !allowRelativePaths.has(path.relative(relativeBaseDir, filePath)))
      .filter((filePath) => importPattern.test(fs.readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(relativeBaseDir, filePath))
  );
}

function testInternalTestsUseDedicatedEntrypoints() {
  const legacyEntrypointPattern = /require\(["'](?:\.\.\/)+(?:dist\/index\.js|dist\/benchmarks\/index\.js)["']\)/;
  const offenders = listFiles(__dirname, (fileName) => fileName.endsWith(".cjs"))
    .filter((filePath) => path.basename(filePath) !== "public-api.test.cjs")
    .filter((filePath) => legacyEntrypointPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(offenders.map((filePath) => path.relative(__dirname, filePath)), []);
}

function testBenchmarkToolingUsesBenchmarkApiBoundary() {
  const appsDir = path.join(__dirname, "..", "src", "apps");
  const toolsCliDir = path.join(__dirname, "..", "src", "tools", "cli");
  const benchmarkAppNamePattern = /(?:BenchmarkCli|learnedRankingLabelCli|experimentRegistryCli)\.ts$/;
  const legacyBenchmarkImportPattern = /\.\.\/benchmarks\/(?:index|experimentRegistry)\.js/;
  const appOffenders = listFiles(appsDir, (fileName) => benchmarkAppNamePattern.test(fileName));
  const toolImportOffenders = listFiles(toolsCliDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => legacyBenchmarkImportPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(
    [...appOffenders, ...toolImportOffenders].map((filePath) => path.relative(path.join(__dirname, ".."), filePath)),
    []
  );
}

function testBenchmarkInternalsAreHiddenBehindBenchmarkApi() {
  const srcDir = path.join(__dirname, "..", "src");
  const allowedRelativePaths = new Set([
    "benchmarkApi.ts",
    path.join("packages", "benchmarks", "index.ts"),
  ]);
  for (const filePath of listFiles(path.join(srcDir, "benchmarks"), (fileName) => fileName.endsWith(".ts"))) {
    allowedRelativePaths.add(path.relative(srcDir, filePath));
  }
  const offenders = findRelativeImportOffenders(srcDir, "benchmarks", {
    includeCurrent: true,
    relativeBaseDir: srcDir,
    allowRelativePaths: allowedRelativePaths,
  });

  assert.deepEqual(offenders, []);
}

function testLegacyBenchmarkModulesAreCompatibilityWrappers() {
  const benchmarksDir = path.join(__dirname, "..", "src", "benchmarks");
  const wrapperExportPattern = /export \* from "\.\.\/packages\/benchmarks\/[^"]+\.js";/;
  const offenders = listFiles(benchmarksDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => !wrapperExportPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(offenders.map((filePath) => path.relative(benchmarksDir, filePath)), []);
}

function testLegacyCoreModulesAreCompatibilityWrappers() {
  const coreDir = path.join(__dirname, "..", "src", "core");
  const offenders = listFiles(coreDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => {
      const moduleName = path.basename(filePath, ".ts");
      const expected = `export * from "../packages/core/${moduleName}.js";`;
      return fs.readFileSync(filePath, "utf8").trim() !== expected;
    });

  assert.deepEqual(offenders.map((filePath) => path.relative(coreDir, filePath)), []);
}

function testLegacySolverModulesAreCompatibilityWrappers() {
  const srcDir = path.join(__dirname, "..", "src");
  const legacySolverDirs = ["auto", "cp-sat", "greedy", "lns"];
  const expectedWrappers = new Map([
    [
      "auto/solver.ts",
      [
        `export * from "../packages/solvers/auto/solver.js";`,
        `export { startAutoSolve } from "../packages/runtime/index.js";`,
        `export type { AutoSolveHandle } from "../packages/runtime/index.js";`,
      ].join("\n"),
    ],
    [
      "cp-sat/solver.ts",
      [
        `export * from "../packages/solvers/cp-sat/solver.js";`,
        `export { startCpSatSolve } from "../packages/runtime/index.js";`,
        `export type { CpSatSolveHandle } from "../packages/runtime/index.js";`,
      ].join("\n"),
    ],
    [
      "greedy/bridge.ts",
      [
        `export { startGreedySolve } from "../packages/runtime/index.js";`,
        `export type { GreedySolveHandle } from "../packages/runtime/index.js";`,
      ].join("\n"),
    ],
    ["greedy/worker.ts", `import "../packages/runtime/background/greedyWorker.js";`],
    [
      "lns/bridge.ts",
      [
        `export { startLnsSolve } from "../packages/runtime/index.js";`,
        `export type { LnsSolveHandle } from "../packages/runtime/index.js";`,
      ].join("\n"),
    ],
    ["lns/worker.ts", `import "../packages/runtime/background/lnsWorker.js";`],
  ]);
  const offenders = legacySolverDirs.flatMap((solverDir) =>
    listFiles(path.join(srcDir, solverDir), (fileName) => fileName.endsWith(".ts"))
      .filter((filePath) => {
        const moduleName = path.basename(filePath, ".ts");
        const relativePath = path.relative(srcDir, filePath);
        const expected = expectedWrappers.get(relativePath)
          ?? `export * from "../packages/solvers/${solverDir}/${moduleName}.js";`;
        return fs.readFileSync(filePath, "utf8").trim() !== expected;
      })
      .map((filePath) => path.relative(srcDir, filePath))
  );

  assert.deepEqual(offenders, []);
}

function testLegacyRuntimeModulesAreCompatibilityWrappers() {
  const srcDir = path.join(__dirname, "..", "src");
  const runtimeDir = path.join(srcDir, "runtime");
  const expectedWrappers = new Map([
    ["runtime/index.ts", `export * from "../packages/runtime/index.js";`],
    ["runtime/backgroundSolverRunner.ts", `export * from "../packages/runtime/background/runner.js";`],
    ["runtime/optimizerRegistry.ts", `export * from "../packages/runtime/dispatch/optimizerRegistry.js";`],
    ["runtime/solve.ts", `export * from "../packages/runtime/dispatch/solve.js";`],
    ["runtime/solveJobManager.ts", `export * from "../packages/runtime/jobs/solveJobManager.js";`],
    ["runtime/solveProgressLog.ts", `export * from "../packages/runtime/jobs/solveProgressLog.js";`],
  ]);
  for (const area of ["background", "dispatch", "jobs"]) {
    for (const filePath of listFiles(path.join(runtimeDir, area), (fileName) => fileName.endsWith(".ts"))) {
      const moduleName = path.basename(filePath, ".ts");
      const relativePath = path.relative(srcDir, filePath);
      expectedWrappers.set(relativePath, `export * from "../../packages/runtime/${area}/${moduleName}.js";`);
    }
  }

  const offenders = listFiles(runtimeDir, (fileName) => fileName.endsWith(".ts"))
    .map((filePath) => path.relative(srcDir, filePath))
    .filter((relativePath) => fs.readFileSync(path.join(srcDir, relativePath), "utf8").trim() !== expectedWrappers.get(relativePath));

  assert.deepEqual(offenders, []);
}

function testLegacyPlannerServerModulesAreCompatibilityWrappers() {
  const srcDir = path.join(__dirname, "..", "src");
  const expectedWrappers = new Map([
    ["apps/webServer.ts", `import "./planner-server/webServer.js";`],
    ["server/index.ts", `export * from "../apps/planner-server/index.js";`],
  ]);
  const serverHttpDir = path.join(srcDir, "server", "http");
  for (const filePath of listFiles(serverHttpDir, (fileName) => fileName.endsWith(".ts"))) {
    const moduleName = path.basename(filePath, ".ts");
    const relativePath = path.relative(srcDir, filePath);
    expectedWrappers.set(relativePath, `export * from "../../apps/planner-server/http/${moduleName}.js";`);
  }

  const offenders = [...expectedWrappers]
    .filter(([relativePath, expected]) => fs.readFileSync(path.join(srcDir, relativePath), "utf8").trim() !== expected)
    .map(([relativePath]) => relativePath);

  assert.deepEqual(offenders, []);
}

function testPlannerWebLivesInAppFolder() {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "apps", "planner-web", "index.html")), true);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "web")), false);
}

function testCorePackageDoesNotImportOutsidePackage() {
  const corePackageDir = path.join(__dirname, "..", "src", "packages", "core");
  const parentImportPattern = /(?:from|import\(|export\s+[^"']*\s+from)\s*["']\.\.\//;
  const offenders = listFiles(corePackageDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => parentImportPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(offenders.map((filePath) => path.relative(corePackageDir, filePath)), []);
}

function testSolverApiUsesCorePackageBoundary() {
  const solverApiSource = fs.readFileSync(path.join(__dirname, "..", "src", "solverApi.ts"), "utf8");
  assert.equal(solverApiSource.includes("./core/index.js"), false);
  assert.equal(solverApiSource.includes("./packages/core/index.js"), true);
}

function testBenchmarkPackageUsesCorePackageBoundary() {
  const benchmarkPackageDir = path.join(__dirname, "..", "src", "packages", "benchmarks");
  const offenders = findRelativeImportOffenders(benchmarkPackageDir, "core", { minParentSegments: 2 });

  assert.deepEqual(offenders, []);
}

function testAppsAndToolsUseCorePackageBoundary() {
  const srcDir = path.join(__dirname, "..", "src");
  const offenderRoots = [
    path.join(srcDir, "apps"),
    path.join(srcDir, "tools"),
  ];
  const offenders = findRelativeImportOffenders(offenderRoots, "core", { relativeBaseDir: srcDir });

  assert.deepEqual(offenders, []);
}

function testRuntimeAndServerUseCorePackageBoundary() {
  const srcDir = path.join(__dirname, "..", "src");
  const offenderRoots = [
    path.join(srcDir, "runtime"),
    path.join(srcDir, "server"),
  ];
  const offenders = findRelativeImportOffenders(offenderRoots, "core", { relativeBaseDir: srcDir });

  assert.deepEqual(offenders, []);
}

function testSolversUseCorePackageBoundary() {
  const srcDir = path.join(__dirname, "..", "src");
  const solverPackageDir = path.join(srcDir, "packages", "solvers");
  const offenders = findRelativeImportOffenders(solverPackageDir, "core", {
    minParentSegments: 3,
    relativeBaseDir: srcDir,
  });

  assert.deepEqual(offenders, []);
}

function testSolverPackageDoesNotImportRuntimePackage() {
  const srcDir = path.join(__dirname, "..", "src");
  const solverPackageDir = path.join(srcDir, "packages", "solvers");
  const offenders = findRelativeImportOffenders(solverPackageDir, "runtime", { relativeBaseDir: srcDir });

  assert.deepEqual(offenders, []);
}

testSolverApiExposesDomainAndSolverSurface();
testSolverApiDoesNotExposeBenchmarkSurface();
testBenchmarkApiExposesBenchmarkSurface();
testBenchmarkApiDoesNotExposeSolverEntrypoints();
testPackageSubpathsResolveToStableEntrypoints();
testInternalTestsUseDedicatedEntrypoints();
testBenchmarkToolingUsesBenchmarkApiBoundary();
testBenchmarkInternalsAreHiddenBehindBenchmarkApi();
testLegacyBenchmarkModulesAreCompatibilityWrappers();
testLegacyCoreModulesAreCompatibilityWrappers();
testLegacySolverModulesAreCompatibilityWrappers();
testLegacyRuntimeModulesAreCompatibilityWrappers();
testLegacyPlannerServerModulesAreCompatibilityWrappers();
testPlannerWebLivesInAppFolder();
testCorePackageDoesNotImportOutsidePackage();
testSolverApiUsesCorePackageBoundary();
testBenchmarkPackageUsesCorePackageBoundary();
testAppsAndToolsUseCorePackageBoundary();
testRuntimeAndServerUseCorePackageBoundary();
testSolversUseCorePackageBoundary();
testSolverPackageDoesNotImportRuntimePackage();
