const assert = require("node:assert/strict");
const path = require("node:path");

const { createRouteTestHandler, invoke } = require("./routeTestServer.cjs");

async function testHealthRoute(handler) {
  const result = await invoke(handler, { method: "GET", url: "/api/health" });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload, { ok: true });
}

async function testStaticPlannerModules(handler) {
  const expectedStaticModules = [
    ["/plannerShell.js", /CityBuilderShell/],
    ["/plannerShared.js", /CityBuilderShared/],
    ["/plannerPersistence.js", /CityBuilderPersistence/],
    ["/plannerSolveRuntime.js", /CityBuilderSolveRuntime/],
    ["/plannerExpansion.js", /CityBuilderExpansion/],
    ["/plannerHeatmaps.js", /PlannerHeatmaps/],
    ["/plannerManualLayout.js", /PlannerManualLayout/],
    ["/plannerResults.js", /CityBuilderResults/],
    ["/plannerRequestBuilder.js", /CityBuilderRequestBuilder/],
    ["/plannerWorkbench.js", /CityBuilderWorkbench/],
    ["/app.js", /const state =/]
  ];

  for (const [url, bodyPattern] of expectedStaticModules) {
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

async function testMethodNotAllowed(handler) {
  const result = await invoke(handler, { method: "PUT", url: "/api/solve" });
  assert.equal(result.statusCode, 405);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "Method not allowed.");
}

async function main() {
  const { handler } = createRouteTestHandler();
  await testHealthRoute(handler);
  await testStaticPlannerModules(handler);
  await testUnexpectedStaticServerErrorsReturnInternalServerError(handler);
  await testMethodNotAllowed(handler);

  console.log("Web server static route tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
