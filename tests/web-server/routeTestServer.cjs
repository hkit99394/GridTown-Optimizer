const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const { SolveJobManager } = require("../../dist/packages/runtime/jobs/solveJobManager.js");
const { createPlannerRequestHandler } = require("../../dist/apps/planner-server/http/requestHandler.js");

function createRouteTestHandler({
  webRoot = path.resolve(__dirname, "../../apps/planner-web"),
  progressLogRoot = undefined,
  progressLogRootPrefix = "planner-route-logs-",
  progressLogIntervalMs = 10,
  progressLogPollIntervalMs = 5,
  maxRunningSolves = undefined,
  completedJobRetentionMs = undefined
} = {}) {
  const resolvedProgressLogRoot = progressLogRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), progressLogRootPrefix));
  const solveJobManagerOptions = {
    progressLogRoot: resolvedProgressLogRoot,
    progressLogIntervalMs,
    progressLogPollIntervalMs
  };
  if (maxRunningSolves !== undefined) solveJobManagerOptions.maxRunningSolves = maxRunningSolves;
  if (completedJobRetentionMs !== undefined) solveJobManagerOptions.completedJobRetentionMs = completedJobRetentionMs;

  return {
    handler: createPlannerRequestHandler({
      webRoot,
      solveJobManager: new SolveJobManager(solveJobManagerOptions)
    }),
    progressLogRoot: resolvedProgressLogRoot
  };
}

function createMockRequest(method, url, body = "", headers = undefined) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = headers ?? (body ? { "content-type": "application/json" } : {});
  return stream;
}

function createMockResponse() {
  const response = new EventEmitter();
  response.statusCode = 0;
  response.headers = {};
  response.body = "";
  response.writableEnded = false;
  response.writeHead = function writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers ?? {};
  };
  response.end = function end(chunk) {
    this.writableEnded = true;
    if (chunk) {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    }
  };
  return response;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function waitForNextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function invoke(handler, { method = "GET", url = "/", json = undefined, body = undefined, headers = undefined }) {
  const payloadBody = json === undefined ? (body ?? "") : JSON.stringify(json);
  const req = createMockRequest(method, url, payloadBody, headers);
  const res = createMockResponse();
  await handler(req, res);
  let payload = null;
  if ((res.headers["Content-Type"] || res.headers["content-type"] || "").includes("application/json")) {
    payload = JSON.parse(res.body || "{}");
  }
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
    payload
  };
}

async function waitForSolve(handler, requestId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    if (result.payload.jobStatus !== "running") {
      return result.payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for solve ${requestId}`);
}

function buildTinySolvePayload() {
  return {
    grid: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ],
    params: {
      optimizer: "greedy",
      residentialTypes: [{ name: "Test Residence", w: 2, h: 2, min: 100, max: 100, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false }
    }
  };
}

function assertPlannerExplainabilityPayload(payload, grid) {
  assert.equal(payload.explainability.schemaVersion, 1);
  assert.equal(payload.explainability.rows, grid.length);
  assert.equal(payload.explainability.cols, grid[0].length);
  assert.equal(payload.explainability.cells.length, grid.length);
  assert.equal(payload.explainability.cells[0].length, grid[0].length);
  const firstCell = payload.explainability.cells[0][0];
  assert.equal(firstCell.r, 0);
  assert.equal(firstCell.c, 0);
  assert.equal(typeof firstCell.allowed, "boolean");
  assert.equal(typeof firstCell.roadAnchorReachable, "boolean");
  assert.equal(typeof firstCell.serviceValue, "number");
  assert.equal(typeof firstCell.residentialOpportunity, "number");
  assert.equal(typeof firstCell.connectivityDisconnectedCells, "number");
  assert.equal(typeof payload.explainability.roadAnchorReachableCellCount, "number");
}

function buildWarmStartHintFromSolution(solution, overrides = {}) {
  return {
    ...overrides,
    solution: {
      roads: Array.from(solution.roads),
      services: solution.services.map((service, index) => ({
        ...service,
        typeIndex: solution.serviceTypeIndices[index],
        bonus: solution.servicePopulationIncreases[index]
      })),
      residentials: solution.residentials.map((residential, index) => ({
        ...residential,
        typeIndex: solution.residentialTypeIndices[index],
        population: solution.populations[index]
      })),
      populations: [...solution.populations],
      totalPopulation: solution.totalPopulation
    }
  };
}

module.exports = {
  assertPlannerExplainabilityPayload,
  buildTinySolvePayload,
  buildWarmStartHintFromSolution,
  createDeferred,
  createMockRequest,
  createMockResponse,
  createRouteTestHandler,
  invoke,
  waitForNextTurn,
  waitForSolve
};
