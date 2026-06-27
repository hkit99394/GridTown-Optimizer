/**
 * @param {{ PlannerManualLayout?: unknown }} globalObject
 */
(function attachPlannerManualLayout(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   *
   * @typedef {{ rows: number, cols: number, [key: string]: any }} ManualFootprint
   *
   * @typedef {ManualFootprint & { r: number, c: number, range?: number }} ManualPlacement
   *
   * @typedef {ManualFootprint & { canRotate?: boolean, kind?: "service" | "residential", name?: string, rotated?: boolean, typeIndex?: number }} PendingManualPlacement
   *
   * @typedef {{ r: number, c: number }} ManualLayoutCell
   *
   * @typedef {{ kind: "service" | "residential", index: number }} ManualLayoutSelection
   *
   * @typedef {JsonObject & {
   *   populations: number[],
   *   residentials: ManualPlacement[],
   *   residentialTypeIndices: number[],
   *   roads?: string[],
   *   fixedRoads?: string[],
   *   servicePopulationIncreases: number[],
   *   services: ManualPlacement[],
   *   serviceTypeIndices: number[]
   * }} ManualLayoutSolution
   *
   * @typedef {{ result?: JsonObject | null, resultContext?: JsonObject | null }} ManualLayoutState
   *
   * @typedef {{ excludeKind?: "service" | "residential" | null, excludeIndex?: number }} OccupiedCellsOptions
   *
   * @typedef {{ state: ManualLayoutState, cloneJson: <T>(value: T) => T, pendingManualLayoutError: string }} ManualLayoutModelOptions
   */

  /**
   * @param {ManualLayoutModelOptions} options
   */
  function createPlannerManualLayoutModel(options) {
    const { state, cloneJson, pendingManualLayoutError } = options;
    const MAX_UNBOUNDED_FOOTPRINT_CELLS = 10000;

    /**
     * @param {ManualPlacement} placement
     * @returns {ManualPlacement}
     */
    function swapPlacementDimensions(placement) {
      return {
        ...placement,
        rows: placement.cols,
        cols: placement.rows
      };
    }

    /**
     * @param {"service" | "residential"} kind
     * @param {number} typeIndex
     * @param {string} name
     * @returns {PendingManualPlacement}
     */
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
          canRotate: (type.allowRotation ?? true) && Number(type.rows) !== Number(type.cols)
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
        canRotate: Number(type.h) !== Number(type.w)
      };
    }

    /**
     * @param {PendingManualPlacement | null | undefined} pendingPlacement
     * @returns {{ rows: number, cols: number } | null}
     */
    function readPendingPlacementFootprint(pendingPlacement) {
      if (!pendingPlacement) return null;
      return pendingPlacement.rotated
        ? { rows: pendingPlacement.cols, cols: pendingPlacement.rows }
        : { rows: pendingPlacement.rows, cols: pendingPlacement.cols };
    }

    /**
     * @returns {{ rows: number, cols: number } | null}
     */
    function getCurrentGridBounds() {
      const grid = state.resultContext?.grid;
      if (!Array.isArray(grid) || grid.length === 0) return null;
      return { rows: grid.length, cols: grid[0]?.length ?? 0 };
    }

    /**
     * @param {ManualPlacement} placement
     * @param {{ rows: number, cols: number } | null} [gridBounds]
     * @returns {{ rowStart: number, rowEnd: number, colStart: number, colEnd: number } | null}
     */
    function getPlacementCellBounds(placement, gridBounds = getCurrentGridBounds()) {
      const values = [placement?.r, placement?.c, placement?.rows, placement?.cols];
      if (!values.every((value) => Number.isSafeInteger(value))) return null;
      if (placement.rows <= 0 || placement.cols <= 0) return null;

      const rowEnd = placement.r + placement.rows;
      const colEnd = placement.c + placement.cols;
      if (!Number.isSafeInteger(rowEnd) || !Number.isSafeInteger(colEnd)) return null;
      if (!gridBounds) {
        if (placement.rows * placement.cols > MAX_UNBOUNDED_FOOTPRINT_CELLS) return null;
        return {
          rowStart: placement.r,
          rowEnd,
          colStart: placement.c,
          colEnd
        };
      }
      return {
        rowStart: Math.max(0, placement.r),
        rowEnd: Math.min(gridBounds.rows, rowEnd),
        colStart: Math.max(0, placement.c),
        colEnd: Math.min(gridBounds.cols, colEnd)
      };
    }

    /**
     * @param {ManualPlacement} placement
     * @param {(cell: ManualLayoutCell) => void} visit
     * @param {{ rows: number, cols: number } | null} [gridBounds]
     */
    function forEachPlacementCell(placement, visit, gridBounds = getCurrentGridBounds()) {
      const bounds = getPlacementCellBounds(placement, gridBounds);
      if (!bounds) return;
      for (let row = bounds.rowStart; row < bounds.rowEnd; row += 1) {
        for (let col = bounds.colStart; col < bounds.colEnd; col += 1) {
          visit({ r: row, c: col });
        }
      }
    }

    /**
     * @param {ManualPlacement} placement
     * @returns {ManualLayoutCell[]}
     */
    function footprintCellsForPlacement(placement) {
      /** @type {ManualLayoutCell[]} */
      const cells = [];
      forEachPlacementCell(placement, (cell) => cells.push(cell));
      return cells;
    }

    /**
     * @param {ManualLayoutSolution} solution
     * @param {OccupiedCellsOptions} [options]
     * @returns {Set<string>}
     */
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

    /**
     * @param {number[][] | null | undefined} grid
     * @param {ManualPlacement} placement
     */
    function ensurePlacementFitsGrid(grid, placement) {
      if (!grid?.length) throw new Error("No grid is available for manual editing.");
      if (placement.r < 0 || placement.c < 0) {
        throw new Error("Placements must stay within the grid.");
      }
      if (placement.r + placement.rows > grid.length || placement.c + placement.cols > (grid[0]?.length ?? 0)) {
        throw new Error("That building would extend beyond the grid.");
      }

      forEachPlacementCell(
        placement,
        (cell) => {
          if (grid[cell.r]?.[cell.c] !== 1) {
            throw new Error("That placement touches a blocked cell.");
          }
        },
        { rows: grid.length, cols: grid[0]?.length ?? 0 }
      );
    }

    /**
     * @param {ManualLayoutSolution} solution
     * @param {ManualPlacement} placement
     * @param {OccupiedCellsOptions} [options]
     */
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

    /**
     * @param {number} typeIndex
     * @param {number} row
     * @param {number} col
     * @param {boolean} [rotated]
     * @returns {{ placement: ManualPlacement, bonus: number, name: string }}
     */
    function buildServicePlacementForType(typeIndex, row, col, rotated = false) {
      const type = state.resultContext?.params?.serviceTypes?.[typeIndex];
      if (!type) throw new Error("That service type is no longer available in the current settings.");
      const basePlacement = {
        r: row,
        c: col,
        rows: Number(type.rows),
        cols: Number(type.cols),
        range: Number(type.range)
      };
      return {
        placement: rotated ? swapPlacementDimensions(basePlacement) : basePlacement,
        bonus: Number(type.bonus ?? 0),
        name: type.name || `Service Type ${typeIndex + 1}`
      };
    }

    /**
     * @param {number} typeIndex
     * @param {number} row
     * @param {number} col
     * @param {boolean} [rotated]
     * @returns {{ placement: ManualPlacement, population: number, name: string }}
     */
    function buildResidentialPlacementForType(typeIndex, row, col, rotated = false) {
      const type = state.resultContext?.params?.residentialTypes?.[typeIndex];
      if (!type) throw new Error("That residential type is no longer available in the current settings.");
      const basePlacement = {
        r: row,
        c: col,
        rows: Number(type.h),
        cols: Number(type.w)
      };
      return {
        placement: rotated ? swapPlacementDimensions(basePlacement) : basePlacement,
        population: Number(type.min ?? 0),
        name: type.name || `Residential Type ${typeIndex + 1}`
      };
    }

    /**
     * @returns {ManualLayoutSolution}
     */
    function cloneEditableSolution() {
      if (!state.result?.solution) {
        throw new Error("Run or load a layout before editing it.");
      }
      const solution = cloneJson(state.result.solution);
      if (!Array.isArray(solution.fixedRoads) && Array.isArray(state.resultContext?.params?.fixedRoads)) {
        const roads = new Set(solution.roads ?? []);
        solution.fixedRoads = [...new Set(state.resultContext.params.fixedRoads)].filter((roadKey) =>
          roads.has(roadKey)
        );
      }
      return solution;
    }

    /** @param {ManualLayoutSolution} solution @returns {string[]} */
    function normalizeFixedRoadKeys(solution) {
      const roads = new Set(Array.isArray(solution.roads) ? solution.roads : []);
      return [...new Set(Array.isArray(solution.fixedRoads) ? solution.fixedRoads : [])]
        .filter((roadKey) => typeof roadKey === "string" && roads.has(roadKey))
        .sort();
    }

    /** @param {unknown} value */
    function hasFixedRoadsField(value) {
      return Boolean(value && Object.prototype.hasOwnProperty.call(value, "fixedRoads"));
    }

    /** @param {ManualLayoutSolution} solution */
    function shouldKeepFixedRoadField(solution) {
      return hasFixedRoadsField(solution) || hasFixedRoadsField(state.resultContext?.params);
    }

    /**
     * @param {ManualLayoutSolution} solution
     * @param {Iterable<string>} fixedRoads
     * @param {boolean} [preserveEmpty]
     * @returns {string[]}
     */
    function writeFixedRoadKeys(solution, fixedRoads, preserveEmpty = false) {
      const roads = new Set(Array.isArray(solution.roads) ? solution.roads : []);
      const normalized = [...new Set(fixedRoads)]
        .filter((roadKey) => typeof roadKey === "string" && roads.has(roadKey))
        .sort();
      if (normalized.length > 0 || preserveEmpty) {
        solution.fixedRoads = normalized;
      } else {
        delete solution.fixedRoads;
      }
      return normalized;
    }

    /** @param {ManualLayoutSolution} solution @returns {JsonObject} */
    function buildManualLayoutEvaluationParams(solution) {
      const params = { ...(state.resultContext?.params ?? {}) };
      const fixedRoads = normalizeFixedRoadKeys(solution);
      if (fixedRoads.length > 0 || shouldKeepFixedRoadField(solution)) {
        params.fixedRoads = fixedRoads;
      } else {
        delete params.fixedRoads;
      }
      return params;
    }

    /**
     * @param {ManualLayoutSolution | null | undefined} solution
     * @returns {number}
     */
    function sumRecordedResidentialPopulation(solution) {
      return (solution?.populations ?? []).reduce((sum, population) => {
        const numericPopulation = Number(population);
        return Number.isFinite(numericPopulation) ? sum + numericPopulation : sum;
      }, 0);
    }

    /**
     * @param {ManualLayoutSolution} nextSolution
     * @returns {JsonObject}
     */
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
        totalPopulation: sumRecordedResidentialPopulation(nextSolution)
      };

      return {
        solution: normalizedSolution,
        validation: {
          valid: false,
          errors: [pendingManualLayoutError],
          recomputedPopulations: [],
          recomputedTotalPopulation: normalizedSolution.totalPopulation,
          mapRows: [],
          mapText: ""
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
          residentialCount: normalizedSolution.residentials?.length ?? 0
        }
      };
    }

    /**
     * @param {ManualLayoutSolution} solution
     * @param {ManualLayoutSelection | null | undefined} selection
     */
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

    /**
     * @param {ManualLayoutSolution | null | undefined} solution
     * @param {number} row
     * @param {number} col
     * @returns {ManualLayoutSelection | null}
     */
    function findBuildingAtCell(solution, row, col) {
      if (!solution || !Number.isInteger(row) || !Number.isInteger(col)) return null;

      for (let index = 0; index < (solution.services?.length ?? 0); index += 1) {
        const service = solution.services[index];
        if (row >= service.r && row < service.r + service.rows && col >= service.c && col < service.c + service.cols) {
          return { kind: "service", index };
        }
      }

      for (let index = 0; index < (solution.residentials?.length ?? 0); index += 1) {
        const residential = solution.residentials[index];
        if (
          row >= residential.r &&
          row < residential.r + residential.rows &&
          col >= residential.c &&
          col < residential.c + residential.cols
        ) {
          return { kind: "residential", index };
        }
      }

      return null;
    }

    /**
     * @param {ManualPlacement | null | undefined} placement
     * @param {number} row
     * @param {number} col
     * @returns {boolean}
     */
    function isCellInsidePlacement(placement, row, col) {
      return Boolean(
        placement &&
        row >= placement.r &&
        row < placement.r + placement.rows &&
        col >= placement.c &&
        col < placement.c + placement.cols
      );
    }

    /**
     * @param {(ManualPlacement & { range: number }) | null | undefined} service
     * @param {number} row
     * @param {number} col
     * @returns {boolean}
     */
    function isCellInsideServiceEffect(service, row, col) {
      return Boolean(
        service &&
        row >= service.r - service.range &&
        row <= service.r + service.rows - 1 + service.range &&
        col >= service.c - service.range &&
        col <= service.c + service.cols - 1 + service.range
      );
    }

    /**
     * @param {ManualLayoutSolution | null | undefined} solution
     * @param {number} row
     * @param {number} col
     * @returns {boolean}
     */
    function isCellInsideAnyServiceFootprint(solution, row, col) {
      return (solution?.services ?? []).some((service) => isCellInsidePlacement(service, row, col));
    }

    return {
      buildPendingManualLayoutResult,
      buildPendingPlacementDefinition,
      buildManualLayoutEvaluationParams,
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
      normalizeFixedRoadKeys,
      readPendingPlacementFootprint,
      removePlacementFromSolution,
      shouldKeepFixedRoadField,
      writeFixedRoadKeys
    };
  }

  const manualLayoutGlobal = /** @type {{ PlannerManualLayout?: unknown }} */ (globalObject);

  manualLayoutGlobal.PlannerManualLayout = {
    createPlannerManualLayoutModel
  };
})(typeof window !== "undefined" ? window : globalThis);
