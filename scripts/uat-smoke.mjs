import assert from "node:assert/strict";

const BASE_URL = (process.env.CITY_BUILDER_UAT_BASE_URL ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const REQUIRE_CP_SAT = process.env.CITY_BUILDER_UAT_REQUIRE_CP_SAT === "true";
const REQUEST_TIMEOUT_MS = Number(process.env.CITY_BUILDER_UAT_REQUEST_TIMEOUT_MS ?? 5000);
const SOLVE_TIMEOUT_MS = Number(process.env.CITY_BUILDER_UAT_SOLVE_TIMEOUT_MS ?? 15000);
const POLL_INTERVAL_MS = Number(process.env.CITY_BUILDER_UAT_POLL_INTERVAL_MS ?? 250);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const bodyText = await response.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${bodyText}`);
  return { payload, statusCode: response.status };
}

function createTinySolvePayload(requestId) {
  return {
    requestId,
    grid: Array.from({ length: 4 }, () => Array(4).fill(1)),
    params: {
      optimizer: "greedy",
      residentialTypes: [{ name: "UAT Smoke Residence", w: 1, h: 1, min: 10, max: 10, avail: 1 }],
      availableBuildings: { residentials: 1, services: 0 },
      greedy: { localSearch: false }
    }
  };
}

async function waitForHealthy() {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson("/api/health");
      assert.equal(health.payload.ok, true);
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw lastError ?? new Error(`${BASE_URL} did not become healthy.`);
}

async function runSmoke() {
  await waitForHealthy();

  const readiness = await fetchJson("/api/cp-sat/readiness");
  assert.equal(readiness.payload.ok, true);
  if (REQUIRE_CP_SAT) {
    assert.equal(
      readiness.payload.cpSat.ready,
      true,
      readiness.payload.cpSat.detail ?? readiness.payload.cpSat.message
    );
  }

  const requestId = `uat-smoke-${Date.now()}`;
  const start = await fetchJson("/api/solve/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createTinySolvePayload(requestId))
  });
  assert.equal(start.statusCode, 202);
  assert.equal(start.payload.jobStatus, "running");

  const startedAt = Date.now();
  let finalStatus = null;
  let polls = 0;
  while (Date.now() - startedAt < SOLVE_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    polls += 1;
    const status = await fetchJson(`/api/solve/status?${new URLSearchParams({ requestId }).toString()}`);
    if (status.payload.jobStatus === "completed") {
      finalStatus = status.payload;
      break;
    }
    assert.notEqual(status.payload.jobStatus, "failed", JSON.stringify(status.payload, null, 2));
  }

  assert.notEqual(finalStatus, null, `Solve did not complete within ${SOLVE_TIMEOUT_MS}ms.`);
  assert.equal(finalStatus.validation.valid, true, finalStatus.validation.errors.join("\n"));
  assert.equal(finalStatus.solution.residentials.length, 1);
  assert.equal(finalStatus.stats.totalPopulation, 10);

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      requestId,
      polls,
      cpSatReady: readiness.payload.cpSat.ready,
      cpSatPython: readiness.payload.cpSat.pythonExecutable,
      totalPopulation: finalStatus.stats.totalPopulation
    })
  );
}

await runSmoke();
