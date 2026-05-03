const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const { SolveJobManager } = require("../../dist/packages/runtime/jobs/solveJobManager.js");
const { createPlannerRequestHandler } = require("../../dist/apps/planner-server/http/requestHandler.js");

/**
 * @typedef {import("node:http").IncomingHttpHeaders} IncomingHttpHeaders
 * @typedef {Record<string, string | string[] | number | undefined>} HeaderMap
 * @typedef {import("../../dist/packages/core/index.js").Grid} Grid
 * @typedef {import("../../dist/packages/core/index.js").SolverParams} SolverParams
 */

/**
 * @callback WriteHead
 * @param {number} statusCode
 * @param {HeaderMap} [headers]
 * @returns {void}
 */

/**
 * @callback EndResponse
 * @param {string | Buffer} [chunk]
 * @returns {void}
 */

/**
 * @callback RouteTestHandler
 * @param {MockRequest} req
 * @param {MockResponse} res
 * @returns {void | Promise<void>}
 */

/**
 * @typedef {object} MockRequestFields
 * @property {string} method
 * @property {string} url
 * @property {IncomingHttpHeaders} headers
 */

/**
 * @typedef {Readable & MockRequestFields} MockRequest
 */

/**
 * @typedef {object} MockResponseFields
 * @property {number} statusCode
 * @property {HeaderMap} headers
 * @property {string} body
 * @property {boolean} writableEnded
 * @property {WriteHead} writeHead
 * @property {EndResponse} end
 */

/**
 * @typedef {EventEmitter & MockResponseFields} MockResponse
 */

/**
 * @typedef {object} SolveJobManagerOptions
 * @property {string} progressLogRoot
 * @property {number} progressLogIntervalMs
 * @property {number} progressLogPollIntervalMs
 * @property {number} [maxRunningSolves]
 * @property {number} [completedJobRetentionMs]
 */

/**
 * @typedef {object} RouteTestHandlerOptions
 * @property {string} [webRoot]
 * @property {string} [progressLogRoot]
 * @property {string} [progressLogRootPrefix]
 * @property {number} [progressLogIntervalMs]
 * @property {number} [progressLogPollIntervalMs]
 * @property {number} [maxRunningSolves]
 * @property {number} [completedJobRetentionMs]
 */

/**
 * @typedef {object} InvokeOptions
 * @property {string} [method]
 * @property {string} [url]
 * @property {unknown} [json]
 * @property {string} [body]
 * @property {IncomingHttpHeaders} [headers]
 */

/**
 * @typedef {object} InvokeResult
 * @property {number} statusCode
 * @property {HeaderMap} headers
 * @property {string} body
 * @property {any} payload
 */

/**
 * @typedef {object} ExplainabilityCell
 * @property {number} r
 * @property {number} c
 * @property {boolean} allowed
 * @property {boolean} roadAnchorReachable
 * @property {number} serviceValue
 * @property {number} residentialOpportunity
 * @property {number} connectivityDisconnectedCells
 */

/**
 * @typedef {object} PlannerExplainabilityPayload
 * @property {{ schemaVersion: number, rows: number, cols: number, cells: ExplainabilityCell[][], roadAnchorReachableCellCount: number }} explainability
 */

/**
 * @typedef {object} SolutionLike
 * @property {Iterable<unknown>} roads
 * @property {Array<Record<string, unknown>>} services
 * @property {number[]} serviceTypeIndices
 * @property {number[]} servicePopulationIncreases
 * @property {Array<Record<string, unknown>>} residentials
 * @property {number[]} residentialTypeIndices
 * @property {number[]} populations
 * @property {number} totalPopulation
 */

/**
 * @typedef {object} TinySolvePayload
 * @property {Grid} grid
 * @property {SolverParams & { residentialTypes: NonNullable<SolverParams["residentialTypes"]> }} params
 */

/**
 * @param {RouteTestHandlerOptions} [options]
 * @returns {{ handler: RouteTestHandler, progressLogRoot: string }}
 */
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
  /** @type {SolveJobManagerOptions} */
  const solveJobManagerOptions = {
    progressLogRoot: resolvedProgressLogRoot,
    progressLogIntervalMs,
    progressLogPollIntervalMs
  };
  if (maxRunningSolves !== undefined) solveJobManagerOptions.maxRunningSolves = maxRunningSolves;
  if (completedJobRetentionMs !== undefined) solveJobManagerOptions.completedJobRetentionMs = completedJobRetentionMs;

  return {
    handler: /** @type {RouteTestHandler} */ (
      /** @type {unknown} */ (
        createPlannerRequestHandler({
          webRoot,
          solveJobManager: new SolveJobManager(solveJobManagerOptions)
        })
      )
    ),
    progressLogRoot: resolvedProgressLogRoot
  };
}

/**
 * @param {string} method
 * @param {string} url
 * @param {string | Buffer} [body]
 * @param {IncomingHttpHeaders} [headers]
 * @returns {MockRequest}
 */
function createMockRequest(method, url, body = "", headers = undefined) {
  const stream = /** @type {MockRequest} */ (Readable.from(body ? [Buffer.from(body)] : []));
  stream.method = method;
  stream.url = url;
  stream.headers = headers ?? (body ? { "content-type": "application/json" } : {});
  return stream;
}

/**
 * @returns {MockResponse}
 */
function createMockResponse() {
  const response = /** @type {MockResponse} */ (new EventEmitter());
  response.statusCode = 0;
  response.headers = {};
  response.body = "";
  response.writableEnded = false;
  response.writeHead = function writeHead(statusCode, headers) {
    response.statusCode = statusCode;
    response.headers = headers ?? {};
  };
  response.end = function end(chunk) {
    response.writableEnded = true;
    if (chunk) {
      response.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    }
  };
  return response;
}

/**
 * @template T
 * @returns {{ promise: Promise<T>, resolve: (value?: T | PromiseLike<T>) => void }}
 */
function createDeferred() {
  /** @type {(value?: T | PromiseLike<T>) => void} */
  let resolve = () => {};
  const promise = new Promise((promiseResolve) => {
    resolve = (value) => promiseResolve(value);
  });
  return { promise, resolve };
}

function waitForNextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * @param {RouteTestHandler} handler
 * @param {InvokeOptions} options
 * @returns {Promise<InvokeResult>}
 */
async function invoke(handler, { method = "GET", url = "/", json = undefined, body = undefined, headers = undefined }) {
  const payloadBody = json === undefined ? (body ?? "") : JSON.stringify(json);
  const req = createMockRequest(method, url, payloadBody, headers);
  const res = createMockResponse();
  await handler(req, res);
  /** @type {any} */
  let payload = null;
  const contentType = String(res.headers["Content-Type"] || res.headers["content-type"] || "");
  if (contentType.includes("application/json")) {
    payload = JSON.parse(res.body || "{}");
  }
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
    payload
  };
}

/**
 * @param {RouteTestHandler} handler
 * @param {string} requestId
 * @returns {Promise<any>}
 */
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

/**
 * @returns {TinySolvePayload}
 */
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

/**
 * @param {PlannerExplainabilityPayload} payload
 * @param {Grid} grid
 * @returns {void}
 */
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

/**
 * @param {SolutionLike} solution
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
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
