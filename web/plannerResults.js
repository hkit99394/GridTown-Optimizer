(function attachPlannerResults(globalObject) {
  function createPlannerResultsController(options) {
    const {
      state,
      elements,
      constants = {},
      helpers,
      callbacks,
    } = options;
    const {
      LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 5 * 1000,
    } = constants;
    const {
      cloneJson,
      formatElapsedTime,
    } = helpers;
    const {
      applyMatrixLayout,
      clearExpansionAdvice,
      getOptimizerLabel,
      renderExpansionAdvice,
      setSolveState,
      syncActionAvailability,
    } = callbacks;
    const PENDING_MANUAL_VALIDATION_MESSAGE = "Manual edits are pending validation. Validate the layout when you're ready.";
    const INVALID_MANUAL_LAYOUT_MESSAGE =
      "Manual layout has validation errors. Fix them, then validate again before reusing it as a seed or hint.";
    const PENDING_MANUAL_LAYOUT_ERROR =
      "Manual edits are pending validation. Use Validate layout when you're ready.";
    const PLACEMENT_MODE_STATUS_PREFIX = "Click the map to set its top-left cell.";
    const DIAGNOSTIC_REASON_ORDER = [
      "blocked-footprint",
      "no-road-path",
      "no-service-coverage",
      "base-only",
      "availability-cap",
      "lower-score-no-improvement",
    ];
    const DIAGNOSTIC_REASON_LABELS = {
      "blocked-footprint": "Blocked footprint",
      "no-road-path": "No road path",
      "no-service-coverage": "No service coverage",
      "base-only": "Base population only",
      "availability-cap": "Availability cap",
      "lower-score-no-improvement": "Lower score / no improvement",
    };

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

    function setLayoutEditorStatus(message) {
      state.layoutEditor.status = message;
      renderLayoutEditorControls();
    }

    function lookupServiceName(typeIndex) {
      const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
      return type?.name || `Service Type ${typeIndex + 1}`;
    }

    function lookupResidentialName(typeIndex) {
      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      return type?.name || `Residential Type ${typeIndex + 1}`;
    }

    function getSelectedMapPlacement(solution, selection = state.selectedMapBuilding) {
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

    function getSelectedMapCell(grid = state.resultContext?.grid ?? state.grid) {
      if (!grid?.length || !state.selectedMapCell) return null;
      const { r, c } = state.selectedMapCell;
      if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
      if (r < 0 || c < 0 || r >= grid.length || c >= (grid[0]?.length ?? 0)) return null;
      return { r, c };
    }

    function getTypeTotalAvailable(type, isService) {
      const fallback = isService ? 1 : 0;
      const rawAvailable = type?.avail ?? fallback;
      const parsedAvailable = Number(rawAvailable);
      return Number.isFinite(parsedAvailable) ? Math.max(0, Math.floor(parsedAvailable)) : fallback;
    }

    function getSelectedPlacementLabel(solution = state.result?.solution) {
      const selected = getSelectedMapPlacement(solution);
      if (!selected) return "";
      return `${selected.kind === "service" ? "S" : "R"}${selected.index + 1}`;
    }

    function swapPlacementDimensions(placement) {
      return {
        ...placement,
        rows: placement.cols,
        cols: placement.rows,
      };
    }

    function buildPendingPlacementDefinition(kind, typeIndex, name) {
      if (kind === "service") {
        const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
        if (!type) throw new Error("That service type is no longer available in the current settings.");
        return {
          kind,
          typeIndex,
          name,
          rows: Number(type.rows),
          cols: Number(type.cols),
          rotated: false,
          canRotate: (type.allowRotation ?? true) && Number(type.rows) !== Number(type.cols),
        };
      }

      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      if (!type) throw new Error("That residential type is no longer available in the current settings.");
      return {
        kind,
        typeIndex,
        name,
        rows: Number(type.h),
        cols: Number(type.w),
        rotated: false,
        canRotate: Number(type.h) !== Number(type.w),
      };
    }

    function readPendingPlacementFootprint(pendingPlacement) {
      if (!pendingPlacement) return null;
      return pendingPlacement.rotated
        ? { rows: pendingPlacement.cols, cols: pendingPlacement.rows }
        : { rows: pendingPlacement.rows, cols: pendingPlacement.cols };
    }

    function getManualLayoutState() {
      const manualLayout = Boolean(
        state.layoutEditor.edited
        || state.result?.solution?.manualLayout
        || state.result?.stats?.manualLayout
      );
      const pendingValidation = Boolean(manualLayout && state.layoutEditor.pendingValidation);
      const hasValidationErrors = Boolean(
        manualLayout
        && state.result?.validation?.valid === false
        && !pendingValidation
      );
      return {
        manualLayout,
        pendingValidation,
        hasValidationErrors,
      };
    }

    function isManualLayoutResult() {
      return getManualLayoutState().manualLayout;
    }

    function hasPendingManualValidation() {
      return getManualLayoutState().pendingValidation;
    }

    function hasManualLayoutValidationErrors() {
      return getManualLayoutState().hasValidationErrors;
    }

    function setLayoutEditMode(mode, pendingPlacement = null) {
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
        elements.rotatePendingPlacementButton.textContent = pendingPlacement?.rotated ? "Use original orientation" : "Rotate 90°";
      }

      let message = state.layoutEditor.status;
      if (!message) {
        if (!hasEditableLayoutContext()) {
          message = "Run or load a layout to edit it.";
        } else if (state.layoutEditor.isApplying) {
          message = "Validating the edited layout...";
        } else if ((state.layoutEditor.mode === "place-service" || state.layoutEditor.mode === "place-residential") && pendingPlacement) {
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

    function footprintCellsForPlacement(placement) {
      const cells = [];
      for (let dr = 0; dr < placement.rows; dr += 1) {
        for (let dc = 0; dc < placement.cols; dc += 1) {
          cells.push({ r: placement.r + dr, c: placement.c + dc });
        }
      }
      return cells;
    }

    function getOccupiedCells(solution, options = {}) {
      const { excludeKind = null, excludeIndex = -1 } = options;
      const occupied = new Set();

      (solution.services ?? []).forEach((service, index) => {
        if (excludeKind === "service" && excludeIndex === index) return;
        footprintCellsForPlacement(service).forEach((cell) => occupied.add(`${cell.r},${cell.c}`));
      });

      (solution.residentials ?? []).forEach((residential, index) => {
        if (excludeKind === "residential" && excludeIndex === index) return;
        footprintCellsForPlacement(residential).forEach((cell) => occupied.add(`${cell.r},${cell.c}`));
      });

      return occupied;
    }

    function ensurePlacementFitsGrid(grid, placement) {
      if (!grid?.length) throw new Error("No grid is available for manual editing.");
      if (placement.r < 0 || placement.c < 0) {
        throw new Error("Placements must stay within the grid.");
      }
      if (placement.r + placement.rows > grid.length || placement.c + placement.cols > (grid[0]?.length ?? 0)) {
        throw new Error("That building would extend beyond the grid.");
      }

      footprintCellsForPlacement(placement).forEach((cell) => {
        if (grid[cell.r]?.[cell.c] !== 1) {
          throw new Error("That placement touches a blocked cell.");
        }
      });
    }

    function ensurePlacementIsClear(solution, placement, options = {}) {
      const occupied = getOccupiedCells(solution, options);
      const roads = new Set(solution.roads ?? []);

      footprintCellsForPlacement(placement).forEach((cell) => {
        const key = `${cell.r},${cell.c}`;
        if (occupied.has(key)) {
          throw new Error("That placement overlaps another building.");
        }
        if (roads.has(key)) {
          throw new Error("That placement overlaps a road. Remove the road first or choose another cell.");
        }
      });
    }

    function buildServicePlacementForType(typeIndex, row, col, rotated = false) {
      const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
      if (!type) throw new Error("That service type is no longer available in the current settings.");
      const basePlacement = {
        r: row,
        c: col,
        rows: Number(type.rows),
        cols: Number(type.cols),
        range: Number(type.range),
      };
      return {
        placement: rotated ? swapPlacementDimensions(basePlacement) : basePlacement,
        bonus: Number(type.bonus ?? 0),
        name: type.name || `Service Type ${typeIndex + 1}`,
      };
    }

    function buildResidentialPlacementForType(typeIndex, row, col, rotated = false) {
      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      if (!type) throw new Error("That residential type is no longer available in the current settings.");
      const basePlacement = {
        r: row,
        c: col,
        rows: Number(type.h),
        cols: Number(type.w),
      };
      return {
        placement: rotated ? swapPlacementDimensions(basePlacement) : basePlacement,
        population: Number(type.min ?? 0),
        name: type.name || `Residential Type ${typeIndex + 1}`,
      };
    }

    async function evaluateEditedLayout(nextSolution, options = {}) {
      if (!state.resultContext?.grid || !state.resultContext?.params) {
        throw new Error("Run or load a layout before editing it.");
      }

      const { message = "Manual layout updated.", selectedBuilding = null, selectedCell = null, keepMode = false } = options;
      state.layoutEditor.isApplying = true;
      state.layoutEditor.status = "Validating the edited layout...";
      syncActionAvailability();
      renderLayoutEditorControls();

      try {
        const response = await fetch("/api/layout/evaluate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            grid: state.resultContext.grid,
            params: state.resultContext.params,
            solution: nextSolution,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          if (response.status === 405) {
            throw new Error("Manual layout editing needs the updated web server. Restart `npm run web` once, then try the action again.");
          }
          throw new Error(payload.error || "Failed to evaluate the edited layout.");
        }

        const submittedRoadCount = new Set(Array.isArray(nextSolution.roads) ? nextSolution.roads : []).size;
        const validatedRoadCount = new Set(Array.isArray(payload.solution?.roads) ? payload.solution.roads : []).size;
        const removedRoadCount = Math.max(0, submittedRoadCount - validatedRoadCount);
        const roadCleanupMessage = removedRoadCount > 0
          ? ` Removed ${removedRoadCount} unnecessary road cell${removedRoadCount === 1 ? "" : "s"}.`
          : "";
        commitEditedLayoutResult(payload, {
          message: payload.validation?.valid === true
            ? `${message}${roadCleanupMessage}`
            : `Layout validation completed.${roadCleanupMessage} Review the reported issues before using this layout as a seed or hint.`,
          selectedBuilding,
          selectedCell,
          keepMode,
        });
      } finally {
        state.layoutEditor.isApplying = false;
        syncActionAvailability();
        renderLayoutEditorControls();
      }
    }

    function cloneEditableSolution() {
      if (!state.result?.solution) {
        throw new Error("Run or load a layout before editing it.");
      }
      return cloneJson(state.result.solution);
    }

    function sumRecordedResidentialPopulation(solution) {
      return (solution?.populations ?? []).reduce((sum, population) => {
        const numericPopulation = Number(population);
        return Number.isFinite(numericPopulation) ? sum + numericPopulation : sum;
      }, 0);
    }

    function buildPendingManualLayoutResult(nextSolution) {
      const normalizedSolution = {
        ...nextSolution,
        optimizer: undefined,
        activeOptimizer: undefined,
        autoStage: undefined,
        manualLayout: true,
        cpSatStatus: undefined,
        cpSatObjectivePolicy: undefined,
        cpSatTelemetry: undefined,
        cpSatPortfolio: undefined,
        stoppedByUser: false,
        totalPopulation: sumRecordedResidentialPopulation(nextSolution),
      };

      return {
        solution: normalizedSolution,
        validation: {
          valid: false,
          errors: [PENDING_MANUAL_LAYOUT_ERROR],
          recomputedPopulations: [],
          recomputedTotalPopulation: normalizedSolution.totalPopulation,
          mapRows: [],
          mapText: "",
        },
        stats: {
          optimizer: normalizedSolution.optimizer,
          activeOptimizer: normalizedSolution.activeOptimizer,
          autoStage: normalizedSolution.autoStage,
          manualLayout: true,
          cpSatStatus: null,
          stoppedByUser: false,
          totalPopulation: normalizedSolution.totalPopulation,
          roadCount: normalizedSolution.roads?.length ?? 0,
          serviceCount: normalizedSolution.services?.length ?? 0,
          residentialCount: normalizedSolution.residentials?.length ?? 0,
        },
      };
    }

    function commitEditedLayoutResult(nextResult, options = {}) {
      const {
        message = "Manual layout updated.",
        selectedBuilding = null,
        selectedCell = null,
        keepMode = false,
        pendingValidation = false,
      } = options;

      clearExpansionAdvice();
      state.solveProgressLog = [];
      state.result = {
        ...nextResult,
        progressLog: [],
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

    function applyEditedLayoutLocally(nextSolution, options = {}) {
      const {
        message = "Manual layout updated.",
        selectedBuilding = null,
        selectedCell = null,
        keepMode = false,
      } = options;
      commitEditedLayoutResult(buildPendingManualLayoutResult(nextSolution), {
        message: `${message} Validate the layout when you're ready.`,
        selectedBuilding,
        selectedCell,
        keepMode,
        pendingValidation: true,
      });
    }

    function removePlacementFromSolution(solution, selection) {
      if (!selection) throw new Error("Select a building first.");
      if (selection.kind === "service") {
        solution.services.splice(selection.index, 1);
        solution.serviceTypeIndices.splice(selection.index, 1);
        solution.servicePopulationIncreases.splice(selection.index, 1);
        return;
      }
      if (selection.kind === "residential") {
        solution.residentials.splice(selection.index, 1);
        solution.residentialTypeIndices.splice(selection.index, 1);
        solution.populations.splice(selection.index, 1);
      }
    }

    function focusSelectedPlacement(selection, message) {
      state.selectedMapBuilding = selection;
      state.selectedMapCell = null;
      state.layoutEditor.status = message;
      renderResults();
    }

    function toggleManualRoad(row, col) {
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
        keepMode: true,
      });
    }

    function eraseAtCell(row, col) {
      const selected = findBuildingAtCell(state.result?.solution, row, col);
      if (selected) {
        const nextSolution = cloneEditableSolution();
        removePlacementFromSolution(nextSolution, selected);
        applyEditedLayoutLocally(nextSolution, {
          message: `Removed ${selected.kind === "service" ? "service" : "residential"} ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
          selectedCell: { r: row, c: col },
          keepMode: true,
        });
        return;
      }

      const key = `${row},${col}`;
      const nextSolution = cloneEditableSolution();
      if (!(nextSolution.roads ?? []).includes(key)) {
        throw new Error("There is no road or building at that cell to erase.");
      }
      nextSolution.roads = (nextSolution.roads ?? []).filter((roadKey) => roadKey !== key);
      applyEditedLayoutLocally(nextSolution, {
        message: `Removed road at (${row}, ${col}).`,
        selectedCell: { r: row, c: col },
        keepMode: true,
      });
    }

    function placePendingBuilding(row, col) {
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
          selectedBuilding: { kind: "service", index: nextSolution.services.length - 1 },
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
        selectedBuilding: { kind: "residential", index: nextSolution.residentials.length - 1 },
      });
    }

    function moveSelectedBuilding(row, col) {
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
        clickedSelection
        && (clickedSelection.kind !== currentSelection.kind || clickedSelection.index !== currentSelection.index)
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
        c: col,
      };
      ensurePlacementFitsGrid(grid, nextPlacement);
      ensurePlacementIsClear(nextSolution, nextPlacement, {
        excludeKind: selection.kind,
        excludeIndex: selection.index,
      });

      if (selection.kind === "service") {
        nextSolution.services[selection.index] = nextPlacement;
      } else {
        nextSolution.residentials[selection.index] = nextPlacement;
      }

      applyEditedLayoutLocally(nextSolution, {
        message: `Moved ${selection.kind === "service" ? "S" : "R"}${selection.index + 1} to (${row}, ${col}).`,
        selectedBuilding: { kind: selection.kind, index: selection.index },
        keepMode: true,
      });
    }

    function findBuildingAtCell(solution, row, col) {
      if (!solution || !Number.isInteger(row) || !Number.isInteger(col)) return null;

      for (let index = 0; index < (solution.services?.length ?? 0); index += 1) {
        const service = solution.services[index];
        if (
          row >= service.r
          && row < service.r + service.rows
          && col >= service.c
          && col < service.c + service.cols
        ) {
          return { kind: "service", index };
        }
      }

      for (let index = 0; index < (solution.residentials?.length ?? 0); index += 1) {
        const residential = solution.residentials[index];
        if (
          row >= residential.r
          && row < residential.r + residential.rows
          && col >= residential.c
          && col < residential.c + residential.cols
        ) {
          return { kind: "residential", index };
        }
      }

      return null;
    }

    function isCellInsidePlacement(placement, row, col) {
      return Boolean(
        placement
        && row >= placement.r
        && row < placement.r + placement.rows
        && col >= placement.c
        && col < placement.c + placement.cols
      );
    }

    function isCellInsideServiceEffect(service, row, col) {
      return Boolean(
        service
        && row >= service.r - service.range
        && row <= service.r + service.rows - 1 + service.range
        && col >= service.c - service.range
        && col <= service.c + service.cols - 1 + service.range
      );
    }

    function isCellInsideAnyServiceFootprint(solution, row, col) {
      return (solution?.services ?? []).some((service) => isCellInsidePlacement(service, row, col));
    }

    function getSolvedCellKind(grid, solution, row, col) {
      if (grid?.[row]?.[col] !== 1) return "blocked";
      if (findBuildingAtCell(solution, row, col)?.kind === "service") return "service";
      if (findBuildingAtCell(solution, row, col)?.kind === "residential") return "residential";
      if ((solution?.roads ?? []).includes?.(`${row},${col}`)) return "road";
      return "empty";
    }

    function getCellBonusCoverage(solution, row, col) {
      const grid = state.resultContext?.grid ?? state.grid;
      if (!grid?.length || grid[row]?.[col] !== 1 || !solution) return [];

      return (solution.services ?? []).flatMap((service, index) => {
        if (isCellInsidePlacement(service, row, col) || !isCellInsideServiceEffect(service, row, col)) return [];

        return [{
          id: `S${index + 1}`,
          name: lookupServiceName(solution.serviceTypeIndices?.[index] ?? -1),
          bonus: Number(solution.servicePopulationIncreases?.[index] ?? 0),
        }];
      });
    }

    function createServiceValueHeatmap(grid, solution) {
      const values = grid.map((row) => row.map(() => 0));
      let maxValue = 0;
      if (!solution) return { values, maxValue };

      for (let row = 0; row < grid.length; row += 1) {
        for (let col = 0; col < (grid[row]?.length ?? 0); col += 1) {
          if (grid[row][col] !== 1 || isCellInsideAnyServiceFootprint(solution, row, col)) continue;
          const value = (solution.services ?? []).reduce((sum, service, index) => {
            if (!isCellInsideServiceEffect(service, row, col)) return sum;
            const bonus = Number(solution.servicePopulationIncreases?.[index] ?? 0);
            return Number.isFinite(bonus) && bonus > 0 ? sum + bonus : sum;
          }, 0);
          values[row][col] = value;
          maxValue = Math.max(maxValue, value);
        }
      }

      return { values, maxValue };
    }

    function formatServiceValue(value) {
      return Number(value).toLocaleString();
    }

    function applyServiceValueHeatmapStyle(cell, value, maxValue) {
      if (!(value > 0) || !(maxValue > 0)) return;
      const intensity = Math.max(0.18, Math.min(1, value / maxValue));
      const warmAlpha = (0.26 + intensity * 0.5).toFixed(2);
      const hotAlpha = (0.18 + intensity * 0.52).toFixed(2);
      const borderAlpha = (0.26 + intensity * 0.4).toFixed(2);
      cell.className += " heatmap-cell";
      cell.dataset.serviceValue = String(value);
      cell.style.setProperty("--heatmap-warm-alpha", warmAlpha);
      cell.style.setProperty("--heatmap-hot-alpha", hotAlpha);
      cell.style.setProperty("--heatmap-border-alpha", borderAlpha);
    }

    function countPlacementsByType(typeIndices, typeCount) {
      const counts = Array.from({ length: Math.max(0, typeCount) }, () => 0);
      if (!Array.isArray(typeIndices)) return counts;
      typeIndices.forEach((typeIndex) => {
        if (Number.isInteger(typeIndex) && typeIndex >= 0 && typeIndex < counts.length) {
          counts[typeIndex] += 1;
        }
      });
      return counts;
    }

    function getTypeAvailabilitySummary(kind, typeIndex, solution) {
      const isService = kind === "service";
      const types = isService ? (state.resultContext?.params?.serviceTypes ?? []) : (state.resultContext?.params?.residentialTypes ?? []);
      const usedCounts = countPlacementsByType(
        isService ? solution?.serviceTypeIndices : solution?.residentialTypeIndices,
        types.length
      );
      const totalAvailable = getTypeTotalAvailable(types[typeIndex], isService);
      const used = usedCounts[typeIndex] ?? 0;
      return {
        totalAvailable,
        used,
        remaining: Math.max(0, totalAvailable - used),
      };
    }

    function renderSelectedBuildingDetail(solution = state.result?.solution) {
      if (!elements.selectedBuildingTitle || !elements.selectedBuildingFacts || !elements.selectedBuildingSummary) return;

      const selected = getSelectedMapPlacement(solution);
      const selectedCell = getSelectedMapCell();
      const pendingManualValidation = hasPendingManualValidation();
      if (!selected && !selectedCell) {
        elements.selectedBuildingTitle.textContent = "Building detail";
        elements.selectedBuildingSummary.textContent = solution
          ? "Click a service, residential, road, or empty cell on the solved map to inspect it here."
          : "Run or load a layout to inspect building details.";
        elements.selectedBuildingFacts.hidden = true;
        return;
      }

      if (!selected && selectedCell) {
        const kind = getSolvedCellKind(state.resultContext?.grid ?? state.grid, solution, selectedCell.r, selectedCell.c);
        const coverage = getCellBonusCoverage(solution, selectedCell.r, selectedCell.c);
        const totalBonus = coverage.reduce((sum, entry) => sum + entry.bonus, 0);
        const sourceText = coverage.length
          ? coverage.map((entry) => `${entry.name} (${entry.id})`).join(", ")
          : "no nearby service zones";
        const categoryLabel =
          kind === "road" ? "Road" :
          kind === "empty" ? "Empty cell" :
          kind === "blocked" ? "Blocked cell" :
          kind === "service" ? "Service cell" :
          "Residential cell";

        elements.selectedBuildingTitle.textContent = `${categoryLabel} (${selectedCell.r}, ${selectedCell.c})`;
        elements.selectedBuildingSummary.textContent =
          kind === "blocked"
            ? "Blocked cells do not receive service bonus coverage."
            : `Potential service bonus at this position is +${totalBonus} population from ${sourceText}.`;
        elements.selectedBuildingId.textContent = `${selectedCell.r},${selectedCell.c}`;
        elements.selectedBuildingCategory.textContent = categoryLabel;
        elements.selectedBuildingPosition.textContent = `Row ${selectedCell.r}, Col ${selectedCell.c}`;
        elements.selectedBuildingFootprint.textContent = "1x1 cell";
        elements.selectedBuildingEffect.textContent =
          kind === "blocked"
            ? "No service bonus applies here because the cell is blocked."
            : coverage.length
              ? `+${totalBonus} from ${coverage.map((entry) => `${entry.name} (${entry.id})`).join(", ")}`
              : "No nearby service bonus reaches this cell.";
        elements.selectedBuildingAvailability.textContent =
          kind === "empty"
            ? "Open cell"
            : kind === "road"
              ? "Occupied by road"
              : kind === "blocked"
                ? "Not buildable"
                : "Occupied by a building";
        elements.selectedBuildingFacts.hidden = false;
        return;
      }

      const isService = selected.kind === "service";
      const placement = selected.placement;
      const typeIndex = isService
        ? (solution.serviceTypeIndices?.[selected.index] ?? -1)
        : (solution.residentialTypeIndices?.[selected.index] ?? -1);
      const type = isService
        ? state.resultContext?.params?.serviceTypes?.[typeIndex]
        : state.resultContext?.params?.residentialTypes?.[typeIndex];
      const name = isService ? lookupServiceName(typeIndex) : lookupResidentialName(typeIndex);
      const buildingId = `${isService ? "S" : "R"}${selected.index + 1}`;
      const availability = getTypeAvailabilitySummary(selected.kind, typeIndex, solution);

      elements.selectedBuildingTitle.textContent = name;
      elements.selectedBuildingSummary.textContent = isService
        ? `${buildingId} is a service placement covering ${placement.rows}x${placement.cols} with range ${placement.range}.`
        : pendingManualValidation
          ? `${buildingId} is a residential placement with population pending validation.`
          : `${buildingId} is a residential placement contributing ${solution.populations?.[selected.index] ?? 0} population.`;
      elements.selectedBuildingId.textContent = buildingId;
      elements.selectedBuildingCategory.textContent = isService ? "Service" : "Residential";
      elements.selectedBuildingPosition.textContent = `Row ${placement.r}, Col ${placement.c}`;
      elements.selectedBuildingFootprint.textContent = `${placement.rows}x${placement.cols}`;
      elements.selectedBuildingEffect.textContent = isService
        ? pendingManualValidation
          ? `Service effect pending validation, range ${placement.range}, type bonus ${type?.bonus ?? 0}`
          : `+${solution.servicePopulationIncreases?.[selected.index] ?? 0} population, range ${placement.range}, type bonus ${type?.bonus ?? 0}`
        : pendingManualValidation
          ? `Population pending validation, type range ${type?.min ?? 0}-${type?.max ?? 0}`
          : `${solution.populations?.[selected.index] ?? 0} population, type range ${type?.min ?? 0}-${type?.max ?? 0}`;
      elements.selectedBuildingAvailability.textContent =
        `${availability.remaining} left of ${availability.totalAvailable} for this type`;
      elements.selectedBuildingFacts.hidden = false;
    }

    function renderRemainingAvailability(listElement, types, usedCounts, labelPrefix) {
      if (!listElement) return;
      listElement.innerHTML = "";

      const remainingEntries = Array.isArray(types)
        ? types.flatMap((type, index) => {
          const isService = labelPrefix === "Service";
          const totalAvailable = getTypeTotalAvailable(type, isService);
          const used = usedCounts[index] ?? 0;
          const remaining = Math.max(0, totalAvailable - used);
          if (!remaining) return [];
          return [{
            name: type?.name || `${labelPrefix} Type ${index + 1}`,
            kind: isService ? "service" : "residential",
            typeIndex: index,
            remaining,
            totalAvailable,
            detail: isService
              ? `${Number(type?.bonus ?? 0)}`
              : `${Number(type?.min ?? 0)}/${Number(type?.max ?? 0)}, ${Number(type?.w ?? 0)}x${Number(type?.h ?? 0)}`,
          }];
        })
        : [];

      if (remainingEntries.length === 0) {
        listElement.innerHTML = `<li>No ${labelPrefix.toLowerCase()} buildings remain available.</li>`;
        return;
      }

      remainingEntries.forEach((entry) => {
        const item = document.createElement("li");
        const summary = document.createElement("span");
        summary.textContent = `${entry.name} — ${entry.detail}, ${entry.remaining}/${entry.totalAvailable}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button ghost compact";
        button.textContent = "Place";
        button.disabled = state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext;
        button.dataset.action = entry.kind === "service" ? "place-remaining-service" : "place-remaining-residential";
        button.dataset.typeIndex = String(entry.typeIndex);
        button.dataset.name = entry.name;
        item.append(summary, button);
        listElement.append(item);
      });
    }

    function formatDiagnosticCount(value) {
      return Number(value ?? 0).toLocaleString();
    }

    function formatDiagnosticExample(example) {
      const idPrefix = example.kind === "service" ? "S" : "R";
      const typeName = example.typeName
        || (example.kind === "service" ? lookupServiceName(example.typeIndex) : lookupResidentialName(example.typeIndex));
      const parts = [
        `${typeName || `${idPrefix} type ${Number(example.typeIndex ?? -1) + 1}`} at (${example.r}, ${example.c})`,
        `${example.rows}x${example.cols}`,
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

    function renderDiagnosticKindReport(listElement, report, emptyLabel) {
      if (!listElement) return;
      listElement.innerHTML = "";

      const reasonEntries = DIAGNOSTIC_REASON_ORDER
        .map((reason) => ({
          reason,
          count: Number(report?.reasonCounts?.[reason] ?? 0),
          examples: Array.isArray(report?.examplesByReason?.[reason]) ? report.examplesByReason[reason] : [],
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
        stamp.textContent = `${DIAGNOSTIC_REASON_LABELS[entry.reason]}: ${formatDiagnosticCount(entry.count)}`;

        const detail = document.createElement("span");
        detail.className = "progress-log-detail";
        const examples = entry.examples.map(formatDiagnosticExample);
        detail.textContent = examples.length > 0
          ? `Examples: ${examples.join(" | ")}`
          : "No bounded examples were captured for this reason.";

        item.append(stamp, detail);
        listElement.append(item);
      });
    }

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
          `Scanned ${formatDiagnosticCount(serviceScanned)} unplaced service candidates and `
          + `${formatDiagnosticCount(residentialScanned)} unplaced residential candidates`
          + `${truncated ? `, capped at ${formatDiagnosticCount(diagnostics.candidateLimit)} per category` : ""}.`;
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

    function formatAutoSeedStatus(solution) {
      const generatedSeeds = Array.isArray(solution?.autoStage?.generatedSeeds)
        ? solution.autoStage.generatedSeeds
        : [];
      if (generatedSeeds.length === 0) return "";
      const latestSeed = generatedSeeds[generatedSeeds.length - 1];
      const latestStage = latestSeed?.stage ? getOptimizerLabel(latestSeed.stage) : "stage";
      return Number.isInteger(latestSeed?.randomSeed)
        ? `, generated ${generatedSeeds.length} stage seeds (latest ${latestStage} ${latestSeed.randomSeed})`
        : `, generated ${generatedSeeds.length} stage seeds`;
    }

    function formatCpSatSeedStatus(solution, stats) {
      if (stats?.optimizer === "auto" || solution?.optimizer === "auto") {
        return formatAutoSeedStatus(solution);
      }
      const configuredSeed = state.resultContext?.params?.cpSat?.randomSeed;
      const portfolioWorkers = solution?.cpSatPortfolio?.workers ?? [];
      if (portfolioWorkers.length > 0) {
        const selectedWorker = portfolioWorkers.find(
          (worker) => worker.workerIndex === solution.cpSatPortfolio?.selectedWorkerIndex
        );
        const feasibleWorkers = portfolioWorkers.filter((worker) => worker.feasible);
        const populations = feasibleWorkers
          .map((worker) => (Number.isFinite(worker.totalPopulation) ? Number(worker.totalPopulation) : null))
          .filter((population) => population !== null);
        const populationSpread = populations.length > 1
          ? Math.max(...populations) - Math.min(...populations)
          : null;
        const selectedLabel =
          `selected worker ${Number(selectedWorker?.workerIndex ?? 0) + 1}/${solution.cpSatPortfolio?.workerCount ?? portfolioWorkers.length}`;
        const seedLabel = Number.isInteger(selectedWorker?.randomSeed) ? ` seed ${selectedWorker.randomSeed}` : "";
        const feasibleLabel = `, ${feasibleWorkers.length}/${portfolioWorkers.length} feasible`;
        const spreadLabel = populationSpread !== null ? `, spread ${populationSpread.toLocaleString()}` : "";
        if (selectedWorker) {
          return `, ${selectedLabel}${seedLabel}${feasibleLabel}${spreadLabel}`;
        }
        if (feasibleWorkers.length > 0) {
          return `, ${feasibleWorkers.length}/${portfolioWorkers.length} feasible workers${spreadLabel}`;
        }
        const workerSeeds = portfolioWorkers
          .map((worker) => (Number.isInteger(worker.randomSeed) ? worker.randomSeed : null))
          .filter((seed) => seed !== null);
        if (workerSeeds.length > 0) {
          return `, portfolio seeds ${workerSeeds.join(", ")}`;
        }
      }
      return Number.isInteger(configuredSeed) ? `, seed ${configuredSeed}` : "";
    }

    function formatProgressLogNumber(value, options = {}) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const { maximumFractionDigits = 0 } = options;
      return Number(value).toLocaleString(undefined, { maximumFractionDigits });
    }

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
        maximumFractionDigits: 1,
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

    function getResultProgressLogEntries() {
      return Array.isArray(state.result?.progressLog)
        ? state.result.progressLog
        : Array.isArray(state.solveProgressLog)
          ? state.solveProgressLog
          : [];
    }

    function renderProgressLog(options = {}) {
      if (!elements.resultProgressSummary || !elements.resultProgressLog) return;

      const {
        liveSnapshot = false,
        manualLayout = false,
      } = options;
      const entries = getResultProgressLogEntries();

      elements.resultProgressLog.innerHTML = "";

      if (manualLayout) {
        elements.resultProgressSummary.textContent = "Manual layout edits clear the recorded solver performance history.";
        elements.resultProgressLog.innerHTML = "<li>No solver samples are attached to this manual layout.</li>";
        return;
      }

      if (entries.length === 0) {
        elements.resultProgressSummary.textContent = liveSnapshot
          ? "Waiting for the first feasible snapshot before the performance log can start."
          : "No performance samples were recorded for this layout.";
        elements.resultProgressLog.innerHTML = "<li>No live or final progress samples are available.</li>";
        return;
      }

      elements.resultProgressSummary.textContent = liveSnapshot
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
        const improvementLabel = entry.progressSummary ? null : formatProgressLogNumber(entry.secondsSinceLastImprovement, {
          maximumFractionDigits: 1,
        });
        if (improvementLabel !== null) {
          parts.push(`last improvement ${improvementLabel}s ago`);
        }
        if (entry.note && !parts.includes(entry.note)) {
          parts.push(entry.note);
        }

        detail.textContent = parts.join(" • ");
        item.append(stamp, detail);
        elements.resultProgressLog.append(item);
      });
    }

    function createSolvedMapMatrix(grid, solution) {
      const matrix = grid.map((row) => row.map((cell) => (cell === 1 ? "empty" : "blocked")));

      for (const roadKey of solution.roads) {
        const [row, col] = roadKey.split(",").map(Number);
        if (matrix[row]?.[col]) matrix[row][col] = "road";
      }

      for (const service of solution.services) {
        for (let dr = 0; dr < service.rows; dr += 1) {
          for (let dc = 0; dc < service.cols; dc += 1) {
            const row = service.r + dr;
            const col = service.c + dc;
            if (matrix[row]?.[col]) matrix[row][col] = "service";
          }
        }
      }

      for (const residential of solution.residentials) {
        for (let dr = 0; dr < residential.rows; dr += 1) {
          for (let dc = 0; dc < residential.cols; dc += 1) {
            const row = residential.r + dr;
            const col = residential.c + dc;
            if (matrix[row]?.[col]) matrix[row][col] = "residential";
          }
        }
      }

      return matrix;
    }

    function describeSolvedCell(kind, row, col, hoverLabel) {
      if (hoverLabel) {
        return `Solved cell ${row},${col} belongs to ${hoverLabel}`;
      }
      const label =
        kind === "road" ? "road" :
        kind === "service" ? "service building" :
        kind === "residential" ? "residential building" :
        kind === "blocked" ? "blocked" :
        "empty allowed";
      return `Solved cell ${row},${col} is ${label}`;
    }

    function createSolvedMapHoverLabels(solution, rows, cols) {
      const labels = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
      const pendingManualValidation = hasPendingManualValidation();

      solution.services.forEach((service, index) => {
        const name = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
        const hoverLabel = `${name} (S${index + 1})`;
        for (let dr = 0; dr < service.rows; dr += 1) {
          for (let dc = 0; dc < service.cols; dc += 1) {
            const row = service.r + dr;
            const col = service.c + dc;
            if (labels[row]?.[col] !== undefined) labels[row][col] = hoverLabel;
          }
        }
      });

      solution.residentials.forEach((residential, index) => {
        const name = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
        const population = solution.populations[index];
        const hoverLabel =
          !pendingManualValidation && population != null
            ? `${name} (R${index + 1}, pop ${population})`
            : `${name} (R${index + 1})`;
        for (let dr = 0; dr < residential.rows; dr += 1) {
          for (let dc = 0; dc < residential.cols; dc += 1) {
            const row = residential.r + dr;
            const col = residential.c + dc;
            if (labels[row]?.[col] !== undefined) labels[row][col] = hoverLabel;
          }
        }
      });

      return labels;
    }

    function readMatrixLayout(element) {
      const styles = globalObject.getComputedStyle(element);
      return {
        cellSize: Number.parseFloat(styles.getPropertyValue("--matrix-cell-size")) || 28,
        gap: Number.parseFloat(styles.getPropertyValue("--matrix-gap")) || 6,
        paddingX: Number.parseFloat(styles.paddingLeft) || 18,
        paddingY: Number.parseFloat(styles.paddingTop) || 18,
      };
    }

    function createBuildingOverlay(kind, index, placement, layout, label, isSelected = false) {
      const outline = document.createElement("div");
      const pitch = layout.cellSize + layout.gap;
      const width = placement.cols * layout.cellSize + Math.max(0, placement.cols - 1) * layout.gap;
      const height = placement.rows * layout.cellSize + Math.max(0, placement.rows - 1) * layout.gap;
      const left = layout.paddingX + placement.c * pitch;
      const top = layout.paddingY + placement.r * pitch;
      const fontSize = Math.max(10, Math.min(13, layout.cellSize * 0.6));
      const tagHeight = Math.max(18, Math.min(22, layout.cellSize * 0.8));
      const minWidth = Math.max(24, Math.min(34, layout.cellSize * 1.4));
      const shortLabel = `${kind === "service" ? "S" : "R"}${index + 1}`;

      outline.className = `building-outline ${kind}`;
      if (isSelected) outline.classList.add("selected");
      outline.style.left = `${left}px`;
      outline.style.top = `${top}px`;
      outline.style.width = `${width}px`;
      outline.style.height = `${height}px`;
      outline.title = `${label} (${shortLabel})`;
      outline.setAttribute("aria-label", `${label} (${shortLabel}) at row ${placement.r}, column ${placement.c}`);

      const tag = document.createElement("span");
      tag.className = "building-tag";
      tag.textContent = shortLabel;
      tag.title = `${label} (${shortLabel})`;
      tag.style.fontSize = `${fontSize}px`;
      tag.style.height = `${tagHeight}px`;
      tag.style.minWidth = `${minWidth}px`;
      outline.append(tag);

      return outline;
    }

    function renderBuildingOverlay(solution) {
      elements.resultOverlay.innerHTML = "";
      if (!solution) return;

      const layout = readMatrixLayout(elements.resultMapGrid);
      solution.services.forEach((service, index) => {
        const label = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
        elements.resultOverlay.append(
          createBuildingOverlay(
            "service",
            index,
            service,
            layout,
            label,
            state.selectedMapBuilding?.kind === "service" && state.selectedMapBuilding?.index === index
          )
        );
      });
      solution.residentials.forEach((residential, index) => {
        const label = lookupResidentialName(solution.residentialTypeIndices[index] ?? -1);
        elements.resultOverlay.append(
          createBuildingOverlay(
            "residential",
            index,
            residential,
            layout,
            label,
            state.selectedMapBuilding?.kind === "residential" && state.selectedMapBuilding?.index === index
          )
        );
      });
    }

    function clearResultOverlay() {
      elements.resultOverlay.innerHTML = "";
    }

    function isServiceValueHeatmapVisible() {
      return Boolean(state.resultHeatmapEnabled);
    }

    function refreshResultOverlay() {
      if (!state.result?.solution || !elements.resultMapGrid.dataset.cols) {
        clearResultOverlay();
        return;
      }
      if (isServiceValueHeatmapVisible()) {
        clearResultOverlay();
        return;
      }
      renderBuildingOverlay(state.result.solution);
    }

    function renderSolvedMap(grid, solution) {
      if (!grid?.length) {
        elements.resultMapGrid.innerHTML = "";
        delete elements.resultMapGrid.dataset.cols;
        clearResultOverlay();
        renderSelectedBuildingDetail(null);
        return;
      }

      const matrix = createSolvedMapMatrix(grid, solution);
      const cols = matrix[0]?.length ?? 0;
      const hoverLabels = createSolvedMapHoverLabels(solution, matrix.length, cols);
      const showServiceValueHeatmap = isServiceValueHeatmapVisible();
      const heatmap = showServiceValueHeatmap ? createServiceValueHeatmap(grid, solution) : null;
      state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
      state.selectedMapCell = getSelectedMapCell(grid);
      elements.resultMapGrid.innerHTML = "";
      elements.resultMapGrid.dataset.cols = String(cols);

      for (let r = 0; r < matrix.length; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const kind = matrix[r][c];
          const visualKind = showServiceValueHeatmap && kind !== "blocked" ? "empty" : kind;
          const hoverLabel = showServiceValueHeatmap ? "" : (hoverLabels[r]?.[c] || "");
          const serviceValue = heatmap?.values?.[r]?.[c] ?? 0;
          const serviceValueLabel = serviceValue > 0 ? `, service value +${formatServiceValue(serviceValue)}` : "";
          const cell = document.createElement("div");
          cell.className = `grid-cell ${visualKind}`;
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute("aria-label", `${describeSolvedCell(visualKind, r, c, hoverLabel)}${serviceValueLabel}`);
          cell.title = `${hoverLabel || `(${r}, ${c}) ${visualKind}`}${serviceValueLabel}`;
          applyServiceValueHeatmapStyle(cell, serviceValue, heatmap?.maxValue ?? 0);
          if (!showServiceValueHeatmap && (kind === "service" || kind === "residential")) {
            cell.classList.add("selectable");
          }
          if (state.selectedMapCell?.r === r && state.selectedMapCell?.c === c) {
            cell.classList.add("selected");
          }
          elements.resultMapGrid.append(cell);
        }
      }

      applyMatrixLayout(elements.resultMapGrid);
      if (showServiceValueHeatmap) {
        clearResultOverlay();
      } else {
        renderBuildingOverlay(solution);
      }
      renderSelectedBuildingDetail(solution);
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

      const { solution, stats, validation } = state.result;
      state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
      const {
        manualLayout,
        pendingValidation: pendingManualValidation,
      } = getManualLayoutState();
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
        elements.resultBadge.textContent = pendingManualValidation ? "Edited" : validation.valid ? "Manual" : "Manual review";
        elements.resultBadge.className = `result-badge ${pendingManualValidation ? "idle" : validation.valid ? "success" : "error"}`;
        elements.validationNotice.className = `notice ${pendingManualValidation || validation.valid ? "info" : "error"}`;
        elements.validationNotice.textContent = pendingManualValidation
          ? "Manual edits are pending validation. The map and counts reflect your edits, but legality and population will update only after you validate the layout."
          : validation.valid
            ? "This layout was manually edited and revalidated for the current grid and settings."
            : validation.errors.join(" ");
      } else {
        elements.resultBadge.textContent = validation.valid ? (stoppedByUser ? "Stopped" : "Validated") : "Needs review";
        elements.resultBadge.className = `result-badge ${validation.valid ? "success" : "error"}`;
        elements.validationNotice.className = `notice ${validation.valid ? "success" : "error"}`;
        elements.validationNotice.textContent = validation.valid
          ? (
            stoppedByUser
              ? `${getOptimizerLabel(stats.optimizer)} was stopped early. Showing the best validated result found so far.`
              : "The solver output passed validation for the current grid and settings."
          )
          : validation.errors.join(" ");
      }

      elements.resultPopulation.textContent = pendingManualValidation ? "Pending" : Number(stats.totalPopulation).toLocaleString();
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
        ? (pendingManualValidation ? "manual edit (pending validation)" : "manual edit")
        : liveSnapshot
          ? `${autoStageStatus || stats.cpSatStatus || getOptimizerLabel(stats.optimizer)} (live)${cpSatSeedStatus}`
          : (
            stoppedByUser && stats.cpSatStatus
              ? `${stats.cpSatStatus} (stopped)${cpSatSeedStatus}`
              : `${stats.cpSatStatus || autoStageStatus || (stats.optimizer ?? "n/a")}${cpSatSeedStatus}`
          );

      elements.serviceResultList.innerHTML = "";
      if (solution.services.length === 0) {
        elements.serviceResultList.innerHTML = "<li>No service buildings were placed.</li>";
      } else {
        solution.services.forEach((service, index) => {
          const item = document.createElement("li");
          const typeLabel = lookupServiceName(solution.serviceTypeIndices[index] ?? -1);
          item.textContent =
            `${typeLabel} (S${index + 1}) at (${service.r}, ${service.c}) `
            + `${service.rows}x${service.cols}, range ${service.range}, `
            + (
              pendingManualValidation
                ? "effect pending validation"
                : `+${solution.servicePopulationIncreases[index] ?? 0}`
            );
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
            `${typeLabel} (R${index + 1}) at (${residential.r}, ${residential.c}) `
            + `${residential.rows}x${residential.cols}, `
            + (
              pendingManualValidation
                ? "population pending validation"
                : `pop ${solution.populations[index] ?? 0}`
            );
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

    function handleLayoutEditToggleClick(event) {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-layout-edit-mode]");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.layoutEditMode) return;
      setLayoutEditMode(button.dataset.layoutEditMode);
    }

    function handleRemainingPlacementClick(event) {
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
        rotated: !pendingPlacement.rotated,
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
          message: `Removed ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
        });
      } catch (error) {
        setLayoutEditorStatus(error instanceof Error ? error.message : "Failed to remove the selected building.");
      }
    }

    async function handleValidateEditedLayoutAction() {
      if (isLayoutEditBusy() || !hasEditableLayoutContext()) return;
      if (!state.layoutEditor.pendingValidation) {
        setLayoutEditorStatus(state.layoutEditor.edited
          ? "This manual layout is already validated."
          : "Make a manual edit first, then validate the layout.");
        return;
      }

      try {
        await evaluateEditedLayout(cloneEditableSolution(), {
          message: "Manual layout validated.",
          selectedBuilding: state.selectedMapBuilding,
          selectedCell: state.selectedMapCell,
          keepMode: true,
        });
      } catch (error) {
        setLayoutEditorStatus(error instanceof Error ? error.message : "Failed to validate the edited layout.");
      }
    }

    function handleResultMapClick(event) {
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
      setLayoutEditMode,
    });
  }

  globalObject.CityBuilderResults = Object.freeze({
    createPlannerResultsController,
  });
})(window);
