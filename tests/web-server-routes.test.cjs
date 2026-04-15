const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const { SolveJobManager } = require("../dist/solveJobManager.js");
const { createPlannerRequestHandler } = require("../dist/webServerRequestHandler.js");
const { solve } = require("../dist/index.js");

function createMockRequest(method, url, body = "") {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = body ? { "content-type": "application/json" } : {};
  return stream;
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers ?? {};
    },
    end(chunk) {
      if (chunk) {
        this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      }
    },
  };
}

async function invoke(handler, { method = "GET", url = "/", json = undefined, body = undefined }) {
  const payloadBody = json === undefined ? (body ?? "") : JSON.stringify(json);
  const req = createMockRequest(method, url, payloadBody);
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
    payload,
  };
}

async function waitForSolve(handler, requestId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await invoke(handler, {
      method: "GET",
      url: `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`,
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
      [1, 1, 1, 1],
    ],
    params: {
      residentialTypes: [
        { name: "Test Residence", w: 2, h: 2, min: 100, max: 100, avail: 1 },
      ],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false },
    },
  };
}

async function testHealthRoute(handler) {
  const result = await invoke(handler, { method: "GET", url: "/api/health" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
}

async function testStaticPlannerModules(handler) {
  const result = await invoke(handler, { method: "GET", url: "/plannerShell.js" });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /CityBuilderShell/);
}

async function testMethodNotAllowed(handler) {
  const result = await invoke(handler, { method: "PUT", url: "/api/solve" });
  assert.equal(result.statusCode, 405);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Method not allowed.");
}

async function testImmediateSolveRoute(handler) {
  const solvePayload = buildTinySolvePayload();
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve",
    json: solvePayload,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.stats.totalPopulation, 100);
  assert.equal(result.payload.solution.residentials.length, 1);
}

async function testLayoutEvaluateRoute(handler) {
  const solvePayload = buildTinySolvePayload();
  const solved = solve(solvePayload.grid, solvePayload.params);
  const serializedSolution = {
    ...solved,
    roads: Array.from(solved.roads),
  };

  const result = await invoke(handler, {
    method: "POST",
    url: "/api/layout/evaluate",
    json: {
      ...solvePayload,
      solution: serializedSolution,
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.validation.valid, true);
  assert.equal(result.payload.stats.totalPopulation, 100);
  assert.equal(result.payload.solution.manualLayout, true);
  assert.equal(result.payload.stats.manualLayout, true);
  assert.equal(result.payload.stats.cpSatStatus, null);
}

async function testBackgroundSolveRoutes(handler) {
  const solvePayload = buildTinySolvePayload();
  const requestId = "route-test-greedy";
  const startResult = await invoke(handler, {
    method: "POST",
    url: "/api/solve/start",
    json: {
      ...solvePayload,
      requestId,
    },
  });

  assert.equal(startResult.statusCode, 202);
  assert.equal(startResult.payload.ok, true);
  assert.equal(startResult.payload.requestId, requestId);
  assert.equal(startResult.payload.jobStatus, "running");
  assert.equal(typeof startResult.payload.progressLogFilePath, "string");

  const finalPayload = await waitForSolve(handler, requestId);
  assert.equal(finalPayload.jobStatus, "completed");
  assert.equal(finalPayload.stats.totalPopulation, 100);
  assert.equal(finalPayload.solution.residentials.length, 1);
  assert.equal(finalPayload.progressLogFilePath, startResult.payload.progressLogFilePath);

  const persistedLog = JSON.parse(fs.readFileSync(startResult.payload.progressLogFilePath, "utf8"));
  assert.equal(persistedLog.requestId, requestId);
  assert.equal(persistedLog.status, "completed");
  assert.deepEqual(persistedLog.input.grid, solvePayload.grid);
  assert.equal(persistedLog.input.params.greedy.localSearch, false);
  assert.equal(Array.isArray(persistedLog.entries), true);
  assert.equal(persistedLog.entries.length >= 2, true);
  assert.equal(persistedLog.entries[0].hasFeasibleSolution, false);
  assert.equal(persistedLog.entries[0].totalPopulation, null);
  assert.equal(persistedLog.entries[persistedLog.entries.length - 1].source, "final-result");
}

async function testCancelMissingSolveRoute(handler) {
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/solve/cancel",
    json: { requestId: "missing-solve" },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.stopped, false);
}

async function main() {
  const progressLogRoot = fs.mkdtempSync(path.join(os.tmpdir(), "planner-route-logs-"));
  const handler = createPlannerRequestHandler({
    webRoot: path.resolve(__dirname, "../web"),
    solveJobManager: new SolveJobManager({
      progressLogRoot,
      progressLogIntervalMs: 10,
      progressLogPollIntervalMs: 5,
    }),
  });

  await testHealthRoute(handler);
  await testStaticPlannerModules(handler);
  await testMethodNotAllowed(handler);
  await testImmediateSolveRoute(handler);
  await testLayoutEvaluateRoute(handler);
  await testBackgroundSolveRoutes(handler);
  await testCancelMissingSolveRoute(handler);

  console.log("Web server route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
