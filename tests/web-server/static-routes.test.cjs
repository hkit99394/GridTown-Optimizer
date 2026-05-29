const assert = require("node:assert/strict");
const path = require("node:path");

const { createRouteTestHandler, invoke } = require("./routeTestServer.cjs");

/**
 * @typedef {ReturnType<typeof createRouteTestHandler>["handler"]} RouteTestHandler
 */

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testHealthRoute(handler) {
  const result = await invoke(handler, { method: "GET", url: "/api/health" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testCpSatReadinessRoute(handler) {
  const result = await invoke(handler, { method: "GET", url: "/api/cp-sat/readiness" });
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(typeof result.payload.cpSat.ready, "boolean");
  assert.equal(typeof result.payload.cpSat.pythonExecutable, "string");
  assert.equal(result.payload.cpSat.setupCommand, "npm run setup:cp-sat");
  assert.match(result.payload.cpSat.message, /CP-SAT/);
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testStaticPlannerModules(handler) {
  /** @type {Array<[string, RegExp]>} */
  const expectedStaticAssets = [
    ["/styles.css", /page-shell/],
    ["/plannerWorkflow.css", /workflow-steps/],
    ["/results.css", /result-details-body/],
    ["/plannerShell.js", /CityBuilderShell/],
    ["/plannerShared.js", /CityBuilderShared/],
    ["/plannerDefaults.js", /CityBuilderDefaults/],
    ["/plannerSamplePresets.js", /CityBuilderSamplePresets/],
    ["/plannerOnboarding.js", /CityBuilderOnboarding/],
    ["/plannerPersistenceValidation.js", /CityBuilderPersistenceValidation/],
    ["/plannerPersistence.js", /CityBuilderPersistence/],
    ["/plannerSolveRuntime.js", /CityBuilderSolveRuntime/],
    ["/plannerExpansion.js", /CityBuilderExpansion/],
    ["/plannerHeatmaps.js", /PlannerHeatmaps/],
    ["/plannerManualLayout.js", /PlannerManualLayout/],
    ["/plannerResultAvailability.js", /PlannerResultAvailability/],
    ["/plannerResultProgress.js", /PlannerResultProgress/],
    ["/plannerResultRendering.js", /PlannerResultRendering/],
    ["/plannerResults.js", /CityBuilderResults/],
    ["/plannerRequestBuilder.js", /CityBuilderRequestBuilder/],
    ["/plannerWorkbench.js", /CityBuilderWorkbench/],
    ["/app.js", /const state =/]
  ];

  for (const [url, bodyPattern] of expectedStaticAssets) {
    const result = await invoke(handler, { method: "GET", url });
    assert.equal(result.statusCode, 200, `${url} should be served`);
    assert.match(result.body, bodyPattern);
  }
}

async function testUnexpectedStaticServerErrorsReturnInternalServerError() {
  const { handler } = createRouteTestHandler({
    webRoot: path.resolve(__dirname, "../../apps/planner-web-does-not-exist")
  });

  const result = await invoke(handler, { method: "GET", url: "/" });

  assert.equal(result.statusCode, 500);
  assert.equal(result.payload.ok, false);
  assert.match(result.payload.error, /ENOENT/);
}

/**
 * @param {RouteTestHandler} handler
 * @returns {Promise<void>}
 */
async function testMethodNotAllowed(handler) {
  const result = await invoke(handler, { method: "PUT", url: "/api/solve" });
  assert.equal(result.statusCode, 405);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Method not allowed.");
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testHealthRoute(handler);
  await testCpSatReadinessRoute(handler);
  await testStaticPlannerModules(handler);
  await testUnexpectedStaticServerErrorsReturnInternalServerError();
  await testMethodNotAllowed(handler);

  console.log("Web server static route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
