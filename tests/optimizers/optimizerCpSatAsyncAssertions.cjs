const {
  assert,
  childProcess,
  fs,
  os,
  path,
  solveAsync,
  solveGreedy,
  solveCpSatAsync,
  startCpSatSolve,
  delay,
  resolveCpSatPython,
  waitForFile
} = require("./optimizerHarnessDeps.cjs");

async function maybeTestCpSatWarmStartContinuation() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    serviceTypes: [{ rows: 1, cols: 1, bonus: 30, range: 1, avail: 1 }],
    residentialTypes: [{ w: 2, h: 2, min: 10, max: 40, avail: 1 }],
    availableBuildings: { services: 1, residentials: 1 },
    greedy: { localSearch: false, restarts: 1 }
  };

  const seed = solveGreedy(grid, params);
  const continued = await solveCpSatAsync(grid, {
    ...params,
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1,
      randomSeed: 7,
      warmStartHint: seed,
      objectiveLowerBound: seed.totalPopulation
    }
  });

  assert.match(continued.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert(continued.totalPopulation >= seed.totalPopulation);
}

function maybeTestCpSatPortfolioOptionHelpers() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_solver.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_solver", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

worker_options = module.build_portfolio_worker_options({
    "timeLimitSeconds": 12,
    "maxDeterministicTime": 6,
    "numWorkers": 8,
    "logSearchProgress": True,
    "stopFilePath": "/tmp/shared-stop-token",
    "snapshotFilePath": "/tmp/shared-snapshot.json",
    "portfolio": {
        "randomSeeds": [7, 9],
        "perWorkerTimeLimitSeconds": 2,
        "perWorkerMaxDeterministicTime": 1.5,
        "perWorkerNumWorkers": 1,
        "randomizeSearch": True,
    }
})

