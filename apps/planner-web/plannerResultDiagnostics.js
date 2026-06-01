/**
 * @param {Window & { PlannerResultDiagnostics?: unknown }} globalObject
 */
(function attachPlannerResultDiagnostics(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {HTMLElement | null | undefined} MaybeElement
   * @typedef {JsonObject | null | undefined} MaybeJson
   * @typedef {{ lookupResidentialName: (typeIndex: number) => string, lookupServiceName: (typeIndex: number) => string }} DiagnosticHelpers
   * @typedef {{ elements: JsonObject, helpers: DiagnosticHelpers }} DiagnosticOptions
   */

  const diagnosticReasonOrder = [
    "blocked-footprint",
    "no-road-path",
    "no-service-coverage",
    "base-only",
    "availability-cap",
    "lower-score-no-improvement"
  ];
  const diagnosticReasonLabels = /** @type {Record<string, string>} */ ({
    "blocked-footprint": "Blocked footprint",
    "no-road-path": "No road path",
    "no-service-coverage": "No service coverage",
    "base-only": "Base population only",
    "availability-cap": "Availability cap",
    "lower-score-no-improvement": "Lower score / no improvement"
  });

  /**
   * @param {DiagnosticOptions} options
   */
  function createPlannerResultDiagnosticsHelpers(options) {
    const { elements, helpers } = options;
    const { lookupResidentialName, lookupServiceName } = helpers;

    /**
     * @param {unknown} value
     */
    function formatDiagnosticCount(value) {
      return Number(value ?? 0).toLocaleString();
    }

    /**
     * @param {JsonObject} example
     */
    function formatDiagnosticExample(example) {
      const idPrefix = example.kind === "service" ? "S" : "R";
      const typeName =
        example.typeName ||
        (example.kind === "service" ? lookupServiceName(example.typeIndex) : lookupResidentialName(example.typeIndex));
      const parts = [
        `${typeName || `${idPrefix} type ${Number(example.typeIndex ?? -1) + 1}`} at (${example.r}, ${example.c})`,
        `${example.rows}x${example.cols}`
      ];
      if (typeof example.score === "number" && Number.isFinite(example.score)) {
        parts.push(`score ${formatDiagnosticCount(example.score)}`);
      }
      if (typeof example.population === "number" && Number.isFinite(example.population)) {
        parts.push(`pop ${formatDiagnosticCount(example.population)}`);
      }
      if (typeof example.basePopulation === "number" && Number.isFinite(example.basePopulation)) {
        parts.push(`base ${formatDiagnosticCount(example.basePopulation)}`);
      }
      return parts.join(", ");
    }

    /**
     * @param {MaybeElement} listElement
     * @param {MaybeJson} report
     * @param {string} emptyLabel
     */
    function renderDiagnosticKindReport(listElement, report, emptyLabel) {
      if (!listElement) return;
      listElement.innerHTML = "";

      const reasonEntries = diagnosticReasonOrder
        .map((reason) => ({
          reason,
          count: Number(report?.reasonCounts?.[reason] ?? 0),
          examples: Array.isArray(report?.examplesByReason?.[reason]) ? report.examplesByReason[reason] : []
        }))
        .filter((entry) => entry.count > 0);

      if (reasonEntries.length === 0) {
        listElement.innerHTML = `<li>${emptyLabel}</li>`;
        return;
      }

      reasonEntries.forEach((entry) => {
        const item = document.createElement("li");
        const stamp = document.createElement("strong");
        stamp.className = "progress-log-stamp";
        stamp.textContent = `${diagnosticReasonLabels[entry.reason]}: ${formatDiagnosticCount(entry.count)}`;

        const detail = document.createElement("span");
        detail.className = "progress-log-detail";
        const examples = entry.examples.map(formatDiagnosticExample);
        detail.textContent =
          examples.length > 0
            ? `Examples: ${examples.join(" | ")}`
            : "No bounded examples were captured for this reason.";

        item.append(stamp, detail);
        listElement.append(item);
      });
    }

    /**
     * @param {JsonObject | null | undefined} solution
     * @param {{ liveSnapshot?: boolean, manualLayout?: boolean }} [options]
     */
    function renderGreedyDiagnostics(solution, options = {}) {
      if (!elements.greedyDiagnosticsBlock) return;
      const diagnostics = solution?.greedyDiagnostics;
      if (!diagnostics || options.manualLayout || options.liveSnapshot) {
        elements.greedyDiagnosticsBlock.hidden = true;
        return;
      }

      elements.greedyDiagnosticsBlock.hidden = false;
      const serviceScanned = diagnostics.services?.candidatesScanned ?? 0;
      const residentialScanned = diagnostics.residentials?.candidatesScanned ?? 0;
      const truncated = diagnostics.services?.truncated || diagnostics.residentials?.truncated;
      if (elements.greedyDiagnosticsSummary) {
        elements.greedyDiagnosticsSummary.textContent =
          `Scanned ${formatDiagnosticCount(serviceScanned)} unplaced service candidates and ` +
          `${formatDiagnosticCount(residentialScanned)} unplaced residential candidates` +
          `${truncated ? `, capped at ${formatDiagnosticCount(diagnostics.candidateLimit)} per category` : ""}.`;
      }

      renderDiagnosticKindReport(
        elements.greedyDiagnosticsServiceList,
        diagnostics.services,
        "No service blockers were recorded."
      );
      renderDiagnosticKindReport(
        elements.greedyDiagnosticsResidentialList,
        diagnostics.residentials,
        "No residential blockers were recorded."
      );
    }

    return Object.freeze({
      renderGreedyDiagnostics
    });
  }

  const diagnosticsGlobal = /** @type {Window & { PlannerResultDiagnostics?: unknown }} */ (globalObject);
  diagnosticsGlobal.PlannerResultDiagnostics = Object.freeze({
    createPlannerResultDiagnosticsHelpers
  });
})(window);
