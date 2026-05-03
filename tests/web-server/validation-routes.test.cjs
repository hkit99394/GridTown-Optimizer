const assert = require("node:assert/strict");

const optimizerRegistry = require("../../dist/packages/runtime/dispatch/optimizerRegistry.js");
const { SolverInputError } = require("../../dist/packages/core/solverInputValidation.js");
const { solve } = require("city-builder/solver");
const {
  buildTinySolvePayload,
  buildWarmStartHintFromSolution,
  createRouteTestHandler,
  invoke
} = require("./routeTestServer.cjs");

async function testJsonRoutesRejectNonJsonContentType(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: buildTinySolvePayload(),
    headers: {
      "content-type": "text/plain",
      host: "127.0.0.1:4173"
    }
  });

  assert.equal(result.statusCode, 415);
  assert.equal(result.payload.ok, false);
  assert.match(result.payload.error, /Content-Type: application\/json/);
}

async function testJsonRoutesRejectCrossOrigin(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: buildTinySolvePayload(),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:4173",
      origin: "https://example.invalid"
    }
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.ok, false);
  assert.match(result.payload.error, /cross-origin/);
}

async function testImmediateSolveRejectsInvalidLnsSeedHint(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {}
        }
      }
    }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Invalid solver input: LNS seed hint is missing the saved solution payload.");

  const { optimizer, ...paramsWithoutOptimizer } = solvePayload.params;
  assert.equal(optimizer, "greedy");
  const omittedOptimizerResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: {
      ...solvePayload,
      params: {
        ...paramsWithoutOptimizer,
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {}
        }
      }
    }
  });

  assert.equal(omittedOptimizerResult.statusCode, 400);
  assert.equal(omittedOptimizerResult.payload.ok, false);
  assert.equal(
    omittedOptimizerResult.payload.error,
    "Invalid solver input: LNS seed hint is missing the saved solution payload."
  );
}

async function testImmediateSolveRejectsMalformedLnsSeedFields(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: {
      ...solvePayload,
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {
            solution: {
              roads: [],
              services: [],
              residentials: [{ r: null, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 }],
              populations: [100],
              totalPopulation: 100
            }
          }
        }
      }
    }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(
    result.payload.error,
    "Invalid solver input: LNS seed hint solution.residentials[0].r must be an integer >= 0."
  );
}

