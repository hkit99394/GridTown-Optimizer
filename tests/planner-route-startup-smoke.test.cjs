const assert = require("node:assert/strict");

const { runPlannerRoute } = require("./helpers/plannerRouteDom.cjs");

const deferredPlannerScripts = [
  "/plannerShell.js",
  "/plannerShared.js",
  "/plannerDefaults.js",
  "/plannerSamplePresets.js",
  "/plannerOnboarding.js",
  "/plannerPersistenceValidation.js",
  "/plannerPersistence.js",
  "/plannerSolveRuntime.js",
  "/plannerExpansion.js",
  "/plannerHeatmaps.js",
  "/plannerManualLayout.js",
  "/plannerResultAvailability.js",
  "/plannerResultProgress.js",
  "/plannerResultDiagnostics.js",
  "/plannerResultRendering.js",
  "/plannerResultStates.js",
  "/plannerResults.js",
  "/plannerRequestBuilder.js",
  "/plannerWorkbenchCatalog.js",
  "/plannerWorkbench.js",
  "/plannerStaticFragments.js",
  "/plannerAppElements.js",
  "/app.js"
];

function requiredElement(document, selector, route) {
  const element = document.querySelector(selector);
  assert.ok(element, `${route} should wire ${selector}`);
  return element;
}

function assertRouteBoot(pathname, expectedVersion, expectedDynamicScripts) {
  const route = runPlannerRoute(pathname);
  assert.equal(route.document.documentElement.dataset.plannerVersion, expectedVersion);
  assert.deepEqual(route.document.loadedScripts, expectedDynamicScripts);
  assert.deepEqual(route.document.executedScripts, [
    "/plannerPreviewBoot.js",
    ...deferredPlannerScripts,
    ...expectedDynamicScripts
  ]);
  assert.ok(route.window.CityBuilderAppElements, `${pathname} should execute plannerAppElements.js`);
  assert.ok(route.window.CityBuilderShell, `${pathname} should execute deferred planner modules before app.js`);
  assert.ok(route.document.querySelector("#maxServices"), `${pathname} should execute plannerStaticFragments.js`);
  assert.equal(route.document.querySelector("[data-static-fragment]"), null);
  assert.equal(
    listenerCount(requiredElement(route.document, "#solveButton", pathname), "click"),
    1,
    `${pathname} should execute app.js startup`
  );

  const staticFragmentsIndex = route.document.executedScripts.indexOf("/plannerStaticFragments.js");
  const appElementsIndex = route.document.executedScripts.indexOf("/plannerAppElements.js");
  const appIndex = route.document.executedScripts.indexOf("/app.js");
  assert.equal(staticFragmentsIndex < appElementsIndex, true, `${pathname} should load static fragments first`);
  assert.equal(appElementsIndex < appIndex, true, `${pathname} should load app elements before app.js`);
  return route;
}

function listenerCount(element, type) {
  return element.listeners.get(type)?.length ?? 0;
}

function assertBasePlannerControls(document, route) {
  for (const selector of [
    '[data-planner-slot="stage-grid"]',
    '[data-planner-slot="stage-catalog"]',
    '[data-planner-slot="stage-result"]',
    '[data-planner-slot="stage-control"]',
    '[data-planner-slot="guide-card"]',
    '[data-planner-slot="run-rail"]',
    '[data-planner-slot="result-actions"]',
    "#solveButton",
    "#cpSatReadinessStatus"
  ]) {
    requiredElement(document, selector, route);
  }
}

