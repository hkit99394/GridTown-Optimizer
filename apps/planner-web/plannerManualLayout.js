(function attachPlannerManualLayout(globalObject) {
  function createPlannerManualLayoutModel(options) {
    const {
      state,
      cloneJson,
      pendingManualLayoutError,
    } = options;

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
          errors: [pendingManualLayoutError],
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

    return {
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
      removePlacementFromSolution,
    };
  }

  globalObject.PlannerManualLayout = {
    createPlannerManualLayoutModel,
  };
})(typeof window !== "undefined" ? window : globalThis);