print(json.dumps(worker_options))
`;

  const result = childProcess.spawnSync(pythonExecutable, ["-c", command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT portfolio option helpers."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.length, 2);
  assert.deepEqual(
    payload.map((worker) => ({
      randomSeed: worker.randomSeed,
      timeLimitSeconds: worker.timeLimitSeconds,
      maxDeterministicTime: worker.maxDeterministicTime,
      numWorkers: worker.numWorkers,
      randomizeSearch: worker.randomizeSearch,
      logSearchProgress: worker.logSearchProgress,
      stopFilePath: worker.stopFilePath,
      hasSnapshotFilePath: Object.prototype.hasOwnProperty.call(worker, "snapshotFilePath"),
      hasPortfolio: Object.prototype.hasOwnProperty.call(worker, "portfolio")
    })),
    [
      {
        randomSeed: 7,
        timeLimitSeconds: 2,
        maxDeterministicTime: 1.5,
        numWorkers: 1,
        randomizeSearch: true,
        logSearchProgress: false,
        stopFilePath: "/tmp/shared-stop-token",
        hasSnapshotFilePath: false,
        hasPortfolio: false
      },
      {
        randomSeed: 9,
        timeLimitSeconds: 2,
        maxDeterministicTime: 1.5,
        numWorkers: 1,
        randomizeSearch: true,
        logSearchProgress: false,
        stopFilePath: "/tmp/shared-stop-token",
        hasSnapshotFilePath: false,
        hasPortfolio: false
      }
    ]
  );
}

function testCpSatPortfolioExecutorFallbackHelpers() {
  const scriptPath = path.resolve(__dirname, "../../python/cp_sat_portfolio_support.py");
  const command = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("cp_sat_portfolio_support", ${JSON.stringify(scriptPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RaisingProcessExecutor:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, *args, **kwargs):
        raise PermissionError("process pool blocked")

class FakeFuture:
    def __init__(self, value):
        self._value = value
    def result(self):
        return self._value

class FakeThreadExecutor:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, fn, *args, **kwargs):
        return FakeFuture(fn(*args, **kwargs))

module.concurrent.futures.ProcessPoolExecutor = RaisingProcessExecutor
module.concurrent.futures.ThreadPoolExecutor = FakeThreadExecutor
module.concurrent.futures.as_completed = lambda futures: futures

results = module.run_portfolio_workers(
    [[1]],
    {"optimizer": "cp-sat"},
    [{"randomSeed": 7}, {"randomSeed": 9}],
    lambda grid, params, worker_option, worker_index: {"workerIndex": worker_index, "seed": worker_option["randomSeed"]},
)

class BrokenProcessExecutor:
    def __init__(self, *args, **kwargs):
        pass
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, *args, **kwargs):
        raise module.BrokenProcessPool("process pool broke")

module.concurrent.futures.ProcessPoolExecutor = BrokenProcessExecutor

broken_results = module.run_portfolio_workers(
    [[1]],
    {"optimizer": "cp-sat"},
    [{"randomSeed": 13}],
    lambda grid, params, worker_option, worker_index: {"workerIndex": worker_index, "seed": worker_option["randomSeed"]},
)

class OrderedFuture:
    def __init__(self, value=None, error=None):
        self._value = value
        self._error = error
        self.cancelled = False
    def result(self):
        if self._error is not None:
            raise self._error
        return self._value
    def cancel(self):
        self.cancelled = True
        return True

class FutureFailureAfterProgressExecutor:
    futures = []
    def __init__(self, *args, **kwargs):
        FutureFailureAfterProgressExecutor.futures = []
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc, tb):
        return False
    def submit(self, fn, *args, **kwargs):
        if len(FutureFailureAfterProgressExecutor.futures) == 0:
            future = OrderedFuture(fn(*args, **kwargs))
        else:
            future = OrderedFuture(error=RuntimeError("worker future failed after sibling progress"))
        FutureFailureAfterProgressExecutor.futures.append(future)
        return future

module.concurrent.futures.ProcessPoolExecutor = FutureFailureAfterProgressExecutor
progress_results = []
try:
    module.run_portfolio_workers(
        [[1]],
        {"optimizer": "cp-sat"},
        [{"randomSeed": 21}, {"randomSeed": 22}],
        lambda grid, params, worker_option, worker_index: {"workerIndex": worker_index, "seed": worker_option["randomSeed"]},
        on_result=lambda result: progress_results.append(result),
    )
    future_failure_error = None
except RuntimeError as error:
    future_failure_error = str(error)
future_failure_cancelled = [future.cancelled for future in FutureFailureAfterProgressExecutor.futures]

unlimited_worker_options = module.build_portfolio_worker_options({"portfolio": {"workerCount": 2}})
unlimited_worker_has_time_limit = ["timeLimitSeconds" in option for option in unlimited_worker_options]

try:
    module.build_portfolio_worker_options({"portfolio": {"workerCount": 2, "totalCpuBudgetSeconds": 60}})
    missing_budget_error = None
except ValueError as error:
    missing_budget_error = str(error)

try:
    module.build_portfolio_worker_options({
        "portfolio": {
            "workerCount": 4,
            "perWorkerNumWorkers": 3,
            "perWorkerTimeLimitSeconds": 30,
        }
    })
    worker_thread_error = None
except ValueError as error:
    worker_thread_error = str(error)

try:
    module.build_portfolio_worker_options({
        "portfolio": {
            "workerCount": 8,
            "perWorkerNumWorkers": 1,
            "perWorkerTimeLimitSeconds": 4000,
        }
    })
    cpu_budget_error = None
except ValueError as error:
    cpu_budget_error = str(error)

try:
    module.build_portfolio_worker_options({
        "timeLimitSeconds": 10,
        "portfolio": {
            "randomSeeds": [1, 2, 3, 4, 5, 6, 7, 8, 9],
        }
    })
    too_many_seeds_error = None
except ValueError as error:
    too_many_seeds_error = str(error)

try:
    module.build_portfolio_worker_options({
        "timeLimitSeconds": 10,
        "portfolio": {
            "randomSeeds": [11, 11],
        }
    })
    duplicate_seeds_error = None
except ValueError as error:
    duplicate_seeds_error = str(error)

print(json.dumps({
    "results": results,
    "brokenResults": broken_results,
    "futureFailureProgress": progress_results,
    "futureFailureError": future_failure_error,
    "futureFailureCancelled": future_failure_cancelled,
    "unlimitedWorkerHasTimeLimit": unlimited_worker_has_time_limit,
    "missingBudgetError": missing_budget_error,
    "workerThreadError": worker_thread_error,
    "cpuBudgetError": cpu_budget_error,
    "tooManySeedsError": too_many_seeds_error,
    "duplicateSeedsError": duplicate_seeds_error,
}))
`;

  const result = childProcess.spawnSync("python3", ["-c", command], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || result.stdout?.trim() || "Failed to inspect CP-SAT portfolio fallback helpers."
    );
  }

  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.results, [
    { workerIndex: 0, seed: 7 },
    { workerIndex: 1, seed: 9 }
  ]);
  assert.deepEqual(payload.brokenResults, [{ workerIndex: 0, seed: 13 }]);
  assert.deepEqual(payload.futureFailureProgress, [{ workerIndex: 0, seed: 21 }]);
  assert.match(payload.futureFailureError, /worker future failed after sibling progress/);
  assert.deepEqual(payload.futureFailureCancelled, [true, true]);
  assert.deepEqual(payload.unlimitedWorkerHasTimeLimit, [false, false]);
  assert.match(payload.missingBudgetError, /totalCpuBudgetSeconds requires timeLimitSeconds/);
  assert.match(payload.workerThreadError, /exceeding the 8 worker portfolio limit/);
  assert.match(payload.cpuBudgetError, /exceeding the 28800\.0 second portfolio budget/);
  assert.match(payload.tooManySeedsError, /must contain between 1 and 8 seeds/);
  assert.match(payload.duplicateSeedsError, /must not contain duplicate seeds/);
}

