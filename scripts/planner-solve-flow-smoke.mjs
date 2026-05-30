import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

const HOST = "127.0.0.1";
const REQUEST_TIMEOUT_MS = 5000;
const SOLVE_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTinySolvePayload(requestId) {
  return {
    requestId,
    grid: Array.from({ length: 4 }, () => Array(4).fill(1)),
    params: {
      optimizer: "greedy",
      residentialTypes: [{ name: "Smoke Residence", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false }
    }
  };
}

async function findOpenPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return address.port;
}

function startPlannerServer(port) {
  const logs = [];
  const child = spawn(process.execPath, ["dist/webServer.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST,
      PORT: String(port),
      PROGRESS_LOG_INTERVAL_SECONDS: "1",
      PROGRESS_LOG_POLL_INTERVAL_SECONDS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  return { child, logs };
}

async function stopPlannerServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 1500);
  try {
    await once(child, "exit");
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(baseUrl, path, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const elapsedMs = Date.now() - startedAt;
  const bodyText = await response.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${bodyText}`);
  return { elapsedMs, payload, statusCode: response.status };
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(baseUrl, "/api/health");
      assert.equal(health.payload.ok, true);
      return;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError ?? new Error("Planner server did not become healthy.");
}

async function runSmoke() {
  const port = await findOpenPort();
  const baseUrl = `http://${HOST}:${port}`;
  const { child, logs } = startPlannerServer(port);
  const requestId = `flow-smoke-${Date.now()}`;
  const payload = createTinySolvePayload(requestId);

  try {
    await waitForServer(baseUrl);

    const start = await fetchJson(baseUrl, "/api/solve/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(start.statusCode, 202);
    assert.equal(start.payload.jobStatus, "running");

    const startedAt = Date.now();
    let finalStatus = null;
    let polls = 0;
    let maxStatusMs = 0;

    while (Date.now() - startedAt < SOLVE_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);
      polls += 1;
      const status = await fetchJson(baseUrl, `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`);
      maxStatusMs = Math.max(maxStatusMs, status.elapsedMs);
      if (status.payload.jobStatus === "completed") {
        finalStatus = status;
        break;
      }
      assert.notEqual(status.payload.jobStatus, "failed", JSON.stringify(status.payload, null, 2));
    }

    assert.notEqual(finalStatus, null, `Solve did not complete within ${SOLVE_TIMEOUT_MS}ms.`);
    assert.equal(finalStatus.payload.validation.valid, true, finalStatus.payload.validation.errors.join("\n"));
    assert.equal(finalStatus.payload.validation.populationValidation.mode, "full-recompute");
    assert.equal(finalStatus.payload.solution.residentials.length, 1);
    assert.equal(finalStatus.payload.stats.totalPopulation > 0, true);

    const recheck = await fetchJson(baseUrl, `/api/solve/status?${new URLSearchParams({ requestId }).toString()}`);
    assert.equal(recheck.payload.jobStatus, "completed");
    assert.equal(recheck.payload.validation.populationValidation.mode, "full-recompute");

    console.log(
      JSON.stringify({
        ok: true,
        requestId,
        polls,
        startMs: start.elapsedMs,
        maxStatusMs,
        recheckMs: recheck.elapsedMs,
        totalPopulation: finalStatus.payload.stats.totalPopulation,
        validationMode: finalStatus.payload.validation.populationValidation.mode
      })
    );
  } catch (error) {
    const serverLog = logs.join("").trim();
    if (serverLog) {
      console.error(serverLog);
    }
    throw error;
  } finally {
    await stopPlannerServer(child);
  }
}

await runSmoke();
