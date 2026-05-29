(function () {
  const isPlannerV2 = window.location.pathname === "/v2" || window.location.pathname === "/v2/";
  if (!isPlannerV2) return;

  document.documentElement.dataset.plannerVersion = "v2";

  /**
   * @param {Element} referenceNode
   * @param {Element | null | undefined} nextNode
   */
  function insertAfter(referenceNode, nextNode) {
    if (!referenceNode.parentElement || !nextNode) return;
    referenceNode.parentElement.insertBefore(nextNode, referenceNode.nextElementSibling);
  }

  function addPreviewSwitcher() {
    const header = document.querySelector(".cockpit-header");
    const title = document.querySelector(".cockpit-title");
    if (!header || !title || header.querySelector(".v2-version-switcher")) return;

    const switcher = document.createElement("nav");
    switcher.className = "v2-version-switcher";
    switcher.setAttribute("aria-label", "Planner version switcher");

    const previewBadge = document.createElement("span");
    previewBadge.className = "v2-preview-badge";
    previewBadge.textContent = "Version 2 preview";

    const currentLink = document.createElement("a");
    currentLink.href = "/";
    currentLink.textContent = "Open current UI";

    switcher.append(previewBadge, currentLink);
    title.append(switcher);
  }

  function moveLaunchCardUp() {
    const controlBody = document.querySelector("#controlStage .module-body");
    const happyPathCard = controlBody?.querySelector(".happy-path-card");
    const launchCard = controlBody?.querySelector(".launch-card");
    const summaryCard = controlBody?.querySelector(".summary-card");
    if (!controlBody || !happyPathCard || !launchCard) return;

    launchCard.classList.add("v2-state-rail");
    controlBody.insertBefore(launchCard, happyPathCard);
    if (summaryCard) insertAfter(launchCard, summaryCard);
  }

  function relabelRunRail() {
    const launchCard = document.querySelector(".launch-card");
    const eyebrow = launchCard?.querySelector(".eyebrow");
    const heading = launchCard?.querySelector("h3");
    if (!launchCard || !eyebrow || !heading) return;

    eyebrow.textContent = "Run rail";
    heading.textContent = "Ready / Run / Review";
  }

  function addActivePlanStrip() {
    const launchCard = document.querySelector(".launch-card");
    const solverActions = launchCard?.querySelector(".solver-actions");
    const summaryOptimizer = document.querySelector("#summaryOptimizer");
    if (!launchCard || !solverActions || !summaryOptimizer || launchCard.querySelector(".v2-plan-strip")) return;

    const strip = document.createElement("div");
    strip.className = "v2-plan-strip";

    const label = document.createElement("span");
    label.className = "metric-label";
    label.textContent = "Active plan";

    const value = document.createElement("strong");
    value.textContent = summaryOptimizer.textContent || "Auto";

    const helper = document.createElement("span");
    helper.className = "status-text";
    helper.textContent = "Auto remains the recommended path.";

    strip.append(label, value, helper);
    launchCard.insertBefore(strip, solverActions);

    const sync = () => {
      value.textContent = summaryOptimizer.textContent || "Auto";
    };
    new MutationObserver(sync).observe(summaryOptimizer, { childList: true, subtree: true });
    sync();
  }

  function compactCpSatReadiness() {
    const status = document.querySelector("#cpSatReadinessStatus");
    if (!status || status.closest(".v2-cp-sat-details")) return;

    const details = document.createElement("details");
    details.className = "v2-cp-sat-details";

    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.textContent = "Checking CP-SAT";
    summary.append(label);

    status.parentElement?.insertBefore(details, status);
    details.append(summary, status);

    const compactLabel = () => {
      const text = status.textContent?.trim() ?? "";
      if (text.startsWith("CP-SAT ready via ")) return "CP-SAT ready";
      if (text.includes("not ready")) return "CP-SAT setup needed";
      if (text.includes("unavailable")) return "CP-SAT check unavailable";
      return "Checking CP-SAT";
    };
    const sync = () => {
      label.textContent = compactLabel();
    };
    new MutationObserver(sync).observe(status, { childList: true, subtree: true, characterData: true });
    sync();
  }

  function addRunReadiness() {
    const launchCard = document.querySelector(".launch-card");
    const planStrip = launchCard?.querySelector(".v2-plan-strip");
    const summaryGridSize = document.querySelector("#summaryGridSize");
    const summaryAllowedCells = document.querySelector("#summaryAllowedCells");
    const summaryServiceTypes = document.querySelector("#summaryServiceTypes");
    const summaryResidentialTypes = document.querySelector("#summaryResidentialTypes");
    const resultBadge = document.querySelector("#resultBadge");
    if (
      !launchCard ||
      !planStrip ||
      !summaryGridSize ||
      !summaryAllowedCells ||
      !summaryServiceTypes ||
      !summaryResidentialTypes ||
      !resultBadge ||
      launchCard.querySelector(".v2-readiness-list")
    ) {
      return;
    }

    const readiness = document.createElement("div");
    readiness.className = "v2-readiness-list";
    readiness.setAttribute("aria-label", "Run readiness");

    const gridItem = document.createElement("span");
    const catalogItem = document.createElement("span");
    const resultItem = document.createElement("span");

    readiness.append(gridItem, catalogItem, resultItem);
    launchCard.insertBefore(readiness, planStrip);

    const sync = () => {
      const gridSize = summaryGridSize.textContent?.trim() || "0 x 0";
      const allowedCells = summaryAllowedCells.textContent?.trim() || "0";
      const serviceTypes = summaryServiceTypes.textContent?.trim() || "0";
      const residentialTypes = summaryResidentialTypes.textContent?.trim() || "0";
      const resultState = resultBadge.textContent?.trim() || "Waiting";

      gridItem.textContent = `Grid ${gridSize}; ${allowedCells} allowed`;
      catalogItem.textContent = `Catalog ${serviceTypes} service / ${residentialTypes} residential`;
      resultItem.textContent = `Result ${resultState}`;
    };

    for (const target of [
      summaryGridSize,
      summaryAllowedCells,
      summaryServiceTypes,
      summaryResidentialTypes,
      resultBadge
    ]) {
      new MutationObserver(sync).observe(target, { childList: true, subtree: true });
    }
    sync();
  }

  function restructureResults() {
    const resultStage = document.querySelector("#resultStage");
    const moduleBody = resultStage?.querySelector(".module-body");
    const resultHeader = resultStage?.querySelector(".module-head");
    const storagePanel = moduleBody?.querySelector(".result-storage-panel");
    const resultsContent = document.querySelector("#resultsContent");
    const resultsEmpty = document.querySelector("#resultsEmpty");
    const resultColumns = resultStage?.querySelector(".result-columns");
    const mapBlock = document.querySelector("#resultMapGrid")?.closest(".result-block");
    const expansionWorkspace = document.querySelector("#expansionAdviceStatus")?.closest(".result-storage-panel");
    if (!resultStage || !moduleBody || !storagePanel || !resultsContent || !resultsEmpty) return;

    resultStage.classList.add("v2-answer-results");
    storagePanel.classList.add("v2-result-storage");
    resultHeader?.querySelector(".eyebrow")?.replaceChildren(document.createTextNode("Answer bay"));
    resultHeader?.querySelector("h2")?.replaceChildren(document.createTextNode("Result review"));

    if (resultColumns && mapBlock) {
      resultColumns.insertBefore(mapBlock, resultColumns.firstElementChild);
    }

    moduleBody.insertBefore(resultsEmpty, moduleBody.firstElementChild);
    moduleBody.insertBefore(resultsContent, resultsEmpty.nextElementSibling);

    if (expansionWorkspace) {
      expansionWorkspace.classList.add("v2-expansion-workspace");
      const eyebrow = expansionWorkspace.querySelector(".eyebrow");
      const heading = expansionWorkspace.querySelector("h3");
      if (eyebrow) eyebrow.textContent = "Decision";
      if (heading) heading.textContent = "Compare next addition";
      insertAfter(resultsContent, expansionWorkspace);
    }

    insertAfter(expansionWorkspace ?? resultsContent, storagePanel);
  }

  function initPlannerV2() {
    addPreviewSwitcher();
    moveLaunchCardUp();
    relabelRunRail();
    addActivePlanStrip();
    addRunReadiness();
    compactCpSatReadiness();
    restructureResults();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlannerV2, { once: true });
  } else {
    initPlannerV2();
  }
})();