async function testCpSatAsyncRejectsMalformedStreamedProgress() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-cp-sat-malformed-stream-"));
  const scriptPath = path.join(tempDir, "malformed-progress.cjs");
  fs.writeFileSync(
    scriptPath,
    `
process.stdin.resume();
process.stdout.write(JSON.stringify({ event: "progress", kind: "not-a-progress-kind" }) + "\\n");
setInterval(() => {}, 1000);
`,
    "utf8"
  );

  try {
    await assert.rejects(
      () =>
        solveCpSatAsync(
          [[1]],
          {
            optimizer: "cp-sat",
            cpSat: {
              pythonExecutable: process.execPath,
              scriptPath,
              streamProgress: true
            },
            residentialTypes: [{ w: 1, h: 1, min: 1, max: 1, avail: 1 }],
            availableBuildings: { residentials: 1, services: 0 }
          },
          {
            onProgress: () => {}
          }
        ),
      /progress.kind must be a known progress kind/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testCpSatAsyncRejectsStreamedProgressWithoutFinalResult() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-cp-sat-no-final-stream-"));
  const scriptPath = path.join(tempDir, "no-final-result.cjs");
  fs.writeFileSync(
    scriptPath,
    `
process.stdin.resume();
process.stdout.write(JSON.stringify({
  event: "progress",
  kind: "bound",
  telemetry: {
    solveWallTimeSeconds: 0.1,
    userTimeSeconds: 0.1,
    solutionCount: 0,
    incumbentObjectiveValue: null,
    bestObjectiveBound: 10,
    objectiveGap: null,
    incumbentPopulation: null,
    bestPopulationUpperBound: 10,
    populationGapUpperBound: null,
    lastImprovementAtSeconds: null,
    secondsSinceLastImprovement: null,
    numBranches: 1,
    numConflicts: 0,
    modelSize: null
  }
}) + "\\n");
`,
    "utf8"
  );
  const progressUpdates = [];

  try {
    await assert.rejects(
      () =>
        solveCpSatAsync(
          [[1]],
          {
            optimizer: "cp-sat",
            cpSat: {
              pythonExecutable: process.execPath,
              scriptPath,
              streamProgress: true
            },
            residentialTypes: [{ w: 1, h: 1, min: 1, max: 1, avail: 1 }],
            availableBuildings: { residentials: 1, services: 0 }
          },
          {
            onProgress: (update) => progressUpdates.push(update)
          }
        ),
      /CP-SAT backend returned streamed progress without a final result payload/
    );
    assert.equal(progressUpdates.length, 1);
    assert.equal(progressUpdates[0].kind, "bound");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testCpSatAsyncRejectsChildProcessFailureWithDiagnostics() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-cp-sat-child-failure-"));
  const scriptPath = path.join(tempDir, "child-failure.cjs");
  fs.writeFileSync(
    scriptPath,
    `
const fs = require("node:fs");
process.stdin.resume();
fs.writeSync(1, "partial stdout");
fs.writeSync(2, "child exploded");
process.exit(3);
`,
    "utf8"
  );

  try {
    await assert.rejects(
      () =>
        solveCpSatAsync([[1]], {
          optimizer: "cp-sat",
          cpSat: {
            pythonExecutable: process.execPath,
            scriptPath
          },
          residentialTypes: [{ w: 1, h: 1, min: 1, max: 1, avail: 1 }],
          availableBuildings: { residentials: 1, services: 0 }
        }),
      /CP-SAT backend failed with exit code 3\. stderr: child exploded stdout: partial stdout/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function waitForCpSatSnapshotState(handle, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (handle.getLatestSnapshotState().hasFeasibleSolution) return;
    await delay(20);
  }
  assert.fail("Timed out waiting for CP-SAT snapshot state.");
}

async function testCpSatBackgroundCancelReturnsPortfolioSnapshot() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-cp-sat-portfolio-snapshot-"));
  const scriptPath = path.join(tempDir, "portfolio-snapshot.cjs");
  fs.writeFileSync(
    scriptPath,
    `
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const request = JSON.parse(input || "{}");
  const cpSat = request.params.cpSat;
  const snapshot = {
    roads: ["0,0"],
    services: [],
    residentials: [],
    populations: [],
    totalPopulation: 0,
    status: "FEASIBLE",
    portfolio: {
      workerCount: 2,
      selectedWorkerIndex: 0,
      workers: [
        {
          workerIndex: 0,
          randomSeed: 7,
          randomizeSearch: true,
          numWorkers: 1,
          status: "FEASIBLE",
          feasible: true,
          totalPopulation: 0,
          telemetry: null
        },
        {
          workerIndex: 1,
          randomSeed: 8,
          randomizeSearch: true,
          numWorkers: 1,
          status: "RUNNING",
          feasible: false,
          totalPopulation: null,
          telemetry: null
        }
      ]
    }
  };
  fs.writeFileSync(cpSat.snapshotFilePath, JSON.stringify(snapshot));
  const interval = setInterval(() => {
    if (fs.existsSync(cpSat.stopFilePath)) {
      clearInterval(interval);
      process.exit(2);
    }
  }, 10);
});
`,
    "utf8"
  );

  try {
    const handle = startCpSatSolve([[1]], {
      optimizer: "cp-sat",
      cpSat: {
        pythonExecutable: process.execPath,
        scriptPath,
        portfolio: {
          workerCount: 2,
          perWorkerTimeLimitSeconds: 1
        }
      },
      residentialTypes: [],
      serviceTypes: [],
      availableBuildings: { residentials: 0, services: 0 }
    });

    await waitForCpSatSnapshotState(handle);
    handle.cancel();
    const solution = await handle.promise;
    assert.equal(solution.optimizer, "cp-sat");
    assert.equal(solution.stoppedByUser, true);
    assert.equal(solution.cpSatStatus, "FEASIBLE");
    assert.equal(solution.cpSatPortfolio.workerCount, 2);
    assert.equal(solution.cpSatPortfolio.selectedWorkerIndex, 0);
    assert.equal(solution.cpSatPortfolio.workers[1].status, "RUNNING");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testCpSatAsyncRejectsMalformedPortfolioProgressAndStopsBackend() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "city-builder-cp-sat-progress-"));
  const scriptPath = path.join(tempDir, "malformed-portfolio-progress.cjs");
  const terminatedPath = path.join(tempDir, "terminated.txt");

  fs.writeFileSync(
    scriptPath,
    `
const fs = require("node:fs");
const terminatedPath = ${JSON.stringify(terminatedPath)};
let input = "";

process.on("SIGTERM", () => {
  fs.writeFileSync(terminatedPath, "terminated\\n");
  process.exit(0);
});

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  JSON.parse(input || "{}");
  process.stdout.write(JSON.stringify({
    event: "progress",
    kind: "portfolio-worker-complete",
    worker: {
      workerIndex: "0",
      randomSeed: 17,
      randomizeSearch: true,
      numWorkers: 1,
      status: "FEASIBLE",
      feasible: true,
      totalPopulation: 10,
      telemetry: null,
    },
  }) + "\\n");
  setInterval(() => {}, 1000);
});
`,
    "utf8"
  );

  const progressUpdates = [];

  try {
    await assert.rejects(
      () =>
        solveCpSatAsync(
          [
            [1, 1],
            [1, 1]
          ],
          {
            optimizer: "cp-sat",
            cpSat: {
              pythonExecutable: process.execPath,
              scriptPath,
              streamProgress: true,
              progressIntervalSeconds: 0
            }
          },
          {
            onProgress: (update) => progressUpdates.push(update),
            progressIntervalSeconds: 0
          }
        ),
      /CP-SAT backend returned invalid JSON: portfolio\.workers\[0\]\.workerIndex must be an integer/
    );

    assert.deepEqual(progressUpdates, []);
    await waitForFile(terminatedPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function maybeTestCpSatPortfolioSolve() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const solution = await solveCpSatAsync(grid, {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      portfolio: {
        randomSeeds: [3, 11],
        perWorkerTimeLimitSeconds: 2,
        perWorkerNumWorkers: 1
      }
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 }
  });

  assert.match(solution.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(solution.totalPopulation, 110);
  assert.equal(solution.cpSatPortfolio?.workerCount, 2);
  assert.equal(solution.cpSatPortfolio?.workers.length, 2);
  assert.equal(typeof solution.cpSatPortfolio?.selectedWorkerIndex, "number");
  assert(solution.cpSatPortfolio?.workers.some((worker) => worker.feasible));
  assert(
    solution.cpSatPortfolio?.workers.some(
      (worker) => worker.workerIndex === solution.cpSatPortfolio?.selectedWorkerIndex
    )
  );
}

async function maybeTestCpSatAsyncOptimizer() {
  const pythonExecutable = resolveCpSatPython();
  if (!pythonExecutable) {
    return;
  }

  const grid = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 1, 1]
  ];
  const params = {
    optimizer: "cp-sat",
    cpSat: {
      pythonExecutable,
      timeLimitSeconds: 5,
      numWorkers: 1
    },
    residentialTypes: [
      { w: 2, h: 2, min: 10, max: 10, avail: 1 },
      { w: 2, h: 2, min: 100, max: 100, avail: 1 }
    ],
    availableBuildings: { residentials: 2, services: 0 }
  };

  const progressUpdates = [];
  const dispatched = await solveAsync(grid, params, {
    onProgress: (update) => progressUpdates.push(update),
    progressIntervalSeconds: 0
  });
  const direct = await solveCpSatAsync(grid, params, {
    onProgress: (update) => progressUpdates.push(update),
    progressIntervalSeconds: 0
  });

  assert.match(dispatched.cpSatStatus ?? "", /^(OPTIMAL|FEASIBLE)$/);
  assert.equal(dispatched.totalPopulation, 110);
  assert.equal(direct.totalPopulation, 110);
  assert(progressUpdates.length > 0);
  assert(progressUpdates.some((update) => update.kind === "incumbent" || update.kind === "bound"));
}

module.exports = {
  maybeTestCpSatWarmStartContinuation,
  maybeTestCpSatPortfolioOptionHelpers,
  testCpSatPortfolioExecutorFallbackHelpers,
  testCpSatAsyncRejectsMalformedStreamedProgress,
  testCpSatAsyncRejectsStreamedProgressWithoutFinalResult,
  testCpSatAsyncRejectsChildProcessFailureWithDiagnostics,
  waitForCpSatSnapshotState,
  testCpSatBackgroundCancelReturnsPortfolioSnapshot,
  testCpSatAsyncRejectsMalformedPortfolioProgressAndStopsBackend,
  maybeTestCpSatPortfolioSolve,
  maybeTestCpSatAsyncOptimizer
};
