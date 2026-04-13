(function attachPlannerResults(globalObject) {
  function createPlannerResultsController(options) {
    const {
      state,
      elements,
      helpers,
      callbacks,
    } = options;
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

    function setLayoutEditMode(mode, pendingPlacement = null) {
      state.layoutEditor.mode = mode;
      state.layoutEditor.pendingPlacement = pendingPlacement;
      state.layoutEditor.status = "";
      if (mode === "inspect") {
        state.selectedMapCell = null;
      }
      renderLayoutEditorControls();
    }

    function renderLayoutEditorControls() {
      if (!elements.layoutEditModeToggle || !elements.layoutEditorStatus) return;
      const pendingPlacement = state.layoutEditor.pendingPlacement;
      const selectedLabel = getSelectedPlacementLabel();

      for (const button of elements.layoutEditModeToggle.querySelectorAll("button")) {
        button.classList.toggle("active", button.dataset.layoutEditMode === state.layoutEditor.mode);
      }

      let message = state.layoutEditor.status;
      if (!message) {
        if (!state.result || !state.resultContext) {
          message = "Run or load a layout to edit it.";
        } else if (state.layoutEditor.isApplying) {
          message = "Re-evaluating the edited layout...";
        } else if (state.layoutEditor.mode === "place-service" && pendingPlacement) {
          message = `Placing ${pendingPlacement.name}. Click the map to set its top-left cell.`;
        } else if (state.layoutEditor.mode === "place-residential" && pendingPlacement) {
          message = `Placing ${pendingPlacement.name}. Click the map to set its top-left cell.`;
        } else if (state.layoutEditor.mode === "road") {
          message = "Road mode: click an empty allowed cell to add road, or an existing road cell to remove it.";
        } else if (state.layoutEditor.mode === "erase") {
          message = "Erase mode: click a road, service, or residential building to remove it.";
        } else if (state.layoutEditor.mode === "move") {
          message = selectedLabel
            ? `Move mode: click a new top-left cell for ${selectedLabel}.`
            : "Move mode: select a building first, then click its new top-left cell.";
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

    function buildServicePlacementForType(typeIndex, row, col) {
      const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
      if (!type) throw new Error("That service type is no longer available in the current settings.");
      return {
        placement: {
          r: row,
          c: col,
          rows: Number(type.rows),
          cols: Number(type.cols),
          range: Number(type.range),
        },
        bonus: Number(type.bonus ?? 0),
        name: type.name || `Service Type ${typeIndex + 1}`,
      };
    }

    function buildResidentialPlacementForType(typeIndex, row, col) {
      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      if (!type) throw new Error("That residential type is no longer available in the current settings.");
      return {
        placement: {
          r: row,
          c: col,
          rows: Number(type.h),
          cols: Number(type.w),
        },
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
      state.layoutEditor.status = "Re-evaluating the edited layout...";
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

        clearExpansionAdvice();
        state.result = payload;
        state.resultIsLiveSnapshot = false;
        state.resultError = "";
        state.selectedMapBuilding = selectedBuilding;
        state.selectedMapCell = selectedCell;
        state.layoutEditor.edited = true;
        state.layoutEditor.status = message;
        if (!keepMode) {
          state.layoutEditor.mode = "inspect";
          state.layoutEditor.pendingPlacement = null;
        }
        setSolveState(message);
        renderResults();
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

    async function toggleManualRoad(row, col) {
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
      await evaluateEditedLayout(nextSolution, {
        message: roads.has(key) ? `Added road at (${row}, ${col}).` : `Removed road at (${row}, ${col}).`,
        selectedCell: { r: row, c: col },
        keepMode: true,
      });
    }

    async function eraseAtCell(row, col) {
      const selected = findBuildingAtCell(state.result?.solution, row, col);
      if (selected) {
        const nextSolution = cloneEditableSolution();
        removePlacementFromSolution(nextSolution, selected);
        await evaluateEditedLayout(nextSolution, {
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
      await evaluateEditedLayout(nextSolution, {
        message: `Removed road at (${row}, ${col}).`,
        selectedCell: { r: row, c: col },
        keepMode: true,
      });
    }

    async function placePendingBuilding(row, col) {
      const pending = state.layoutEditor.pendingPlacement;
      if (!pending) {
        throw new Error("Choose a remaining building to place first.");
      }

      const grid = state.resultContext?.grid ?? state.grid;
      const nextSolution = cloneEditableSolution();

      if (pending.kind === "service") {
        const candidate = buildServicePlacementForType(pending.typeIndex, row, col);
        ensurePlacementFitsGrid(grid, candidate.placement);
        ensurePlacementIsClear(nextSolution, candidate.placement);
        nextSolution.services.push(candidate.placement);
        nextSolution.serviceTypeIndices.push(pending.typeIndex);
        nextSolution.servicePopulationIncreases.push(candidate.bonus);
        await evaluateEditedLayout(nextSolution, {
          message: `Placed ${pending.name} at (${row}, ${col}).`,
          selectedBuilding: { kind: "service", index: nextSolution.services.length - 1 },
        });
        return;
      }

      const candidate = buildResidentialPlacementForType(pending.typeIndex, row, col);
      ensurePlacementFitsGrid(grid, candidate.placement);
      ensurePlacementIsClear(nextSolution, candidate.placement);
      nextSolution.residentials.push(candidate.placement);
      nextSolution.residentialTypeIndices.push(pending.typeIndex);
      nextSolution.populations.push(candidate.population);
      await evaluateEditedLayout(nextSolution, {
        message: `Placed ${pending.name} at (${row}, ${col}).`,
        selectedBuilding: { kind: "residential", index: nextSolution.residentials.length - 1 },
      });
    }

    async function moveSelectedBuilding(row, col) {
      const currentSolution = state.result?.solution;
      const currentSelection = getSelectedMapPlacement(currentSolution);
      const clickedSelection = findBuildingAtCell(currentSolution, row, col);

      if (!currentSelection) {
        if (!clickedSelection) {
          throw new Error("Select a building first, then click its new top-left cell.");
        }
        state.selectedMapBuilding = clickedSelection;
        state.selectedMapCell = null;
        state.layoutEditor.status = `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`;
        renderResults();
        return;
      }

      if (
        clickedSelection
        && (clickedSelection.kind !== currentSelection.kind || clickedSelection.index !== currentSelection.index)
      ) {
        state.selectedMapBuilding = clickedSelection;
        state.selectedMapCell = null;
        state.layoutEditor.status = `Selected ${clickedSelection.kind === "service" ? "S" : "R"}${clickedSelection.index + 1}. Click its new top-left cell next.`;
        renderResults();
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

      await evaluateEditedLayout(nextSolution, {
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
        const inFootprint =
          row >= service.r
          && row < service.r + service.rows
          && col >= service.c
          && col < service.c + service.cols;
        if (inFootprint) return [];

        const inEffect =
          row >= service.r - service.range
          && row <= service.r + service.rows - 1 + service.range
          && col >= service.c - service.range
          && col <= service.c + service.cols - 1 + service.range;
        if (!inEffect) return [];

        return [{
          id: `S${index + 1}`,
          name: lookupServiceName(solution.serviceTypeIndices?.[index] ?? -1),
          bonus: Number(solution.servicePopulationIncreases?.[index] ?? 0),
        }];
      });
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
        : `${buildingId} is a residential placement contributing ${solution.populations?.[selected.index] ?? 0} population.`;
      elements.selectedBuildingId.textContent = buildingId;
      elements.selectedBuildingCategory.textContent = isService ? "Service" : "Residential";
      elements.selectedBuildingPosition.textContent = `Row ${placement.r}, Col ${placement.c}`;
      elements.selectedBuildingFootprint.textContent = `${placement.rows}x${placement.cols}`;
      elements.selectedBuildingEffect.textContent = isService
        ? `+${solution.servicePopulationIncreases?.[selected.index] ?? 0} population, range ${placement.range}, type bonus ${type?.bonus ?? 0}`
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
          population != null
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

    function refreshResultOverlay() {
      if (!state.result?.solution || !elements.resultMapGrid.dataset.cols) {
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
      state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
      state.selectedMapCell = getSelectedMapCell(grid);
      elements.resultMapGrid.innerHTML = "";
      elements.resultMapGrid.dataset.cols = String(cols);

      for (let r = 0; r < matrix.length; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const kind = matrix[r][c];
          const hoverLabel = hoverLabels[r]?.[c] || "";
          const cell = document.createElement("div");
          cell.className = `grid-cell ${kind}`;
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute("aria-label", describeSolvedCell(kind, r, c, hoverLabel));
          cell.title = hoverLabel || `(${r}, ${c}) ${kind}`;
          if (kind === "service" || kind === "residential") {
            cell.classList.add("selectable");
          }
          if (state.selectedMapCell?.r === r && state.selectedMapCell?.c === c) {
            cell.classList.add("selected");
          }
          elements.resultMapGrid.append(cell);
        }
      }

      applyMatrixLayout(elements.resultMapGrid);
      renderBuildingOverlay(solution);
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
        elements.serviceResultList.innerHTML = "<li>No service placements available.</li>";
        elements.residentialResultList.innerHTML = "<li>No residential placements available.</li>";
        elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
        elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
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
        elements.remainingServiceList.innerHTML = "<li>No service availability to show.</li>";
        elements.remainingResidentialList.innerHTML = "<li>No residential availability to show.</li>";
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
      const manualLayout = Boolean(state.layoutEditor.edited || solution.manualLayout || stats.manualLayout);
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
          ? "Showing the best validated layout found so far while the solver keeps running. The first live capture appears as soon as an incumbent is available, then refreshes every 1 minute."
          : `The latest running snapshot needs review: ${validation.errors.join(" ")}`;
      } else if (manualLayout) {
        elements.resultBadge.textContent = validation.valid ? "Manual" : "Manual review";
        elements.resultBadge.className = `result-badge ${validation.valid ? "success" : "error"}`;
        elements.validationNotice.className = `notice ${validation.valid ? "info" : "error"}`;
        elements.validationNotice.textContent = validation.valid
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

      elements.resultPopulation.textContent = Number(stats.totalPopulation).toLocaleString();
      elements.resultRoadCount.textContent = String(stats.roadCount);
      elements.resultServiceCount.textContent = String(stats.serviceCount);
      elements.resultResidentialCount.textContent = String(stats.residentialCount);
      elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
      elements.resultSolverStatus.textContent = manualLayout
        ? "manual edit"
        : liveSnapshot
          ? `${stats.cpSatStatus || getOptimizerLabel(stats.optimizer)} (live)`
          : (
            stoppedByUser && stats.cpSatStatus
              ? `${stats.cpSatStatus} (stopped)`
              : stats.cpSatStatus || (stats.optimizer ?? "n/a")
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
            + `${service.rows}x${service.cols}, range ${service.range}, +${solution.servicePopulationIncreases[index] ?? 0}`;
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
            + `${residential.rows}x${residential.cols}, pop ${solution.populations[index] ?? 0}`;
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

      renderSolvedMap(solvedGrid, solution);
      renderLayoutEditorControls();
      renderExpansionAdvice();
    }

    function hasSelectedBuilding() {
      return Boolean(getSelectedMapPlacement(state.result?.solution));
    }

    function handleLayoutEditToggleClick(event) {
      if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-layout-edit-mode]");
      if (!(button instanceof HTMLButtonElement) || !button.dataset.layoutEditMode) return;
      setLayoutEditMode(button.dataset.layoutEditMode);
    }

    function handleRemainingPlacementClick(event) {
      if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const typeIndex = Number(button.dataset.typeIndex);
      const name = String(button.dataset.name ?? "").trim() || "Selected building";
      if (!Number.isInteger(typeIndex) || typeIndex < 0) return;
      if (button.dataset.action === "place-remaining-service") {
        setLayoutEditMode("place-service", { kind: "service", typeIndex, name });
      } else if (button.dataset.action === "place-remaining-residential") {
        setLayoutEditMode("place-residential", { kind: "residential", typeIndex, name });
      }
    }

    function handleMoveSelectedAction() {
      if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
      if (!hasSelectedBuilding()) {
        state.layoutEditor.status = "Select a building first, then use Move selected.";
        renderLayoutEditorControls();
        return;
      }
      setLayoutEditMode("move");
    }

    async function handleRemoveSelectedAction() {
      if (state.isSolving || state.layoutEditor.isApplying || !state.result || !state.resultContext) return;
      const selected = getSelectedMapPlacement(state.result?.solution);
      if (!selected) {
        state.layoutEditor.status = "Select a building first, then use Remove selected.";
        renderLayoutEditorControls();
        return;
      }
      try {
        const nextSolution = cloneEditableSolution();
        removePlacementFromSolution(nextSolution, selected);
        await evaluateEditedLayout(nextSolution, {
          message: `Removed ${selected.kind === "service" ? "S" : "R"}${selected.index + 1}.`,
        });
      } catch (error) {
        state.layoutEditor.status = error instanceof Error ? error.message : "Failed to remove the selected building.";
        renderLayoutEditorControls();
      }
    }

    async function handleResultMapClick(event) {
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
          await toggleManualRoad(row, col);
          return;
        }
        if (state.layoutEditor.mode === "erase") {
          await eraseAtCell(row, col);
          return;
        }
        if (state.layoutEditor.mode === "move") {
          await moveSelectedBuilding(row, col);
          return;
        }
        if (state.layoutEditor.mode === "place-service" || state.layoutEditor.mode === "place-residential") {
          await placePendingBuilding(row, col);
          return;
        }

        const selected = findBuildingAtCell(state.result.solution, row, col);
        state.selectedMapBuilding = selected;
        state.selectedMapCell = selected ? null : { r: row, c: col };
        renderSolvedMap(state.resultContext?.grid ?? state.grid, state.result.solution);
        renderLayoutEditorControls();
      } catch (error) {
        state.layoutEditor.status = error instanceof Error ? error.message : "Failed to apply that manual edit.";
        renderLayoutEditorControls();
      }
    }

    return Object.freeze({
      getSelectedMapPlacement,
      handleLayoutEditToggleClick,
      handleMoveSelectedAction,
      handleRemainingPlacementClick,
      handleRemoveSelectedAction,
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
