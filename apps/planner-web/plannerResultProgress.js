/**
 * @param {Window & { PlannerResultProgress?: unknown }} globalObject
 */
(function attachPlannerResultProgress(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {{ result?: JsonObject | null, solveProgressLog?: JsonObject[] }} ProgressState
   * @typedef {{ resultProgressSummary?: HTMLElement | null, resultProgressLog?: HTMLElement | null }} ProgressElements
   * @typedef {{ formatElapsedTime: (ms: number) => string }} ProgressHelpers
   * @typedef {{ getOptimizerLabel: (optimizer: string) => string }} ProgressCallbacks
   * @typedef {{ state: ProgressState, elements: ProgressElements, helpers: ProgressHelpers, callbacks: ProgressCallbacks }} ProgressOptions
   * @typedef {{ liveSnapshot?: boolean, manualLayout?: boolean }} RenderProgressOptions
   * @typedef {{ maximumFractionDigits?: number }} ProgressNumberOptions
   */

  /**
   * @param {ProgressOptions} options
   */
  function createPlannerResultProgressHelpers(options) {
    const { state, elements, helpers, callbacks } = options;
    const { formatElapsedTime } = helpers;
    const { getOptimizerLabel } = callbacks;

    /**
     * @param {unknown} value
     * @param {ProgressNumberOptions} [options]
     * @returns {string | null}
     */
    function formatProgressLogNumber(value, options = {}) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const { maximumFractionDigits = 0 } = options;
      return Number(value).toLocaleString(undefined, { maximumFractionDigits });
    }

    /**
     * @param {JsonObject | null | undefined} summary
     * @returns {string[]}
     */
    function formatProgressSummaryParts(summary) {
      if (!summary) return [];
      const parts = [];
      const currentScore = formatProgressLogNumber(summary.currentScore);
      const bestScore = formatProgressLogNumber(summary.bestScore);
      if (currentScore !== null) {
        parts.push(`current ${currentScore}`);
      }
      if (bestScore !== null && bestScore !== currentScore) {
        parts.push(`best ${bestScore}`);
      }
      if (summary.activeStage) {
        parts.push(`stage ${getOptimizerLabel(summary.activeStage)}`);
      }
      if (summary.reuseSource) {
        parts.push(`reuse ${summary.reuseSource}`);
      }
      const elapsed = formatProgressLogNumber(summary.elapsedTimeSeconds, { maximumFractionDigits: 1 });
      if (elapsed !== null) {
        parts.push(`elapsed ${elapsed}s`);
      }
      const sinceImprovement = formatProgressLogNumber(summary.timeSinceImprovementSeconds, {
        maximumFractionDigits: 1
      });
      if (sinceImprovement !== null) {
        parts.push(`last improvement ${sinceImprovement}s ago`);
      }
      if (summary.stopReason) {
        parts.push(`stop ${summary.stopReason}`);
      }
      const gap = formatProgressLogNumber(summary.exactGap);
      if (gap !== null) {
        parts.push(`gap <= ${gap}`);
      }
      if (summary.portfolioWorkerSummary) {
        parts.push(
          `portfolio ${summary.portfolioWorkerSummary.feasibleWorkers}/${summary.portfolioWorkerSummary.workerCount} feasible`
        );
      }
      return parts;
    }

    /**
     * @returns {JsonObject[]}
     */
    function getResultProgressLogEntries() {
      return Array.isArray(state.result?.progressLog)
        ? state.result.progressLog
        : Array.isArray(state.solveProgressLog)
          ? state.solveProgressLog
          : [];
    }

    /**
     * @param {RenderProgressOptions} [options]
     */
    function renderProgressLog(options = {}) {
      if (!elements.resultProgressSummary || !elements.resultProgressLog) return;

      const progressSummary = elements.resultProgressSummary;
      const progressLog = elements.resultProgressLog;
      const { liveSnapshot = false, manualLayout = false } = options;
      const entries = getResultProgressLogEntries();

      progressLog.innerHTML = "";

      if (manualLayout) {
        progressSummary.textContent = "Manual layout edits clear the recorded solver performance history.";
        progressLog.innerHTML = "<li>No solver samples are attached to this manual layout.</li>";
        return;
      }

      if (entries.length === 0) {
        progressSummary.textContent = liveSnapshot
          ? "Waiting for the first feasible snapshot before the performance log can start."
          : "No performance samples were recorded for this layout.";
        progressLog.innerHTML = "<li>No live or final progress samples are available.</li>";
        return;
      }

      progressSummary.textContent = liveSnapshot
        ? `Recorded ${entries.length} performance sample${entries.length === 1 ? "" : "s"} so far. A new row is added whenever the live snapshot refreshes.`
        : `Recorded ${entries.length} performance sample${entries.length === 1 ? "" : "s"} for this solve, including the final result.`;

      entries.forEach((entry) => {
        const item = document.createElement("li");
        const stamp = document.createElement("strong");
        stamp.className = "progress-log-stamp";
        stamp.textContent = formatElapsedTime(entry.elapsedMs ?? 0);

        const detail = document.createElement("span");
        detail.className = "progress-log-detail";

        const parts = [];
        const sourceLabel = entry.source === "final-result" ? "Final" : "Snapshot";
        const optimizerLabel = entry.optimizer ? getOptimizerLabel(entry.optimizer) : "Solver";
        parts.push(`${sourceLabel} ${optimizerLabel}`);
        const summaryParts = formatProgressSummaryParts(entry.progressSummary);
        if (summaryParts.length > 0) {
          parts.push(...summaryParts);
        } else if (entry.optimizer === "auto" && entry.activeOptimizer) {
          parts.push(`stage ${getOptimizerLabel(entry.activeOptimizer)}`);
        }
        if (entry.autoStage?.cycleIndex > 0) {
          parts.push(`cycle ${entry.autoStage.cycleIndex}`);
        }
        if (entry.autoStage?.generatedSeeds?.length) {
          const lastSeed = entry.autoStage.generatedSeeds[entry.autoStage.generatedSeeds.length - 1];
          if (lastSeed?.randomSeed != null) {
            parts.push(`seed ${lastSeed.randomSeed}`);
          }
        }
        if (!entry.progressSummary?.stopReason && entry.autoStage?.stopReason) {
          parts.push(`stop ${entry.autoStage.stopReason}`);
        }
        if (entry.lnsNeighborhoodStatus) {
          const lnsImprovement = Number(entry.lnsNeighborhoodImprovement ?? 0);
          parts.push(`LNS ${entry.lnsNeighborhoodStatus}${lnsImprovement > 0 ? ` +${lnsImprovement}` : ""}`);
        }
        if (!entry.progressSummary?.stopReason && entry.lnsStopReason && entry.lnsStopReason !== "running") {
          parts.push(`LNS stop ${entry.lnsStopReason}`);
        }
        if (!entry.progressSummary && typeof entry.totalPopulation === "number") {
          parts.push(`${Number(entry.totalPopulation).toLocaleString()} population`);
        }
        if (entry.cpSatStatus) {
          parts.push(entry.cpSatStatus);
        }
        const boundLabel = entry.progressSummary ? null : formatProgressLogNumber(entry.bestPopulationUpperBound);
        if (boundLabel !== null) {
          parts.push(`bound <= ${boundLabel}`);
        }
        const gapLabel = entry.progressSummary ? null : formatProgressLogNumber(entry.populationGapUpperBound);
        if (gapLabel !== null) {
          parts.push(`gap <= ${gapLabel}`);
        }
        const improvementLabel = entry.progressSummary
          ? null
          : formatProgressLogNumber(entry.secondsSinceLastImprovement, {
              maximumFractionDigits: 1
            });
        if (improvementLabel !== null) {
          parts.push(`last improvement ${improvementLabel}s ago`);
        }
        if (entry.note && !parts.includes(entry.note)) {
          parts.push(entry.note);
        }

        detail.textContent = parts.join(" • ");
        item.append(stamp, detail);
        progressLog.append(item);
      });
    }

    return Object.freeze({
      renderProgressLog
    });
  }

  const progressGlobal = /** @type {Window & { PlannerResultProgress?: unknown }} */ (globalObject);

  progressGlobal.PlannerResultProgress = Object.freeze({
    createPlannerResultProgressHelpers
  });
})(window);
