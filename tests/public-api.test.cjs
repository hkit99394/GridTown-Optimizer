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
  if (!fs.existsSync(dir)) return [];
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
      `export\\s+[^"']*\\s+from\\s*["']${relativeTarget}`
    ].join("|")
  );
}

function findRelativeImportOffenders(rootDirs, targetDir, options = {}) {
  const roots = Array.isArray(rootDirs) ? rootDirs : [rootDirs];
  const {
    minParentSegments = 1,
    includeCurrent = false,
    relativeBaseDir = roots[0],
    allowRelativePaths = new Set()
  } = options;
  const importPattern = relativeImportToPattern(targetDir, minParentSegments, { includeCurrent });
  return roots.flatMap((rootDir) =>
    listFiles(rootDir, (fileName) => fileName.endsWith(".ts"))
      .filter((filePath) => !allowRelativePaths.has(path.relative(relativeBaseDir, filePath)))
      .filter((filePath) => importPattern.test(fs.readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(relativeBaseDir, filePath))
  );
}

function isPathWithin(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveSourceImport(filePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const sourceSpecifier = specifier.endsWith(".js") ? `${specifier.slice(0, -".js".length)}.ts` : specifier;
  return path.resolve(path.dirname(filePath), sourceSpecifier);
}

function findRelativeImportSpecifiers(source) {
  const importPattern = /(?:from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']|import\s*["']([^"']+)["'])/g;
  const specifiers = [];
  let match;
  while ((match = importPattern.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function testInternalTestsUseDedicatedEntrypoints() {
  const legacyEntrypointPattern = /require\(["'](?:\.\.\/)+(?:dist\/index\.js|dist\/benchmarks\/index\.js)["']\)/;
  const offenders = listFiles(__dirname, (fileName) => fileName.endsWith(".cjs"))
    .filter((filePath) => path.basename(filePath) !== "public-api.test.cjs")
    .filter((filePath) => legacyEntrypointPattern.test(fs.readFileSync(filePath, "utf8")));

  assert.deepEqual(
    offenders.map((filePath) => path.relative(__dirname, filePath)),
    []
  );
}

function testBenchmarkToolingUsesBenchmarkApiBoundary() {
  const appsDir = path.join(__dirname, "..", "src", "apps");
  const toolsCliDir = path.join(__dirname, "..", "src", "tools", "cli");
  const benchmarkAppNamePattern = /(?:BenchmarkCli|learnedRankingLabelCli|experimentRegistryCli)\.ts$/;
  const legacyBenchmarkImportPattern = /\.\.\/benchmarks\/(?:index|experimentRegistry)\.js/;
  const appOffenders = listFiles(appsDir, (fileName) => benchmarkAppNamePattern.test(fileName));
  const toolImportOffenders = listFiles(toolsCliDir, (fileName) => fileName.endsWith(".ts")).filter((filePath) =>
    legacyBenchmarkImportPattern.test(fs.readFileSync(filePath, "utf8"))
  );

  assert.deepEqual(
    [...appOffenders, ...toolImportOffenders].map((filePath) => path.relative(path.join(__dirname, ".."), filePath)),
    []
  );
}

function testBenchmarkInternalsAreHiddenBehindBenchmarkApi() {
  const srcDir = path.join(__dirname, "..", "src");
  const benchmarkPackageDir = path.join(srcDir, "packages", "benchmarks");
  const benchmarkApiPath = path.join(srcDir, "benchmarkApi.ts");
  const offenders = listFiles(srcDir, (fileName) => fileName.endsWith(".ts"))
    .filter((filePath) => filePath !== benchmarkApiPath)
    .filter((filePath) => !isPathWithin(filePath, benchmarkPackageDir))
    .flatMap((filePath) => {
      const importTargets = findRelativeImportSpecifiers(fs.readFileSync(filePath, "utf8"))
        .map((specifier) => resolveSourceImport(filePath, specifier))
        .filter((targetPath) => targetPath && isPathWithin(targetPath, benchmarkPackageDir));
      return importTargets.map((targetPath) => ({
        importer: path.relative(srcDir, filePath),
        target: path.relative(srcDir, targetPath)
      }));
    });

  assert.deepEqual(offenders, []);
}

function testScriptEntrypointWrappersRemain() {
  const srcDir = path.join(__dirname, "..", "src");
  const expectedWrappers = new Map([
    ["cli.ts", ["/**", " * CLI entry point compatibility wrapper.", " */", "", `import "./apps/cli.js";`].join("\n")],
    [
      "webServer.ts",
      [
        "/**",
        " * Web server entry point compatibility wrapper.",
        " */",
        "",
        `import "./apps/planner-server/webServer.js";`
      ].join("\n")
    ],
    [
      "greedyBenchmarkCli.ts",
      [
        "/**",
        " * Greedy benchmark CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/greedyBenchmarkCli.js";`
      ].join("\n")
    ],
    [
      "cpSatBenchmarkCli.ts",
      [
        "/**",
        " * CP-SAT benchmark CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/cpSatBenchmarkCli.js";`
      ].join("\n")
    ],
    [
      "lnsBenchmarkCli.ts",
      [
        "/**",
        " * LNS benchmark CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/lnsBenchmarkCli.js";`
      ].join("\n")
    ],
    [
      "crossModeBenchmarkCli.ts",
      [
        "/**",
        " * Cross-mode benchmark scorecard CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/crossModeBenchmarkCli.js";`
      ].join("\n")
    ],
    [
      "learnedRankingLabelCli.ts",
      [
        "/**",
        " * Learned-ranking label CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/learnedRankingLabelCli.js";`
      ].join("\n")
    ],
    [
      "greedyOfflineRankerCli.ts",
      [
        "/**",
        " * Greedy offline ranker CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/greedyOfflineRankerCli.js";`
      ].join("\n")
    ],
    [
      "lnsWindowRankerBaselineCli.ts",
      [
        "/**",
        " * LNS window ranker baseline CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/lnsWindowRankerBaselineCli.js";`
      ].join("\n")
    ],
    [
      "lnsWindowRankerCli.ts",
      [
        "/**",
        " * LNS window ranker CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/lnsWindowRankerCli.js";`
      ].join("\n")
    ],
    [
      "experimentRegistryCli.ts",
      [
        "/**",
        " * Experiment registry CLI compatibility wrapper.",
        " */",
        "",
        `import "./tools/cli/experimentRegistryCli.js";`
      ].join("\n")
    ]
  ]);

  const offenders = [...expectedWrappers]
    .filter(([relativePath, expected]) => fs.readFileSync(path.join(srcDir, relativePath), "utf8").trim() !== expected)
    .map(([relativePath]) => relativePath);

  assert.deepEqual(offenders, []);
}

function testLegacyDeepImportWrappersAreRemoved() {
  const srcDir = path.join(__dirname, "..", "src");
  const legacyPaths = [
    "auto",
    "benchmarks",
    "core",
    "cp-sat",
    "greedy",
    "lns",
    "runtime",
    "server",
    path.join("apps", "webServer.ts")
  ];
  const existingPaths = legacyPaths.filter((relativePath) => fs.existsSync(path.join(srcDir, relativePath)));

  assert.deepEqual(existingPaths, []);
}

function testPlannerWebLivesInAppFolder() {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "apps", "planner-web", "index.html")), true);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "web")), false);
}

function testCorePackageDoesNotImportOutsidePackage() {
  const corePackageDir = path.join(__dirname, "..", "src", "packages", "core");
  const parentImportPattern = /(?:from|import\(|export\s+[^"']*\s+from)\s*["']\.\.\//;
  const offenders = listFiles(corePackageDir, (fileName) => fileName.endsWith(".ts")).filter((filePath) =>
    parentImportPattern.test(fs.readFileSync(filePath, "utf8"))
  );

  assert.deepEqual(
    offenders.map((filePath) => path.relative(corePackageDir, filePath)),
    []
  );
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
  const offenderRoots = [path.join(srcDir, "apps"), path.join(srcDir, "tools")];
  const offenders = findRelativeImportOffenders(offenderRoots, "core", { relativeBaseDir: srcDir });

  assert.deepEqual(offenders, []);
}

function testRuntimeAndServerUseCorePackageBoundary() {
  const srcDir = path.join(__dirname, "..", "src");
  const offenderRoots = [path.join(srcDir, "packages", "runtime"), path.join(srcDir, "apps", "planner-server")];
  const offenders = findRelativeImportOffenders(offenderRoots, "core", {
    minParentSegments: 3,
    relativeBaseDir: srcDir
  });

  assert.deepEqual(offenders, []);
}

function testSolversUseCorePackageBoundary() {
  const srcDir = path.join(__dirname, "..", "src");
  const solverPackageDir = path.join(srcDir, "packages", "solvers");
  const offenders = findRelativeImportOffenders(solverPackageDir, "core", {
    minParentSegments: 3,
    relativeBaseDir: srcDir
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
testScriptEntrypointWrappersRemain();
testLegacyDeepImportWrappersAreRemoved();
testPlannerWebLivesInAppFolder();
testCorePackageDoesNotImportOutsidePackage();
testSolverApiUsesCorePackageBoundary();
testBenchmarkPackageUsesCorePackageBoundary();
testAppsAndToolsUseCorePackageBoundary();
testRuntimeAndServerUseCorePackageBoundary();
testSolversUseCorePackageBoundary();
testSolverPackageDoesNotImportRuntimePackage();