async function testImmediateSolveRejectsStaleLnsSeedHintBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const reusableSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "lns",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Stale LNS seed should be rejected before starting the backend.");
      }
    };
  };

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "lns",
          lns: {
            iterations: 1,
            maxNoImprovementIterations: 1,
            neighborhoodRows: 2,
            neighborhoodCols: 2,
            seedHint: buildWarmStartHintFromSolution(reusableSolution, {
              modelFingerprint: "fnv1a:00000000"
            })
          }
        }
      }
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: LNS seed hint is stale for the current grid or building settings."
    );
    assert.equal(optimizerAdapterRequested, false);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsInvalidCpSatOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const reusableSolution = solve(solvePayload.grid, solvePayload.params);
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT input should be rejected before starting the backend.");
      }
    };
  };

  const cases = [
    {
      cpSat: { numWorkers: 0 },
      expectedError: "Invalid solver input: CP-SAT runtime option cpSat.numWorkers must be an integer between 1 and 64."
    },
    {
      cpSat: { randomSeed: 2147483648 },
      expectedError:
        "Invalid solver input: CP-SAT runtime option cpSat.randomSeed must be an integer between 0 and 2147483647."
    },
    {
      cpSat: { timeLimitSeconds: 86401 },
      expectedError:
        "Invalid solver input: CP-SAT runtime option cpSat.timeLimitSeconds must be a finite number > 0 and <= 86400."
    },
    {
      cpSat: { roadConnectivityMode: "single-root" },
      expectedError:
        "Invalid solver input: CP-SAT runtime option cpSat.roadConnectivityMode is no longer supported; CP-SAT always uses anchor-components road connectivity."
    },
    {
      cpSat: {
        numWorkers: 1,
        portfolio: {
          randomSeeds: [11, "bad"]
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.randomSeeds[1] must be an integer between 0 and 2147483647."
    },
    {
      cpSat: {
        numWorkers: 1,
        timeLimitSeconds: 30,
        portfolio: {
          randomSeeds: [2147483648]
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.randomSeeds[0] must be an integer between 0 and 2147483647."
    },
    {
      cpSat: {
        numWorkers: 1,
        timeLimitSeconds: 30,
        portfolio: {
          workerCount: 9
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.workerCount must be an integer between 1 and 8."
    },
    {
      cpSat: {
        numWorkers: 1,
        timeLimitSeconds: 30,
        portfolio: {
          randomSeeds: []
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.randomSeeds must contain between 1 and 8 seeds."
    },
    {
      cpSat: {
        numWorkers: 1,
        timeLimitSeconds: 30,
        portfolio: {
          randomSeeds: [11, 11]
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.randomSeeds must not contain duplicate seeds."
    },
    {
      cpSat: {
        numWorkers: 1,
        portfolio: {
          workerCount: 2,
          totalCpuBudgetSeconds: 60
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.totalCpuBudgetSeconds requires cpSat.timeLimitSeconds or CP-SAT portfolio option cpSat.portfolio.perWorkerTimeLimitSeconds."
    },
    {
      cpSat: {
        numWorkers: 1,
        portfolio: {
          workerCount: 4,
          perWorkerNumWorkers: 3,
          perWorkerTimeLimitSeconds: 30
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio requests 12 parallel CP-SAT workers, exceeding the 8 worker portfolio limit."
    },
    {
      cpSat: {
        numWorkers: 1,
        portfolio: {
          workerCount: 8,
          perWorkerNumWorkers: 1,
          perWorkerTimeLimitSeconds: 4000
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT portfolio option cpSat.portfolio requests 32000 total CPU seconds, exceeding the 28800 second portfolio budget."
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: buildWarmStartHintFromSolution(reusableSolution, {
          modelFingerprint: "fnv1a:00000000"
        })
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint is stale for the current grid or building settings."
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: {
          roadKeys: ["0,0"],
          serviceCandidateKeys: [],
          residentialCandidateKeys: []
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.modelFingerprint is required for hint-only reusable payloads."
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: {
          solution: {
            roads: [],
            services: [],
            residentials: [{ r: 0, c: 0, rows: 2, cols: 2, population: 100 }],
            populations: [100],
            totalPopulation: 100
          }
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution.residentials[0].typeIndex must be an integer >= -1."
    },
    {
      cpSat: {
        numWorkers: 1,
        warmStartHint: {
          solution: {
            roads: [],
            services: [],
            residentials: [{ r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 }],
            populations: [100],
            totalPopulation: 100
          }
        }
      },
      expectedError:
        "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution is invalid: Road network does not touch row 0 or column 0."
    }
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            optimizer: "cp-sat",
            cpSat: testCase.cpSat
          }
        }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }

    for (const optimizer of ["auto", "lns"]) {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            optimizer,
            cpSat: {
              timeLimitSeconds: 30,
              portfolio: {
                workerCount: 2,
                perWorkerNumWorkers: 1
              }
            }
          }
        }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(
        result.payload.error,
        'Invalid solver input: CP-SAT portfolio option cpSat.portfolio is only supported when optimizer is "cp-sat".'
      );
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolveRejectsInvalidGreedyOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "greedy",
      solve() {
        throw new Error("Immediate solves should use the non-blocking background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid greedy input should be rejected before starting the backend.");
      }
    };
  };

  const cases = [
    {
      greedy: "fast",
      expectedError: "Invalid solver input: Greedy options greedy must be an object."
    },
    {
      greedy: { restarts: 0 },
      expectedError: "Invalid solver input: Greedy option greedy.restarts must be an integer between 1 and 100."
    },
    {
      greedy: { serviceLookaheadCandidates: "many" },
      expectedError:
        "Invalid solver input: Greedy option greedy.serviceLookaheadCandidates must be an integer between 0 and 2000."
    },
    {
      greedy: { timeLimitSeconds: 0 },
      expectedError:
        "Invalid solver input: Greedy option greedy.timeLimitSeconds must be a finite number > 0 and <= 86400."
    },
    {
      greedy: { diagnostics: "yes" },
      expectedError: "Invalid solver input: Greedy option greedy.diagnostics must be a boolean."
    }
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: "/api/solve",
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            greedy: testCase.greedy
          }
        }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testSolveRoutesRejectInvalidAutoOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "auto",
      solve() {
        throw new Error("Invalid auto input should be rejected before starting the backend.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid auto input should be rejected before starting the backend.");
      }
    };
  };

  const cases = [
    {
      url: "/api/solve",
      auto: "fast",
      expectedError: "Invalid solver input: Auto options auto must be an object."
    },
    {
      url: "/api/solve/start",
      auto: { wallClockLimitSeconds: 0 },
      expectedError:
        "Invalid solver input: Auto option auto.wallClockLimitSeconds must be a finite number > 0 and <= 86400."
    },
    {
      url: "/api/solve/start",
      auto: { weakCycleImprovementThreshold: -0.1 },
      expectedError:
        "Invalid solver input: Auto option auto.weakCycleImprovementThreshold must be a finite number >= 0 and <= 1."
    },
    {
      url: "/api/solve",
      auto: { maxConsecutiveWeakCycles: 0 },
      expectedError:
        "Invalid solver input: Auto option auto.maxConsecutiveWeakCycles must be an integer between 1 and 100."
    },
    {
      url: "/api/solve",
      auto: { cpSatStageTimeLimitSeconds: "30" },
      expectedError:
        "Invalid solver input: Auto option auto.cpSatStageTimeLimitSeconds must be a finite number > 0 and <= 86400."
    },
    {
      url: "/api/solve",
      auto: { cpSatStageReserveRatio: 2 },
      expectedError:
        "Invalid solver input: Auto option auto.cpSatStageReserveRatio must be a finite number >= 0 and <= 1."
    }
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: testCase.url,
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            optimizer: "auto",
            auto: testCase.auto
          }
        }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testSolveRoutesRejectInvalidLnsOptionsBeforeStartingBackend(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "lns",
      solve() {
        throw new Error("Invalid LNS input should be rejected before starting the backend.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid LNS input should be rejected before starting the backend.");
      }
    };
  };

  const cases = [
    {
      url: "/api/solve",
      lns: "repair",
      expectedError: "Invalid solver input: LNS options lns must be an object."
    },
    {
      url: "/api/solve/start",
      lns: { iterations: 0 },
      expectedError: "Invalid solver input: LNS option lns.iterations must be an integer between 1 and 10000."
    },
    {
      url: "/api/solve",
      lns: { wallClockLimitSeconds: 0 },
      expectedError:
        "Invalid solver input: LNS option lns.wallClockLimitSeconds must be a finite number > 0 and <= 86400."
    },
    {
      url: "/api/solve/start",
      lns: { stopFilePath: false },
      expectedError: "Invalid solver input: LNS runtime option lns.stopFilePath must be a string."
    }
  ];

  try {
    for (const testCase of cases) {
      const result = await invoke(handler, {
        method: "POST",
        url: testCase.url,
        json: {
          ...solvePayload,
          params: {
            ...solvePayload.params,
            optimizer: "lns",
            lns: testCase.lns
          }
        }
      });

      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.ok, false);
      assert.equal(result.payload.error, testCase.expectedError);
      assert.equal(optimizerAdapterRequested, false);
    }
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testImmediateSolvePreservesTypedSolverInputErrors(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;

  optimizerRegistry.getOptimizerAdapter = () => ({
    name: "lns",
    solve() {
      throw new Error("Immediate solves should use the non-blocking background adapter.");
    },
    startBackgroundSolve() {
      const error = new SolverInputError("Simulated typed validation failure.");
      error.message = "Simulated typed validation failure.";
      return {
        promise: Promise.reject(error),
        cancel() {},
        getLatestSnapshot() {
          return null;
        },
        getLatestSnapshotState() {
          return {
            hasFeasibleSolution: false,
            totalPopulation: null
          };
        }
      };
    }
  });

  try {
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve",
      json: {
        ...solvePayload,
        params: {
          ...solvePayload.params,
          optimizer: "lns",
          lns: {
            iterations: 1,
            maxNoImprovementIterations: 1,
            neighborhoodRows: 2,
            neighborhoodCols: 2
          }
        }
      }
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "Simulated typed validation failure.");
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidLnsSeedHint(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId: "invalid-lns-seed",
      params: {
        ...solvePayload.params,
        optimizer: "lns",
        lns: {
          iterations: 1,
          maxNoImprovementIterations: 1,
          neighborhoodRows: 2,
          neighborhoodCols: 2,
          seedHint: {}
        }
      }
    }
  });

  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Invalid solver input: LNS seed hint is missing the saved solution payload.");
}

async function testStartSolveRejectsInvalidCpSatOptionsBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT input should be rejected before starting a solve job.");
      }
    };
  };

  try {
    const requestId = "invalid-cp-sat-options";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat",
          cpSat: {
            numWorkers: 1,
            portfolio: {
              perWorkerNumWorkers: 0
            }
          }
        }
      }
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: CP-SAT portfolio option cpSat.portfolio.perWorkerNumWorkers must be an integer between 1 and 64."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidCpSatWarmStartBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "cp-sat",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid CP-SAT warm start should be rejected before starting a solve job.");
      }
    };
  };

  try {
    const requestId = "invalid-cp-sat-reusable-layout";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          optimizer: "cp-sat",
          cpSat: {
            numWorkers: 1,
            warmStartHint: {
              solution: {
                roads: [],
                services: [],
                residentials: [{ r: 0, c: 0, rows: 2, cols: 2, typeIndex: 0, population: 100 }],
                populations: [100],
                totalPopulation: 100
              }
            }
          }
        }
      }
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: CP-SAT warm-start hint cpSat.warmStartHint.solution is invalid: Road network does not touch row 0 or column 0."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function testStartSolveRejectsInvalidGreedyOptionsBeforeStartingJob(handler) {
  const solvePayload = buildTinySolvePayload();
  const originalGetOptimizerAdapter = optimizerRegistry.getOptimizerAdapter;
  let optimizerAdapterRequested = false;

  optimizerRegistry.getOptimizerAdapter = () => {
    optimizerAdapterRequested = true;
    return {
      name: "greedy",
      solve() {
        throw new Error("Background solve route test should use the background adapter.");
      },
      startBackgroundSolve() {
        throw new Error("Invalid greedy input should be rejected before starting a solve job.");
      }
    };
  };

  try {
    const requestId = "invalid-greedy-options";
    const result = await invoke(handler, {
      method: "POST",
      url: "/api/solve/start",
      json: {
        ...solvePayload,
        requestId,
        params: {
          ...solvePayload.params,
          serviceExactMaxCombinations: 0
        }
      }
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(
      result.payload.error,
      "Invalid solver input: Legacy greedy option serviceExactMaxCombinations must be an integer between 1 and 100000."
    );
    assert.equal(optimizerAdapterRequested, false);

    const statusResult = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
    });
    assert.equal(statusResult.statusCode, 404);
  } finally {
    optimizerRegistry.getOptimizerAdapter = originalGetOptimizerAdapter;
  }
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testJsonRoutesRejectNonJsonContentType(handler);
  await testJsonRoutesRejectCrossOrigin(handler);
  await testImmediateSolveRejectsInvalidLnsSeedHint(handler);
  await testImmediateSolveRejectsMalformedLnsSeedFields(handler);
  await testImmediateSolveRejectsStaleLnsSeedHintBeforeStartingBackend(handler);
  await testImmediateSolveRejectsInvalidCpSatOptionsBeforeStartingBackend(handler);
  await testImmediateSolveRejectsInvalidGreedyOptionsBeforeStartingBackend(handler);
  await testSolveRoutesRejectInvalidAutoOptionsBeforeStartingBackend(handler);
  await testSolveRoutesRejectInvalidLnsOptionsBeforeStartingBackend(handler);
  await testImmediateSolvePreservesTypedSolverInputErrors(handler);
  await testStartSolveRejectsInvalidLnsSeedHint(handler);
  await testStartSolveRejectsInvalidCpSatOptionsBeforeStartingJob(handler);
  await testStartSolveRejectsInvalidCpSatWarmStartBeforeStartingJob(handler);
  await testStartSolveRejectsInvalidGreedyOptionsBeforeStartingJob(handler);

  console.log("Web server validation route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
