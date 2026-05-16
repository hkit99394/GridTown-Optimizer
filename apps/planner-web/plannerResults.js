/** @param {Window & { CityBuilderResults?: unknown, PlannerHeatmaps?: any, PlannerManualLayout?: any, PlannerResultProgress?: any, PlannerResultRendering?: any }} globalObject */ (function attachPlannerResults(
  globalObject
) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {number[][]} PlannerGrid
   * @typedef {{ r: number, c: number }} ResultCell
   * @typedef {{ r: number, c: number, rows: number, cols: number, range?: number, [key: string]: any }} ResultPlacement
   * @typedef {{ kind: "service" | "residential", index: number }} ResultSelection
   * @typedef {{ kind: "service" | "residential", placement: ResultPlacement, index: number }} SelectedResultPlacement
   * @typedef {SelectedResultPlacement | null} MaybeSelectedResultPlacement
   * @typedef {JsonObject & { populations: number[], residentials: ResultPlacement[], residentialTypeIndices: number[], roads: string[], servicePopulationIncreases: number[], services: ResultPlacement[], serviceTypeIndices: number[] }} ResultSolution
   * @typedef {JsonObject & { grid: PlannerGrid, params: JsonObject }} ResultContext
   * @typedef {ResultSolution | null | undefined} MaybeResultSolution
   * @typedef {JsonObject | null | undefined} MaybeJson
   * @typedef {HTMLElement | null | undefined} MaybeElement
   * @typedef {PlannerGrid | null | undefined} MaybeGrid
   * @typedef {JsonObject & { grid: PlannerGrid, isSolving: boolean, layoutEditor: JsonObject, result: JsonObject | null, resultContext: ResultContext | null, resultElapsedMs: number, resultError: string, resultExplainabilityMode: string, resultHeatmapEnabled: boolean, resultIsLiveSnapshot: boolean, selectedMapBuilding: ResultSelection | null, selectedMapCell: ResultCell | null, solveProgressLog: JsonObject[] }} ResultsState
   * @typedef {{ LIVE_SNAPSHOT_REFRESH_INTERVAL_MS?: number }} ResultsConstants
   * @typedef {{ cloneJson: <T>(value: T) => T, formatElapsedTime: (ms: number) => string }} ResultsHelpers
   * @typedef {{ applyMatrixLayout: (gridElement: HTMLElement) => void, clearExpansionAdvice: () => void, getOptimizerLabel: (optimizer: string) => string, renderExpansionAdvice: () => void, setSolveState: (message: string) => void, syncActionAvailability: () => void }} ResultsCallbacks
   * @typedef {{ state: ResultsState, elements: JsonObject, constants?: ResultsConstants, helpers: ResultsHelpers, callbacks: ResultsCallbacks }} ResultsOptions
   * @typedef {{ keepMode?: boolean, message?: string, selectedBuilding?: ResultSelection | null, selectedCell?: ResultCell | null }} ManualLayoutResultOptions
   * @typedef {ManualLayoutResultOptions & { pendingValidation?: boolean }} CommitLayoutResultOptions
   * @typedef {{ liveSnapshot?: boolean, manualLayout?: boolean }} RenderResultOptions
   */

  const resultsGlobal =
    /** @type {Window & { CityBuilderResults?: unknown, PlannerHeatmaps?: any, PlannerManualLayout?: any, PlannerResultProgress?: any, PlannerResultRendering?: any }} */
    (globalObject);

  /** @param {ResultsOptions} options */ function createPlannerResultsController(options) {
    const { state, elements, constants = {}, helpers, callbacks } = options;
    const { LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 5 * 1000 } = constants;
    const { cloneJson, formatElapsedTime } = helpers;
    const {
      applyMatrixLayout,
      clearExpansionAdvice,
      getOptimizerLabel,
      renderExpansionAdvice,
      setSolveState,
      syncActionAvailability
    } = callbacks;
    const PENDING_MANUAL_VALIDATION_MESSAGE =
      "Manual edits are pending validation. Validate the layout when you're ready.";
    const INVALID_MANUAL_LAYOUT_MESSAGE =
      "Manual layout has validation errors. Fix them, then validate again before reusing it as a seed or hint.";
    const PENDING_MANUAL_LAYOUT_ERROR = "Manual edits are pending validation. Use Validate layout when you're ready.";
    const PLACEMENT_MODE_STATUS_PREFIX = "Click the map to set its top-left cell.";
    const EXPLAINABILITY_MODE_LABELS = {
      layout: "Layout",
      "service-value": "Service value",
      "placement-opportunity": "Placement opportunity",
      "connectivity-risk": "Connectivity risk"
    };
    if (!resultsGlobal.PlannerManualLayout?.createPlannerManualLayoutModel) {
      throw new Error("Planner manual-layout helpers are not loaded.");
    }
    const {
      buildPendingManualLayoutResult,
      buildPendingPlacementDefinition,
      buildResidentialPlacementForType,
      buildServicePlacementForType,
      cloneEditableSolution,
      ensurePlacementFitsGrid,
      ensurePlacementIsClear,
      findBuildingAtCell,
      footprintCellsForPlacement,
      getOccupiedCells,
      isCellInsideAnyServiceFootprint,
      isCellInsidePlacement,
      isCellInsideServiceEffect,
      readPendingPlacementFootprint,
      removePlacementFromSolution
    } = resultsGlobal.PlannerManualLayout.createPlannerManualLayoutModel({
      state,
      cloneJson,
      pendingManualLayoutError: PENDING_MANUAL_LAYOUT_ERROR
    });
    if (!resultsGlobal.PlannerResultRendering?.createPlannerResultAvailabilityHelpers) {
      throw new Error("Planner result rendering helpers are not loaded.");
    }
    const { countPlacementsByType, getTypeAvailabilitySummary } =
      resultsGlobal.PlannerResultRendering.createPlannerResultAvailabilityHelpers({
        state
      });
    if (!resultsGlobal.PlannerHeatmaps?.createPlannerHeatmapHelpers) {
      throw new Error("Planner heatmap helpers are not loaded.");
    }
    const {
      applyExplainabilityHeatmapStyle,
      createExplainabilityHeatmap,
      describeExplainabilityValue,
      formatExplainabilityNumber,
      getPlannerExplainabilityCell,
      hidesBuildingOverlayForMode: heatmapHidesBuildingOverlayForMode,
      normalizeExplainabilityMode
    } = resultsGlobal.PlannerHeatmaps.createPlannerHeatmapHelpers({
      state,
      explainabilityModeLabels: EXPLAINABILITY_MODE_LABELS,
      helpers: {
        footprintCellsForPlacement,
        getOccupiedCells,
        getTypeAvailabilitySummary,
        isCellInsideAnyServiceFootprint,
        isCellInsideServiceEffect
      }
    });
    if (!resultsGlobal.PlannerResultProgress?.createPlannerResultProgressHelpers) {
      throw new Error("Planner result-progress helpers are not loaded.");
    }
    const { renderProgressLog } = resultsGlobal.PlannerResultProgress.createPlannerResultProgressHelpers({
      state,
      elements,
      helpers: {
        formatElapsedTime
      },
      callbacks: {
        getOptimizerLabel
      }
    });
    const {
      clearResultOverlay,
      formatCpSatSeedStatus,
      refreshResultOverlay,
      renderGreedyDiagnostics,
      renderRemainingAvailability,
      renderSelectedBuildingDetail,
      renderSolvedMap
    } = resultsGlobal.PlannerResultRendering.createPlannerResultRenderingHelpers({
      state,
      elements,
      helpers: {
        applyExplainabilityHeatmapStyle,
        createExplainabilityHeatmap,
        describeExplainabilityValue,
        findBuildingAtCell,
        formatExplainabilityNumber,
        getPlannerExplainabilityCell,
        getSelectedMapCell,
        getSelectedMapPlacement,
        getTypeAvailabilitySummary,
        hasPendingManualValidation,
        hidesBuildingOverlayForMode: heatmapHidesBuildingOverlayForMode,
        isCellInsidePlacement,
        isCellInsideServiceEffect,
        lookupResidentialName,
        lookupServiceName,
        normalizeExplainabilityMode
      },
      callbacks: {
        applyMatrixLayout,
        getOptimizerLabel
      }
    });
    function formatLiveSnapshotRefreshCadence() {
      const seconds = Math.max(1, Math.round(LIVE_SNAPSHOT_REFRESH_INTERVAL_MS / 1000));
      if (seconds < 60) {
        return `${seconds} second${seconds === 1 ? "" : "s"}`;
      }

      const minutes = Math.round(seconds / 60);
      return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    function hasEditableLayoutContext() {
      return Boolean(state.result && state.resultContext);
    }
    function isLayoutEditBusy() {
      return Boolean(state.isSolving || state.layoutEditor.isApplying);
    }
    /** @param {string} message */ function setLayoutEditorStatus(message) {
      state.layoutEditor.status = message;
      renderLayoutEditorControls();
    }
    /** @param {number} typeIndex */ function lookupServiceName(typeIndex) {
      const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
      return type?.name || `Service Type ${typeIndex + 1}`;
    }
    /** @param {number} typeIndex */ function lookupResidentialName(typeIndex) {
      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      return type?.name || `Residential Type ${typeIndex + 1}`;
    }
    /** @param {MaybeResultSolution} solution @param {ResultSelection | null | undefined} [selection] @returns {MaybeSelectedResultPlacement} */ function getSelectedMapPlacement(
      solution,
      selection = state.selectedMapBuilding
    ) {
      if (!solution || !selection || !Number.isInteger(selection.index) || selection.index < 0) return null;
      if (selection.kind === "service") {
        const placement = solution.services?.[selection.index];
        return placement ? { kind: "service", placement, index: selection.index } : null;
      }
      if (selection.kind === "residential") {
        const placement = solution.residentials?.[selection.index];
        return placement ? { kind: "residential", placement, index: selection.index } : null;
      }
      return null;
    }
    /** @param {MaybeGrid} [grid] */ function getSelectedMapCell(grid = state.resultContext?.grid ?? state.grid) {
      if (!grid?.length || !state.selectedMapCell) return null;
      const { r, c } = state.selectedMapCell;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
      if (r < 0 || c < 0 || r >= grid.length || c >= (grid[0]?.length ?? 0)) return null;
      return { r, c };
    }
    /** @param {MaybeResultSolution} [solution] */ function getSelectedPlacementLabel(
      solution = state.result?.solution
    ) {
      const selected = getSelectedMapPlacement(solution);
      if (!selected) return "";
      return `${selected.kind === "service" ? "S" : "R"}${selected.index + 1}`;
    }
    function getManualLayoutState() {
      const manualLayout = Boolean(
        state.layoutEditor.edited || state.result?.solution?.manualLayout || state.result?.stats?.manualLayout
      );
      const pendingValidation = Boolean(manualLayout && state.layoutEditor.pendingValidation);
      const hasValidationErrors = Boolean(
        manualLayout && state.result?.validation?.valid === false && !pendingValidation
      );
      return {
        manualLayout,
        pendingValidation,
        hasValidationErrors
      };
    }
    function hasPendingManualValidation() {
      return getManualLayoutState().pendingValidation;
    }
    function hasManualLayoutValidationErrors() {
      return getManualLayoutState().hasValidationErrors;
    }
    /** @param {string} mode @param {JsonObject | null} [pendingPlacement] */ function setLayoutEditMode(
      mode,
      pendingPlacement = null
    ) {
      state.layoutEditor.mode = mode;
      state.layoutEditor.pendingPlacement = pendingPlacement;
      state.layoutEditor.status = "";
      if (mode === "inspect") {
        state.selectedMapCell = null;
      }
      syncActionAvailability();
      renderLayoutEditorControls();
    }
    function renderLayoutEditorControls() {
      if (!elements.layoutEditModeToggle || !elements.layoutEditorStatus) return;
      const pendingPlacement = state.layoutEditor.pendingPlacement;
      const selectedLabel = getSelectedPlacementLabel();
      const pendingFootprint = readPendingPlacementFootprint(pendingPlacement);

      for (const button of elements.layoutEditModeToggle.querySelectorAll("button")) {
        const isActive = button.dataset.layoutEditMode === state.layoutEditor.mode;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
      }
      if (elements.rotatePendingPlacementButton) {
        elements.rotatePendingPlacementButton.textContent = pendingPlacement?.rotated
          ? "Use original orientation"
          : "Rotate 90°";
      }

      let message = state.layoutEditor.status;
      if (!message) {
        if (!hasEditableLayoutContext()) {
          message = "Run or load a layout to edit it.";
        } else if (state.layoutEditor.isApplying) {
          message = "Validating the edited layout...";
        } else if (
          (state.layoutEditor.mode === "place-service" || state.layoutEditor.mode === "place-residential") &&
          pendingPlacement
        ) {
          message = `Placing ${pendingPlacement.name} (${pendingFootprint?.rows}x${pendingFootprint?.cols}). ${PLACEMENT_MODE_STATUS_PREFIX}`;
        } else if (state.layoutEditor.mode === "road") {
          message = "Road mode: click an empty allowed cell to add road, or an existing road cell to remove it.";
        } else if (state.layoutEditor.mode === "erase") {
          message = "Erase mode: click a road, service, or residential building to remove it.";
        } else if (state.layoutEditor.mode === "move") {
          message = selectedLabel
            ? `Move mode: click a new top-left cell for ${selectedLabel}.`
            : "Move mode: select a building first, then click its new top-left cell.";
        } else if (hasPendingManualValidation()) {
          message = PENDING_MANUAL_VALIDATION_MESSAGE;
        } else if (hasManualLayoutValidationErrors()) {
          message = INVALID_MANUAL_LAYOUT_MESSAGE;
        } else if (state.layoutEditor.edited) {
          message = "Manual edits are active. This displayed layout can be reused as an LNS seed or CP-SAT hint.";
        } else {
          message = "Inspect mode: click a map cell to inspect it, or choose a remaining building to place.";
        }
      }

      elements.layoutEditorStatus.textContent = message;
    }
    /** @param {ResultSolution} nextSolution @param {ManualLayoutResultOptions} [options] */ async function evaluateEditedLayout(
      nextSolution,
      options = {}
    ) {
      if (!state.resultContext?.grid || !state.resultContext?.params) {
        throw new Error("Run or load a layout before editing it.");
      }

      const {
        message = "Manual layout updated.",
        selectedBuilding = null,
        selectedCell = null,
        keepMode = false
      } = options;
      state.layoutEditor.isApplying = true;
      state.layoutEditor.status = "Validating the edited layout...";
      syncActionAvailability();
      renderLayoutEditorControls();

      try {
        const response = await fetch("/api/layout/evaluate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            grid: state.resultContext.grid,
            params: state.resultContext.params,
            solution: nextSolution
          })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          if (response.status === 405) {
            throw new Error(
              "Manual layout editing needs the updated web server. Restart `npm run web` once, then try the action again."
            );
          }
          throw new Error(payload.error || "Failed to evaluate the edited layout.");
        }

        const submittedRoadCount = new Set(Array.isArray(nextSolution.roads) ? nextSolution.roads : []).size;
        const validatedRoadCount = new Set(Array.isArray(payload.solution?.roads) ? payload.solution.roads : []).size;
        const removedRoadCount = Math.max(0, submittedRoadCount - validatedRoadCount);
        const roadCleanupMessage =
          removedRoadCount > 0
            ? ` Removed ${removedRoadCount} unnecessary road cell${removedRoadCount === 1 ? "" : "s"}.`
            : "";
        commitEditedLayoutResult(payload, {
          message:
            payload.validation?.valid === true
              ? `${message}${roadCleanupMessage}`
              : `Layout validation completed.${roadCleanupMessage} Review the reported issues before using this layout as a seed or hint.`,
          selectedBuilding,
          selectedCell,
          keepMode
        });
      } finally {
        state.layoutEditor.isApplying = false;
        syncActionAvailability();
        renderLayoutEditorControls();
      }
    }
    /** @param {JsonObject} nextResult @param {CommitLayoutResultOptions} [options] */ function commitEditedLayoutResult(
      nextResult,
      options = {}
    ) {
      const {
        message = "Manual layout updated.",
        selectedBuilding = null,
        selectedCell = null,
        keepMode = false,
        pendingValidation = false
      } = options;

      clearExpansionAdvice();
      state.solveProgressLog = [];
      state.result = {
        ...nextResult,
        progressLog: []
      };
      state.resultIsLiveSnapshot = false;
      state.resultError = "";
      state.selectedMapBuilding = selectedBuilding;
      state.selectedMapCell = selectedBuilding ? null : selectedCell;
      state.layoutEditor.edited = true;
      state.layoutEditor.pendingValidation = pendingValidation;
      state.layoutEditor.status = message;
      if (!keepMode) {
        state.layoutEditor.mode = "inspect";
        state.layoutEditor.pendingPlacement = null;
      }
      setSolveState(message);
      renderResults();
    }
    /** @param {ResultSolution} nextSolution @param {ManualLayoutResultOptions} [options] */ function applyEditedLayoutLocally(
      nextSolution,
      options = {}
    ) {
      const {
        message = "Manual layout updated.",
        selectedBuilding = null,
        selectedCell = null,
        keepMode = false
      } = options;
      commitEditedLayoutResult(buildPendingManualLayoutResult(nextSolution), {
        message: `${message} Validate the layout when you're ready.`,
        selectedBuilding,
        selectedCell,
        keepMode,
        pendingValidation: true
      });
    }
    /** @param {ResultSelection} selection @param {string} message */ function focusSelectedPlacement(
      selection,
      message
    ) {
      state.selectedMapBuilding = selection;
      state.selectedMapCell = null;
      state.layoutEditor.status = message;
      renderResults();
    }
    /** @param {number} row @param {number} col */ function toggleManualRoad(row, col) {
      const grid = state.resultContext?.grid ?? state.grid;
      if (grid?.[row]?.[col] !== 1) {
        throw new Error("Roads can only be edited on allowed cells.");
      }
      if (findBuildingAtCell(state.result?.solution, row, col)) {
        throw new Error("That cell is occupied by a building. Move or erase the building first.");
      }

      const nextSolution = cloneEditableSolution();
      const key = `${row},${col}`;
      const roads = new Set(nextSolution.roads ?? []);
      if (roads.has(key)) {
        roads.delete(key);
      } else {
        roads.add(key);
      }
      nextSolution.roads = Array.from(roads);
      applyEditedLayoutLocally(nextSolution, {
        message: roads.has(key) ? `Added road at (${row}, ${col}).` : `Removed road at (${row}, ${col}).`,
        selectedCell: { r: row, c: col },
        keepMode: true
      });
    }
    /** @param {number} row @param {number} col */ function eraseAtCell(row, col) {
      const selected = findBuildingAtCell(state.result?.solution, row, col);
      if (selected) {
        const nextSolution = cloneEditableSolution();
        removePlacementFromSolution(nextSolution, selected);
        applyEditedLayoutLocally(nextSolution, {
          message: `Removed ${selected.kind === "service" ? "service" : "residential"} ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
          selectedCell: { r: row, c: col },
          keepMode: true
        });
        return;
      }

      const key = `${row},${col}`;
      const nextSolution = cloneEditableSolution();
      if (!(nextSolution.roads ?? []).includes(key)) {
        throw new Error("There is no road or building at that cell to erase.");
      }
      nextSolution.roads = /** @type {string[]} */ (nextSolution.roads ?? []).filter((roadKey) => roadKey !== key);
      applyEditedLayoutLocally(nextSolution, {
        message: `Removed road at (${row}, ${col}).`,
        selectedCell: { r: row, c: col },
        keepMode: true
      });
    }
    /** @param {number} row @param {number} col */ function placePendingBuilding(row, col) {
      const pending = state.layoutEditor.pendingPlacement;
      if (!pending) {
        throw new Error("Choose a remaining building to place first.");
      }

      const grid = state.resultContext?.grid ?? state.grid;
      const nextSolution = cloneEditableSolution();

      if (pending.kind === "service") {
        const candidate = buildServicePlacementForType(pending.typeIndex, row, col, Boolean(pending.rotated));
        ensurePlacementFitsGrid(grid, candidate.placement);
        ensurePlacementIsClear(nextSolution, candidate.placement);
        nextSolution.services.push(candidate.placement);
        nextSolution.serviceTypeIndices.push(pending.typeIndex);
        nextSolution.servicePopulationIncreases.push(candidate.bonus);
        applyEditedLayoutLocally(nextSolution, {
          message: `Placed ${pending.name} at (${row}, ${col}).`,
          selectedBuilding: { kind: "service", index: nextSolution.services.length - 1 }
        });
        return;
      }

      const candidate = buildResidentialPlacementForType(pending.typeIndex, row, col, Boolean(pending.rotated));
      ensurePlacementFitsGrid(grid, candidate.placement);
      ensurePlacementIsClear(nextSolution, candidate.placement);
      nextSolution.residentials.push(candidate.placement);
      nextSolution.residentialTypeIndices.push(pending.typeIndex);
      nextSolution.populations.push(candidate.population);
      applyEditedLayoutLocally(nextSolution, {
        message: `Placed ${pending.name} at (${row}, ${col}).`,
        selectedBuilding: { kind: "residential", index: nextSolution.residentials.length - 1 }
      });
    }
    /** @param {number} row @param {number} col */ function moveSelectedBuilding(row, col) {
      const currentSolution = state.result?.solution;
      const currentSelection = getSelectedMapPlacement(currentSolution);
      const clickedSelection = findBuildingAtCell(currentSolution, row, col);

      if (!currentSelection) {
        if (!clickedSelection) {
          throw new Error("Select a building first, then click its new top-left cell.");
        }
        focusSelectedPlacement(
          clickedSelection,
          `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`
        );
        return;
      }

      if (
        clickedSelection &&
        (clickedSelection.kind !== currentSelection.kind || clickedSelection.index !== currentSelection.index)
      ) {
        focusSelectedPlacement(
          clickedSelection,
          `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`
        );
        return;
      }

      const grid = state.resultContext?.grid ?? state.grid;
      const nextSolution = cloneEditableSolution();
      const selection = getSelectedMapPlacement(nextSolution, currentSelection);
      if (!selection) {
        throw new Error("The selected building is no longer available to move.");
      }

      const nextPlacement = {
        ...selection.placement,
        r: row,
        c: col
      };
      ensurePlacementFitsGrid(grid, nextPlacement);
      ensurePlacementIsClear(nextSolution, nextPlacement, {
        excludeKind: selection.kind,
        excludeIndex: selection.index
      });

      if (selection.kind === "service") {
        nextSolution.services[selection.index] = nextPlacement;
      } else {
        nextSolution.residentials[selection.index] = nextPlacement;
      }

      applyEditedLayoutLocally(nextSolution, {
        message: `Moved ${selection.kind === "service" ? "S" : "R"}${selection.index + 1} to (${row}, ${col}).`,
        selectedBuilding: { kind: selection.kind, index: selection.index },
        keepMode: true
      });
    }
    function renderResults() {
      syncActionAvailability();
      if (state.resultError) {
        state.resultIsLiveSnapshot = false;
        state.selectedMapBuilding = null;
        state.selectedMapCell = null;
        elements.resultsEmpty.hidden = true;
        elements.resultsContent.hidden = false;
        elements.resultBadge.textContent = "Error";
        elements.resultBadge.className = "result-badge error";
        elements.validationNotice.className = "notice error";
        elements.validationNotice.textContent = state.resultError;
        elements.resultPopulation.textContent = "0";
        elements.resultRoadCount.textContent = "0";
        elements.resultServiceCount.textContent = "0";
        elements.resultResidentialCount.textContent = "0";
        elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
        elements.resultSolverStatus.textContent = "failed";
        if (elements.resultProgressSummary) {
          elements.resultProgressSummary.textContent = "The solve failed before a performance history could be shown.";
        }
        if (elements.resultProgressLog) {
          elements.resultProgressLog.innerHTML = "<li>No performance samples are available.</li>";
        }
        elements.serviceResultList.innerHTML = "<li>No service placements available.</li>";
        elements.residentialResultList.innerHTML = "<li>No residential placements available.</li>";
        elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
        elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
        renderGreedyDiagnostics(null);
        elements.resultMapGrid.innerHTML = "";
        delete elements.resultMapGrid.dataset.cols;
        clearResultOverlay();
        renderSelectedBuildingDetail(null);
        renderLayoutEditorControls();
        renderExpansionAdvice();
        return;
      }

      if (!state.result) {
        state.resultIsLiveSnapshot = false;
        state.selectedMapBuilding = null;
        state.selectedMapCell = null;
        elements.resultsEmpty.hidden = false;
        elements.resultsContent.hidden = true;
        elements.resultBadge.textContent = "Waiting";
        elements.resultBadge.className = "result-badge idle";
        elements.resultElapsed.textContent = "00:00";
        if (elements.resultProgressSummary) {
          elements.resultProgressSummary.textContent = "Run the solver to start recording a performance log.";
        }
        if (elements.resultProgressLog) {
          elements.resultProgressLog.innerHTML = "";
        }
        elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
        elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
        renderGreedyDiagnostics(null);
        elements.resultMapGrid.innerHTML = "";
        delete elements.resultMapGrid.dataset.cols;
        clearResultOverlay();
        renderSelectedBuildingDetail(null);
        renderLayoutEditorControls();
        renderExpansionAdvice();
        return;
      }

      const { solution, stats, validation } =
        /** @type {{ solution: ResultSolution, stats: JsonObject, validation: JsonObject }} */ (state.result);
      state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
      const { manualLayout, pendingValidation: pendingManualValidation } = getManualLayoutState();
      const stoppedByUser = Boolean(solution.stoppedByUser || stats.stoppedByUser);
      const liveSnapshot = Boolean(state.isSolving && state.resultIsLiveSnapshot);
      const solvedGrid = state.resultContext?.grid ?? state.grid;
      elements.resultsEmpty.hidden = true;
      elements.resultsContent.hidden = false;
      if (liveSnapshot) {
        elements.resultBadge.textContent = validation.valid ? "Live snapshot" : "Snapshot review";
        elements.resultBadge.className = `result-badge ${validation.valid ? "running" : "error"}`;
        elements.validationNotice.className = `notice ${validation.valid ? "info" : "error"}`;
        elements.validationNotice.textContent = validation.valid
          ? `Showing the best validated layout found so far while the solver keeps running. The first live capture appears as soon as an incumbent is available, then refreshes every ${formatLiveSnapshotRefreshCadence()}.`
          : `The latest running snapshot needs review: ${validation.errors.join(" ")}`;
      } else if (manualLayout) {
        elements.resultBadge.textContent = pendingManualValidation
          ? "Edited"
          : validation.valid
            ? "Manual"
            : "Manual review";
        elements.resultBadge.className = `result-badge ${pendingManualValidation ? "idle" : validation.valid ? "success" : "error"}`;
        elements.validationNotice.className = `notice ${pendingManualValidation || validation.valid ? "info" : "error"}`;
        elements.validationNotice.textContent = pendingManualValidation
          ? "Manual edits are pending validation. The map and counts reflect your edits, but legality and population will update only after you validate the layout."
          : validation.valid
            ? "This layout was manually edited and revalidated for the current grid and settings."
            : validation.errors.join(" ");
      } else {
        elements.resultBadge.textContent = validation.valid
          ? stoppedByUser
            ? "Stopped"
            : "Validated"
          : "Needs review";
        elements.resultBadge.className = `result-badge ${validation.valid ? "success" : "error"}`;
        elements.validationNotice.className = `notice ${validation.valid ? "success" : "error"}`;
        elements.validationNotice.textContent = validation.valid
          ? stoppedByUser
            ? `${getOptimizerLabel(stats.optimizer)} was stopped early. Showing the best validated result found so far.`
            : "The solver output passed validation for the current grid and settings."
          : validation.errors.join(" ");
      }

      elements.resultPopulation.textContent = pendingManualValidation
        ? "Pending"
        : Number(stats.totalPopulation).toLocaleString();
      elements.resultRoadCount.textContent = String(stats.roadCount);
      elements.resultServiceCount.textContent = String(stats.serviceCount);
      elements.resultResidentialCount.textContent = String(stats.residentialCount);
      elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
      const cpSatSeedStatus = manualLayout ? "" : formatCpSatSeedStatus(solution, stats);
      const autoStageStatus =
        stats.optimizer === "auto" && stats.activeOptimizer
          ? `Auto -> ${getOptimizerLabel(stats.activeOptimizer)}`
          : null;
      elements.resultSolverStatus.textContent = manualLayout
        ? pendingManualValidation
          ? "manual edit (pending validation)"
          : "manual edit"
        : liveSnapshot
          ? `${autoStageStatus || stats.cpSatStatus || getOptimizerLabel(stats.optimizer)} (live)${cpSatSeedStatus}`
          : stoppedByUser && stats.cpSatStatus
            ? `${stats.cpSatStatus} (stopped)${cpSatSeedStatus}`
            : `${stats.cpSatStatus || autoStageStatus || (stats.optimizer ?? "n/a")}${cpSatSeedStatus}`;

      elements.serviceResultList.innerHTML = "";
      if (solution.services.length === 0) {
        elements.serviceResultList.innerHTML = "<li>No service buildings were placed.</li>";
      } else {
        solution.services.forEach((service, index) => {
          const item = document.createElement("li");
          const typeLabel = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
          item.textContent =
            `${typeLabel} (S${index + 1}) at (${service.r}, ${service.c}) ` +
            `${service.rows}x${service.cols}, range ${service.range}, ` +
            (pendingManualValidation
              ? "effect pending validation"
              : `+${solution.servicePopulationIncreases[index] ?? 0}`);
          elements.serviceResultList.append(item);
        });
      }

      elements.residentialResultList.innerHTML = "";
      if (solution.residentials.length === 0) {
        elements.residentialResultList.innerHTML = "<li>No residential buildings were placed.</li>";
      } else {
        solution.residentials.forEach((residential, index) => {
          const item = document.createElement("li");
          const typeLabel = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
          item.textContent =
            `${typeLabel} (R${index + 1}) at (${residential.r}, ${residential.c}) ` +
            `${residential.rows}x${residential.cols}, ` +
            (pendingManualValidation ? "population pending validation" : `pop ${solution.populations[index] ?? 0}`);
          elements.residentialResultList.append(item);
        });
      }

      const serviceTypes = state.resultContext?.params?.serviceTypes ?? [];
      const residentialTypes = state.resultContext?.params?.residentialTypes ?? [];
      renderRemainingAvailability(
        elements.remainingServiceList,
        serviceTypes,
        countPlacementsByType(solution.serviceTypeIndices, serviceTypes.length),
        "Service"
      );
      renderRemainingAvailability(
        elements.remainingResidentialList,
        residentialTypes,
        countPlacementsByType(solution.residentialTypeIndices, residentialTypes.length),
        "Residential"
      );

      renderProgressLog({ liveSnapshot, manualLayout });
      renderGreedyDiagnostics(solution, { liveSnapshot, manualLayout });
      renderSolvedMap(solvedGrid, solution);
      renderLayoutEditorControls();
      renderExpansionAdvice();
    }
    function hasSelectedBuilding() {
      return Boolean(getSelectedMapPlacement(state.result?.solution));
    }
    /** @param {Event} event */ function handleLayoutEditToggleClick(event) {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-layout-edit-mode]");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.layoutEditMode) return;
      setLayoutEditMode(button.dataset.layoutEditMode);
    }
    /** @param {Event} event */ function handleRemainingPlacementClick(event) {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const typeIndex = Number(button.dataset.typeIndex);
      const name = String(button.dataset.name ?? "").trim() || "Selected building";
      if (!Number.isInteger(typeIndex) || typeIndex < 0) return;
      if (button.dataset.action === "place-remaining-service") {
        setLayoutEditMode("place-service", buildPendingPlacementDefinition("service", typeIndex, name));
      } else if (button.dataset.action === "place-remaining-residential") {
        setLayoutEditMode("place-residential", buildPendingPlacementDefinition("residential", typeIndex, name));
      }
    }
    function handleRotatePendingPlacementAction() {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      const pendingPlacement = state.layoutEditor.pendingPlacement;
      if (!pendingPlacement?.canRotate) return;
      state.layoutEditor.pendingPlacement = {
        ...pendingPlacement,
        rotated: !pendingPlacement.rotated
      };
      state.layoutEditor.status = "";
      renderLayoutEditorControls();
      syncActionAvailability();
    }
    function handleMoveSelectedAction() {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      if (!hasSelectedBuilding()) {
        setLayoutEditorStatus("Select a building first, then use Move selected.");
        return;
      }
      setLayoutEditMode("move");
    }
    function handleRemoveSelectedAction() {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      const selected = getSelectedMapPlacement(state.result?.solution);
      if (!selected) {
        setLayoutEditorStatus("Select a building first, then use Remove selected.");
        return;
      }
      try {
        const nextSolution = cloneEditableSolution();
        removePlacementFromSolution(nextSolution, selected);
        applyEditedLayoutLocally(nextSolution, {
          message: `Removed ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`
        });
      } catch (error) {
        setLayoutEditorStatus(error instanceof Error ? error.message : "Failed to remove the selected building.");
      }
    }
    async function handleValidateEditedLayoutAction() {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      if (!state.layoutEditor.pendingValidation) {
        setLayoutEditorStatus(
          state.layoutEditor.edited
            ? "This manual layout is already validated."
            : "Make a manual edit first, then validate the layout."
        );
        return;
      }

      try {
        await evaluateEditedLayout(cloneEditableSolution(), {
          message: "Manual layout validated.",
          selectedBuilding: state.selectedMapBuilding,
          selectedCell: state.selectedMapCell,
          keepMode: true
        });
      } catch (error) {
        setLayoutEditorStatus(error instanceof Error ? error.message : "Failed to validate the edited layout.");
      }
    }
    /** @param {Event} event */ function handleResultMapClick(event) {
      const target = event.target;
      if (!(target instanceof Element) || !state.result?.solution) return;
      const cell = target.closest(".grid-cell");
      if (!(cell instanceof HTMLDivElement)) return;
      const row = Number(cell.dataset.r);
      const col = Number(cell.dataset.c);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;

      try {
        if (state.isSolving || state.layoutEditor.isApplying) {
          if (state.layoutEditor.mode !== "inspect") return;
        }
        if (state.layoutEditor.mode === "road") {
          toggleManualRoad(row, col);
          return;
        }
        if (state.layoutEditor.mode === "erase") {
          eraseAtCell(row, col);
          return;
        }
        if (state.layoutEditor.mode === "move") {
          moveSelectedBuilding(row, col);
          return;
        }
        if (state.layoutEditor.mode === "place-service" || state.layoutEditor.mode === "place-residential") {
          placePendingBuilding(row, col);
          return;
        }

        const selected = findBuildingAtCell(state.result.solution, row, col);
        state.selectedMapBuilding = selected;
        state.selectedMapCell = selected ? null : { r: row, c: col };
        renderSolvedMap(state.resultContext?.grid ?? state.grid, state.result.solution);
        renderLayoutEditorControls();
      } catch (error) {
        setLayoutEditorStatus(error instanceof Error ? error.message : "Failed to apply that manual edit.");
      }
    }

    return Object.freeze({
      getSelectedMapPlacement,
      handleLayoutEditToggleClick,
      handleMoveSelectedAction,
      handleRemainingPlacementClick,
      handleRemoveSelectedAction,
      handleRotatePendingPlacementAction,
      handleValidateEditedLayoutAction,
      handleResultMapClick,
      hasSelectedBuilding,
      refreshResultOverlay,
      renderLayoutEditorControls,
      renderResults,
      setLayoutEditMode
    });
  }

  resultsGlobal.CityBuilderResults = Object.freeze({
    createPlannerResultsController
  });
})(window);
