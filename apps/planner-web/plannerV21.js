(function () {
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  const isPlannerV21 = pathname === "/" || pathname === "/index.html" || pathname === "/v2.1";
  if (!isPlannerV21) return;

  document.documentElement.dataset.plannerVersion = "v2.1";

  /**
   * @param {string} selector
   * @param {ParentNode} [root]
   * @returns {HTMLElement | null}
   */
  function find(selector, root = document) {
    const element = root.querySelector(selector);
    return element instanceof HTMLElement ? element : null;
  }

  /**
   * @param {string} slot
   * @param {ParentNode} [root]
   * @returns {HTMLElement | null}
   */
  function bySlot(slot, root = document) {
    return find(`[data-planner-slot="${slot}"]`, root);
  }

  /**
   * @param {Element | null | undefined} referenceNode
   * @param {Element | null | undefined} nextNode
   */
  function insertAfter(referenceNode, nextNode) {
    if (!referenceNode?.parentElement || !nextNode) return;
    referenceNode.parentElement.insertBefore(nextNode, referenceNode.nextElementSibling);
  }

  /**
   * @param {HTMLElement} element
   * @param {string} slot
   */
  function markSlot(element, slot) {
    element.dataset.v21Slot = slot;
  }

  function addPreviewSwitcher() {
    const title = find(".cockpit-title");
    if (!title || title.querySelector(".v21-version-switcher")) return;

    const switcher = document.createElement("nav");
    switcher.className = "v21-version-switcher";
    switcher.setAttribute("aria-label", "Planner version switcher");

    const previewBadge = document.createElement("span");
    previewBadge.className = "v21-preview-badge";
    previewBadge.textContent = "Version 2.1 guided preview";

    const legacyLink = document.createElement("a");
    legacyLink.href = "/legacy";
    legacyLink.textContent = "Open legacy UI";

    const v2Link = document.createElement("a");
    v2Link.href = "/v2";
    v2Link.textContent = "Open v2";

    switcher.append(previewBadge, legacyLink, v2Link);
    title.append(switcher);
  }

  function arrangeControlRail() {
    const controlBody = bySlot("control-body");
    const happyPathCard = bySlot("guide-card");
    const launchCard = bySlot("run-rail");
    const summaryCard = bySlot("overview-card");
    const solverCard = bySlot("solver-options");
    const storageCard = bySlot("input-library");
    const payloadPreview = bySlot("payload-preview");
    if (!controlBody || !happyPathCard || !launchCard || !summaryCard || !solverCard) return;

    happyPathCard.classList.add("v21-guide-card");
    launchCard.classList.add("v21-run-rail");
    solverCard.classList.add("v21-solver-card");
    summaryCard.classList.add("v21-summary-card");
    markSlot(happyPathCard, "guided-flow");
    markSlot(launchCard, "run-rail");
    markSlot(summaryCard, "overview");
    markSlot(solverCard, "solver-options");
    if (storageCard) markSlot(storageCard, "input-library");

    controlBody.prepend(happyPathCard);
    insertAfter(happyPathCard, launchCard);
    insertAfter(launchCard, summaryCard);
    insertAfter(summaryCard, solverCard);
    if (storageCard) insertAfter(solverCard, storageCard);
    if (payloadPreview && storageCard) insertAfter(storageCard, payloadPreview);
  }

  function relabelControlRail() {
    const controlStage = bySlot("stage-control");
    const controlEyebrow = find(".module-head .eyebrow", controlStage ?? document);
    const controlHeading = find(".module-head h2", controlStage ?? document);
    const controlNote = find(".module-note", controlStage ?? document);
    if (controlEyebrow) controlEyebrow.textContent = "Guided run";
    if (controlHeading) controlHeading.textContent = "Planner guide";
    if (controlNote) controlNote.textContent = "Follow the short path first; tune solver details only when needed.";

    const guideCard = bySlot("guide-card");
    const guideEyebrow = find(".eyebrow", guideCard ?? document);
    const guideHeading = find("h3", guideCard ?? document);
    if (guideEyebrow) guideEyebrow.textContent = "Workflow";
    if (guideHeading) guideHeading.textContent = "Guided planner";

    const launchCard = bySlot("run-rail");
    const launchEyebrow = find(".eyebrow", launchCard ?? document);
    const launchHeading = find("h3", launchCard ?? document);
    if (launchEyebrow) launchEyebrow.textContent = "Auto path";
    if (launchHeading) launchHeading.textContent = "Run recommended plan";

    const solverCard = bySlot("solver-options");
    const solverEyebrow = find(".drawer-head .eyebrow", solverCard ?? document);
    const solverHeading = find(".drawer-head h3", solverCard ?? document);
    const solverCallout = find(".solver-callout", solverCard ?? document);
    if (solverEyebrow) solverEyebrow.textContent = "Advanced";
    if (solverHeading) solverHeading.textContent = "Solver options";
    if (solverCallout) {
      solverCallout.textContent =
        "Auto is the default quality path. Keep it selected for the first run, then compare specialist optimizers only when you need deeper inspection.";
    }

    const solveButton = find("#solveButton");
    if (solveButton) solveButton.textContent = "Run Auto";
  }

  function setupGuidedSteps() {
    const steps = [...document.querySelectorAll(".workflow-steps li")];
    if (!steps.length || steps[0].querySelector(".v21-step-index")) return;

    const targets = ["#gridStage", "#controlStage", "#resultStage", "#v21ResultActions", "#v21ExpansionPanel"];
    const labels = [
      "Input grid/catalog",
      "Run Auto",
      "Review validated layout",
      "Save/export result",
      "Compare next expansion"
    ];

    steps.forEach((item, index) => {
      const link = item.querySelector("a");
      if (!link) return;
      link.href = targets[index] ?? link.href;
      link.classList.add("v21-step-link");
      link.textContent = "";

      const number = document.createElement("span");
      number.className = "v21-step-index";
      number.textContent = String(index + 1);

      const label = document.createElement("span");
      label.className = "v21-step-label";
      label.textContent = labels[index] ?? "Step";

      const status = document.createElement("span");
      status.className = "v21-step-status";
      status.textContent = "Queued";

      link.append(number, label, status);
    });
  }

  function parseIntegerText(selector) {
    const value = find(selector)?.textContent?.trim().replace(/,/g, "") ?? "";
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function hasDisplayedResult() {
    const resultContent = find("#resultsContent");
    const resultBadge = find("#resultBadge")?.textContent?.trim().toLowerCase() ?? "";
    return Boolean(resultContent && !resultContent.hidden) || !["", "waiting"].includes(resultBadge);
  }

  function hasSavedLayout() {
    const savedLayouts = find("#savedLayoutsSelect");
    const status = find("#layoutStorageStatus")?.textContent?.toLowerCase() ?? "";
    if (savedLayouts instanceof HTMLSelectElement && savedLayouts.options.length > 1) return true;
    return status.includes("saved") || status.includes("exported");
  }

  function hasExpansionComparison() {
    const metrics = find("#expansionAdviceMetrics");
    const status = find("#expansionAdviceStatus")?.textContent?.toLowerCase() ?? "";
    return Boolean(metrics && !metrics.hidden) || status.includes("recommend") || status.includes("better");
  }

  function syncGuidedSteps() {
    const steps = [...document.querySelectorAll(".workflow-steps li")];
    if (!steps.length) return;

    const inputReady =
      parseIntegerText("#summaryAllowedCells") > 0 &&
      parseIntegerText("#summaryServiceTypes") > 0 &&
      parseIntegerText("#summaryResidentialTypes") > 0;
    const resultReady = hasDisplayedResult();
    const saved = hasSavedLayout();
    const compared = hasExpansionComparison();

    const complete = [inputReady, resultReady, resultReady, saved, compared];
    const currentIndex = !inputReady ? 0 : !resultReady ? 1 : !saved ? 3 : !compared ? 4 : 2;

    steps.forEach((item, index) => {
      const state = complete[index] ? "complete" : index === currentIndex ? "current" : "queued";
      if (item.dataset.state !== state) item.dataset.state = state;
      const status = item.querySelector(".v21-step-status");
      const statusText = state === "complete" ? "Done" : state === "current" ? "Next" : "Queued";
      if (status) {
        if (status.textContent !== statusText) status.textContent = statusText;
      }
    });
  }

  function observeGuideState() {
    const sync = () => window.requestAnimationFrame(syncGuidedSteps);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["hidden", "class", "disabled"],
      characterData: true,
      childList: true,
      subtree: true
    });
    syncGuidedSteps();
  }

  function addRunReadiness() {
    const launchCard = bySlot("run-rail");
    const solverActions = find(".solver-actions", launchCard ?? document);
    if (!launchCard || !solverActions || launchCard.querySelector(".v21-readiness-list")) return;

    const readiness = document.createElement("div");
    readiness.className = "v21-readiness-list";
    readiness.setAttribute("aria-label", "Run readiness");

    const gridItem = document.createElement("span");
    const catalogItem = document.createElement("span");
    const resultItem = document.createElement("span");
    readiness.append(gridItem, catalogItem, resultItem);
    launchCard.insertBefore(readiness, solverActions);

    const sync = () => {
      const gridSize = find("#summaryGridSize")?.textContent?.trim() || "0 x 0";
      const allowedCells = find("#summaryAllowedCells")?.textContent?.trim() || "0";
      const serviceTypes = find("#summaryServiceTypes")?.textContent?.trim() || "0";
      const residentialTypes = find("#summaryResidentialTypes")?.textContent?.trim() || "0";
      const resultState = find("#resultBadge")?.textContent?.trim() || "Waiting";

      gridItem.textContent = `Grid ${gridSize}; ${allowedCells} allowed`;
      catalogItem.textContent = `Catalog ${serviceTypes} service / ${residentialTypes} residential`;
      resultItem.textContent = `Result ${resultState}`;
    };

    for (const target of [
      find("#summaryGridSize"),
      find("#summaryAllowedCells"),
      find("#summaryServiceTypes"),
      find("#summaryResidentialTypes"),
      find("#resultBadge")
    ]) {
      if (target) new MutationObserver(sync).observe(target, { childList: true, subtree: true });
    }
    sync();
  }

  function compactCpSatReadiness() {
    const status = find("#cpSatReadinessStatus");
    if (!status || status.closest(".v21-cp-sat-details")) return;

    const details = document.createElement("details");
    details.className = "v21-cp-sat-details";

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

  function tuckOptimizerPresets() {
    const presetButtons = bySlot("runtime-presets");
    const presetStatus = find("#runtimePresetStatus");
    if (!presetButtons || presetButtons.closest(".v21-alt-optimizers")) return;

    const details = document.createElement("details");
    details.className = "v21-alt-optimizers";

    const summary = document.createElement("summary");
    summary.textContent = "Try another optimizer";

    presetButtons.parentElement?.insertBefore(details, presetButtons);
    details.append(summary, presetButtons);
    if (presetStatus) details.append(presetStatus);
  }

  function syncRunButtonLabel() {
    const solveButton = find("#solveButton");
    const summaryOptimizer = find("#summaryOptimizer");
    if (!solveButton || !summaryOptimizer) return;

    const sync = () => {
      const optimizer = summaryOptimizer.textContent?.trim() || "Auto";
      solveButton.textContent = optimizer.toLowerCase() === "auto" ? "Run Auto" : `Run ${optimizer}`;
    };
    new MutationObserver(sync).observe(summaryOptimizer, { childList: true, subtree: true });
    sync();
  }

  function compactCatalogEditor() {
    const catalogStage = bySlot("stage-catalog");
    const catalogBody = bySlot("catalog-body");
    const catalogGrid = bySlot("catalog-grid");
    if (!catalogStage || !catalogBody || !catalogGrid || catalogGrid.closest(".v21-catalog-editor")) return;

    catalogStage.classList.add("v21-compact-catalog");

    const details = document.createElement("details");
    details.className = "v21-catalog-editor";

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = "Edit service and residential roster";
    const counts = document.createElement("strong");
    summary.append(title, counts);
    details.append(summary);

    catalogBody.insertBefore(details, catalogGrid);
    details.append(catalogGrid);

    const sync = () => {
      const serviceTypes = find("#summaryServiceTypes")?.textContent?.trim() || "0";
      const residentialTypes = find("#summaryResidentialTypes")?.textContent?.trim() || "0";
      counts.textContent = `${serviceTypes} service / ${residentialTypes} residential`;
    };
    for (const target of [find("#summaryServiceTypes"), find("#summaryResidentialTypes")]) {
      if (target) new MutationObserver(sync).observe(target, { childList: true, subtree: true });
    }
    sync();
  }

  function createResultActionBar() {
    const actionBar = bySlot("result-actions");
    const saveButton = actionBar?.querySelector('[data-v21-action="save-layout"]');
    const exportButton = actionBar?.querySelector('[data-v21-action="export-layouts"]');
    const compareButton = actionBar?.querySelector('[data-v21-action="compare-expansion"]');
    const status = actionBar?.querySelector("[data-v21-action-status]");
    if (
      !actionBar ||
      !(saveButton instanceof HTMLButtonElement) ||
      !(exportButton instanceof HTMLButtonElement) ||
      !(compareButton instanceof HTMLButtonElement) ||
      !(status instanceof HTMLElement)
    ) {
      return;
    }
    actionBar.hidden = false;

    saveButton.addEventListener("click", () => {
      const saveLayoutButton = find("#saveLayoutButton");
      const layoutName = find("#layoutStorageName");
      if (layoutName instanceof HTMLInputElement && !layoutName.value.trim()) {
        layoutName.value = `Layout ${new Date().toLocaleString()}`;
        layoutName.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (saveLayoutButton instanceof HTMLButtonElement && !saveLayoutButton.disabled) {
        saveLayoutButton.click();
        return;
      }
      bySlot("layout-storage")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    exportButton.addEventListener("click", () => {
      const exportLayoutsButton = find("#exportLayoutsButton");
      if (exportLayoutsButton instanceof HTMLButtonElement) exportLayoutsButton.click();
    });

    compareButton.addEventListener("click", () => {
      const expansionPanel = bySlot("expansion-panel");
      expansionPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
      find("#expansionNextService")?.focus();
    });

    const sync = () => {
      const ready = hasDisplayedResult();
      if (saveButton.disabled !== !ready) saveButton.disabled = !ready;
      if (exportButton.disabled !== !ready) exportButton.disabled = !ready;
      if (compareButton.disabled !== !ready) compareButton.disabled = !ready;
      const statusText = ready
        ? "Validated layout is ready for save, export, or expansion comparison."
        : "Run Auto or load a saved layout to enable result actions.";
      if (status.textContent !== statusText) status.textContent = statusText;
    };
    new MutationObserver(sync).observe(document.body, {
      attributes: true,
      attributeFilter: ["hidden", "disabled"],
      childList: true,
      subtree: true
    });
    sync();
  }

  function simplifyResultMapTools() {
    const mapBlock = find("#resultMapGrid")?.closest(".result-block");
    if (!(mapBlock instanceof HTMLElement) || mapBlock.querySelector(".v21-analysis-details")) return;

    const mapLegend = find(".map-legend", mapBlock);
    const editorToolbar = find(".editor-toolbar", mapBlock);
    const mapLayout = find(".map-layout", mapBlock);
    if (!mapLayout || (!mapLegend && !editorToolbar)) return;

    const details = document.createElement("details");
    details.className = "v21-analysis-details";

    const summary = document.createElement("summary");
    summary.textContent = "Analyze and edit layout";
    details.append(summary);
    if (mapLegend) details.append(mapLegend);
    if (editorToolbar) details.append(editorToolbar);
    mapBlock.insertBefore(details, mapLayout);
  }

  function restructureResults() {
    const resultStage = bySlot("stage-result");
    const moduleBody = bySlot("result-body");
    const resultHeader = find(".module-head", resultStage ?? document);
    const storagePanel = bySlot("layout-storage");
    const expansionPanel = bySlot("expansion-panel");
    const resultsContent = bySlot("result-content");
    const resultsEmpty = bySlot("result-empty");
    const resultActions = bySlot("result-actions");
    const resultColumns = bySlot("result-columns");
    const mapBlock = bySlot("result-map");
    if (!resultStage || !moduleBody || !storagePanel || !resultsContent || !resultsEmpty) return;

    resultStage.classList.add("v21-answer-results");
    storagePanel.classList.add("v21-result-storage");
    markSlot(storagePanel, "layout-storage");
    resultHeader?.querySelector(".eyebrow")?.replaceChildren(document.createTextNode("Review desk"));
    resultHeader?.querySelector("h2")?.replaceChildren(document.createTextNode("Validated layout"));

    if (resultColumns && mapBlock) {
      resultColumns.insertBefore(mapBlock, resultColumns.firstElementChild);
    }

    moduleBody.insertBefore(resultsEmpty, moduleBody.firstElementChild);
    if (resultActions) insertAfter(resultsEmpty, resultActions);
    insertAfter(resultActions ?? resultsEmpty, resultsContent);
    insertAfter(resultsContent, storagePanel);

    if (expansionPanel instanceof HTMLElement) {
      expansionPanel.id = "v21ExpansionPanel";
      expansionPanel.classList.add("v21-expansion-panel");
      markSlot(expansionPanel, "expansion-comparison");
      const eyebrow = expansionPanel.querySelector(".eyebrow");
      const heading = expansionPanel.querySelector("h3");
      if (eyebrow) eyebrow.textContent = "Decision";
      if (heading) heading.textContent = "Compare next addition";
      insertAfter(storagePanel, expansionPanel);
    }

    createResultActionBar();
    simplifyResultMapTools();
  }

  /**
   * @param {HTMLElement | null} root
   * @param {"service" | "residential"} kind
   * @returns {string[]}
   */
  function readCatalogOptions(root, kind) {
    if (!root) return [];
    return [...root.querySelectorAll("tbody tr")]
      .map((row) => {
        const inputs = [...row.querySelectorAll("input")];
        const values = inputs.map((input) => input.value.trim());
        if (kind === "service") {
          const [name, bonus, size, effective] = values;
          return name && bonus && size && effective ? `${name}, ${bonus}, ${size}, ${effective}` : "";
        }
        const [name, resident, size] = values;
        return name && resident && size ? `${name}, ${resident}, ${size}` : "";
      })
      .filter(Boolean);
  }

  function addExpansionDatalists() {
    const serviceInput = find("#expansionNextService");
    const residentialInput = find("#expansionNextResidential");
    if (!(serviceInput instanceof HTMLInputElement) || !(residentialInput instanceof HTMLInputElement)) return;

    const serviceList = document.createElement("datalist");
    serviceList.id = "v21ServiceExpansionOptions";
    const residentialList = document.createElement("datalist");
    residentialList.id = "v21ResidentialExpansionOptions";
    document.body.append(serviceList, residentialList);

    serviceInput.setAttribute("list", serviceList.id);
    residentialInput.setAttribute("list", residentialList.id);

    const sync = () => {
      serviceList.replaceChildren(
        ...readCatalogOptions(find("#serviceList"), "service").map((value) => {
          const option = document.createElement("option");
          option.value = value;
          return option;
        })
      );
      residentialList.replaceChildren(
        ...readCatalogOptions(find("#residentialList"), "residential").map((value) => {
          const option = document.createElement("option");
          option.value = value;
          return option;
        })
      );
    };

    for (const target of [find("#serviceList"), find("#residentialList")]) {
      if (target) {
        new MutationObserver(sync).observe(target, {
          attributes: true,
          attributeFilter: ["value"],
          childList: true,
          subtree: true
        });
        target.addEventListener("input", sync);
      }
    }
    sync();
  }

  function initPlannerV21() {
    addPreviewSwitcher();
    arrangeControlRail();
    relabelControlRail();
    setupGuidedSteps();
    addRunReadiness();
    tuckOptimizerPresets();
    compactCpSatReadiness();
    syncRunButtonLabel();
    compactCatalogEditor();
    restructureResults();
    addExpansionDatalists();
    observeGuideState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPlannerV21, { once: true });
  } else {
    initPlannerV21();
  }
})();