function testV21Route(pathname) {
  const { document } = assertRouteBoot(pathname, "v2.1", ["/plannerV21.js"]);
  assertBasePlannerControls(document, pathname);

  assert.ok(document.head.querySelector('link[href="/plannerV21.css"]'), `${pathname} should add v2.1 CSS`);
  assert.equal(requiredElement(document, ".v21-preview-badge", pathname).textContent, "Version 2.1 guided preview");
  assert.equal(
    requiredElement(document, '.v21-version-switcher a[href="/legacy"]', pathname).textContent,
    "Open legacy UI"
  );
  assert.equal(requiredElement(document, '.v21-version-switcher a[href="/v2"]', pathname).textContent, "Open v2");

  const guideSteps = document.querySelectorAll(".workflow-steps li");
  assert.equal(guideSteps.length, 5);
  assert.equal(guideSteps[0].dataset.state, "complete");
  assert.equal(guideSteps[1].dataset.state, "current");
  assert.equal(requiredElement(document, ".workflow-steps li .v21-step-status", pathname).textContent, "Done");
  assert.equal(
    requiredElement(document, '.workflow-steps a[href="#v21ResultActions"]', pathname).textContent.includes(
      "Save/export result"
    ),
    true
  );
  assert.ok(
    requiredElement(document, '[data-planner-slot="guide-card"]', pathname).classList.contains("v21-guide-card")
  );
  assert.ok(requiredElement(document, '[data-planner-slot="run-rail"]', pathname).classList.contains("v21-run-rail"));
  assert.equal(document.querySelectorAll(".v21-readiness-list span").length, 3);

  const actionBar = requiredElement(document, '[data-planner-slot="result-actions"]', pathname);
  assert.equal(actionBar.hidden, false);
  for (const action of ["save-layout", "export-layouts", "compare-expansion"]) {
    const button = requiredElement(document, `[data-v21-action="${action}"]`, pathname);
    assert.equal(listenerCount(button, "click"), 1, `${action} should have a click handler`);
  }
  assert.equal(
    requiredElement(document, "[data-v21-action-status]", pathname).textContent.trim(),
    "Run Auto or load a saved layout to enable result actions."
  );
  requiredElement(document, '[data-v21-action="compare-expansion"]', pathname).click();
  assert.equal(document.activeElement, requiredElement(document, "#expansionNextService", pathname));

  assert.equal(requiredElement(document, '[data-planner-slot="expansion-panel"]', pathname).id, "v21ExpansionPanel");
  assert.ok(document.querySelector(".v21-cp-sat-details #cpSatReadinessStatus"));
  assert.ok(document.querySelector('.v21-catalog-editor [data-planner-slot="catalog-grid"]'));
  assert.ok(document.querySelector(".v21-analysis-details .map-legend"));
}

function testV2Route() {
  const { document } = assertRouteBoot("/v2", "v2", ["/plannerV2.js"]);
  assertBasePlannerControls(document, "/v2");

  assert.ok(document.head.querySelector('link[href="/plannerV2.css"]'), "/v2 should add v2 CSS");
  assert.equal(requiredElement(document, ".v2-preview-badge", "/v2").textContent, "Version 2 preview");
  assert.equal(requiredElement(document, '.v2-version-switcher a[href="/"]', "/v2").textContent, "Open default UI");
  assert.ok(requiredElement(document, '[data-planner-slot="run-rail"]', "/v2").classList.contains("v2-state-rail"));
  assert.equal(
    requiredElement(document, "#controlStage .module-body", "/v2").firstElementChild.getAttribute("data-planner-slot"),
    "run-rail"
  );
  assert.equal(requiredElement(document, ".v2-plan-strip strong", "/v2").textContent, "Auto");
  assert.equal(document.querySelectorAll(".v2-readiness-list span").length, 3);
  assert.ok(document.querySelector(".v2-cp-sat-details #cpSatReadinessStatus"));
  assert.ok(requiredElement(document, "#resultStage", "/v2").classList.contains("v2-answer-results"));
  assert.ok(
    requiredElement(document, '[data-planner-slot="layout-storage"]', "/v2").classList.contains("v2-result-storage")
  );
  assert.ok(
    requiredElement(document, '[data-planner-slot="expansion-panel"]', "/v2").classList.contains(
      "v2-expansion-workspace"
    )
  );
}

function testLegacyRoute() {
  const { document } = assertRouteBoot("/legacy", undefined, []);
  assertBasePlannerControls(document, "/legacy");
  assert.equal(document.querySelector(".v21-version-switcher"), null);
  assert.equal(document.querySelector(".v2-version-switcher"), null);
  assert.equal(requiredElement(document, '[data-planner-slot="result-actions"]', "/legacy").hidden, true);
  assert.equal(document.head.querySelector('link[href="/plannerV21.css"]'), null);
  assert.equal(document.head.querySelector('link[href="/plannerV2.css"]'), null);
}

testV21Route("/");
testV21Route("/v2.1");
testV2Route();
testLegacyRoute();

console.log("Planner route startup smoke tests passed.");
