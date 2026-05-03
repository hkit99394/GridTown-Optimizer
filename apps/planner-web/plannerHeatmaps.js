(function attachPlannerHeatmaps(globalObject) {
  function createPlannerHeatmapHelpers(options) {
    const { state, explainabilityModeLabels, helpers } = options;
    const {
      footprintCellsForPlacement,
      getOccupiedCells,
      getTypeAvailabilitySummary,
      isCellInsideAnyServiceFootprint,
      isCellInsideServiceEffect
    } = helpers;

    function formatExplainabilityNumber(value) {
      return Number(value).toLocaleString();
    }

    function normalizeExplainabilityMode() {
      const mode = state.resultExplainabilityMode;
      if (Object.prototype.hasOwnProperty.call(explainabilityModeLabels, mode)) return mode;
      return state.resultHeatmapEnabled ? "service-value" : "layout";
    }

    function createEmptyHeatmap(grid) {
      return {
        values: grid.map((row) => row.map(() => 0)),
        details: grid.map((row) => row.map(() => "")),
        maxValue: 0
      };
    }

    function getPlannerExplainabilityMap() {
      const map = state.result?.explainability;
      if (!map || !Array.isArray(map.cells)) return null;
      return map;
    }

    function getPlannerExplainabilityCell(row, col) {
      return getPlannerExplainabilityMap()?.cells?.[row]?.[col] ?? null;
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

    function getPlacementBlockedCells(solution) {
      const blocked = getOccupiedCells(solution);
      for (const roadKey of solution?.roads ?? []) {
        blocked.add(roadKey);
      }
      return blocked;
    }

    function placementFitsClearCells(grid, placement, blockedCells) {
      if (!grid?.length || placement.r < 0 || placement.c < 0) return false;
      if (placement.r + placement.rows > grid.length || placement.c + placement.cols > (grid[0]?.length ?? 0)) {
        return false;
      }

      for (const cell of footprintCellsForPlacement(placement)) {
        const key = `${cell.r},${cell.c}`;
        if (grid[cell.r]?.[cell.c] !== 1 || blockedCells.has(key)) return false;
      }
      return true;
    }

    function getResidentialTypeOrientations(type) {
      const rows = Number(type?.h ?? 0);
      const cols = Number(type?.w ?? 0);
      if (!(rows > 0) || !(cols > 0)) return [];
      const orientations = [{ rows, cols }];
      if (rows !== cols) {
        orientations.push({ rows: cols, cols: rows });
      }
      return orientations;
    }

    function getServiceBoostForFootprint(solution, placement) {
      if (!solution) return 0;
      const footprint = footprintCellsForPlacement(placement);
      return (solution.services ?? []).reduce((sum, service, index) => {
        if (!footprint.some((cell) => isCellInsideServiceEffect(service, cell.r, cell.c))) return sum;
        const bonus = Number(solution.servicePopulationIncreases?.[index] ?? 0);
        return Number.isFinite(bonus) && bonus > 0 ? sum + bonus : sum;
      }, 0);
    }

    function clampPopulationValue(minPopulation, maxPopulation, boost) {
      const minValue = Number(minPopulation ?? 0);
      const maxValue = Number(maxPopulation ?? minValue);
      const boostValue = Number(boost ?? 0);
      const safeMin = Number.isFinite(minValue) ? minValue : 0;
      const safeMax = Number.isFinite(maxValue) ? maxValue : safeMin;
      const boosted = safeMin + (Number.isFinite(boostValue) ? boostValue : 0);
      return Math.min(Math.max(boosted, safeMin), safeMax);
    }

    function createPlacementOpportunityHeatmap(grid, solution) {
      const heatmap = createEmptyHeatmap(grid);
      const residentialTypes = state.resultContext?.params?.residentialTypes ?? [];
      if (!solution || residentialTypes.length === 0) return heatmap;

      const blockedCells = getPlacementBlockedCells(solution);

      residentialTypes.forEach((type, typeIndex) => {
        const availability = getTypeAvailabilitySummary("residential", typeIndex, solution);
        if (availability.remaining <= 0) return;
        const name = type?.name || `Residential Type ${typeIndex + 1}`;
        for (const orientation of getResidentialTypeOrientations(type)) {
          for (let row = 0; row < grid.length; row += 1) {
            for (let col = 0; col < (grid[row]?.length ?? 0); col += 1) {
              const placement = { r: row, c: col, rows: orientation.rows, cols: orientation.cols };
              if (!placementFitsClearCells(grid, placement, blockedCells)) continue;
              const boost = getServiceBoostForFootprint(solution, placement);
              const value = clampPopulationValue(type.min, type.max, boost);
              if (value <= (heatmap.values[row]?.[col] ?? 0)) continue;
              heatmap.values[row][col] = value;
              heatmap.details[row][col] =
                `${name} ${orientation.rows}x${orientation.cols}, ${availability.remaining} left, ` +
                `${boost > 0 ? `service boost +${formatExplainabilityNumber(boost)}` : "base population only"}`;
              heatmap.maxValue = Math.max(heatmap.maxValue, value);
            }
          }
        }
      });

      return heatmap;
    }

    function getTraversableCells(grid, solution) {
      const buildingCells = getOccupiedCells(solution);
      const traversable = new Set();
      for (let row = 0; row < grid.length; row += 1) {
        for (let col = 0; col < (grid[row]?.length ?? 0); col += 1) {
          const key = `${row},${col}`;
          if (grid[row][col] === 1 && !buildingCells.has(key)) {
            traversable.add(key);
          }
        }
      }
      return traversable;
    }

    function getNeighborCellKeys(row, col) {
      return [`${row - 1},${col}`, `${row + 1},${col}`, `${row},${col - 1}`, `${row},${col + 1}`];
    }

    function floodReachableFromAnchorBoundary(grid, traversable, removedKey = null) {
      const reachable = new Set();
      const queue = [];
      const addAnchor = (row, col) => {
        const key = `${row},${col}`;
        if (key !== removedKey && traversable.has(key) && !reachable.has(key)) {
          reachable.add(key);
          queue.push(key);
        }
      };
      const cols = grid[0]?.length ?? 0;
      for (let col = 0; col < cols; col += 1) {
        addAnchor(0, col);
      }
      for (let row = 1; row < grid.length; row += 1) {
        addAnchor(row, 0);
      }

      for (let index = 0; index < queue.length; index += 1) {
        const [row, col] = queue[index].split(",").map(Number);
        for (const nextKey of getNeighborCellKeys(row, col)) {
          if (nextKey === removedKey || reachable.has(nextKey) || !traversable.has(nextKey)) continue;
          reachable.add(nextKey);
          queue.push(nextKey);
        }
      }

      return reachable;
    }

    function createConnectivityRiskHeatmap(grid, solution) {
      const heatmap = createEmptyHeatmap(grid);
      const traversable = getTraversableCells(grid, solution);
      if (traversable.size === 0) return heatmap;

      const baseReachable = floodReachableFromAnchorBoundary(grid, traversable);
      if (baseReachable.size === 0) return heatmap;

      for (const key of baseReachable) {
        const [row, col] = key.split(",").map(Number);
        const reachableWithoutCell = floodReachableFromAnchorBoundary(grid, traversable, key);
        const lostReachableCells = Math.max(0, baseReachable.size - reachableWithoutCell.size - 1);
        if (lostReachableCells <= 0) continue;
        heatmap.values[row][col] = lostReachableCells;
        heatmap.details[row][col] =
          `occupying this support cell would strand ${formatExplainabilityNumber(lostReachableCells)} reachable cell` +
          `${lostReachableCells === 1 ? "" : "s"}`;
        heatmap.maxValue = Math.max(heatmap.maxValue, lostReachableCells);
      }

      return heatmap;
    }

    function createBackendExplainabilityHeatmap(mode, grid) {
      const map = getPlannerExplainabilityMap();
      if (!map) return null;
      const heatmap = createEmptyHeatmap(grid);

      for (let row = 0; row < grid.length; row += 1) {
        for (let col = 0; col < (grid[row]?.length ?? 0); col += 1) {
          const cell = map.cells?.[row]?.[col];
          if (!cell?.allowed) continue;

          if (mode === "service-value") {
            const value = Number(cell.serviceValue ?? 0);
            if (!(value > 0)) continue;
            const anchorReachable = cell.roadAnchorReachable;
            const anchorDistance = cell.roadAnchorDistance ?? 0;
            heatmap.values[row][col] = value;
            heatmap.details[row][col] = anchorReachable
              ? `anchor reachable at distance ${formatExplainabilityNumber(anchorDistance)}`
              : "not anchor reachable";
            heatmap.maxValue = Math.max(heatmap.maxValue, map.maxServiceValue ?? value);
          } else if (mode === "placement-opportunity") {
            const residentialValue = Number(cell.residentialOpportunity ?? 0);
            const serviceBonus = Number(cell.bestServiceBonus ?? 0);
            const value = Math.max(residentialValue, serviceBonus);
            if (!(value > 0)) continue;
            heatmap.values[row][col] = value;
            heatmap.details[row][col] = [
              residentialValue > 0 ? `residential up to ${formatExplainabilityNumber(residentialValue)}` : "",
              Number(cell.residentialHeadroom ?? 0) > 0
                ? `headroom +${formatExplainabilityNumber(cell.residentialHeadroom)}`
                : "",
              serviceBonus > 0 ? `best remaining service +${formatExplainabilityNumber(serviceBonus)}` : ""
            ]
              .filter(Boolean)
              .join(", ");
            heatmap.maxValue = Math.max(
              heatmap.maxValue,
              map.maxResidentialOpportunity ?? value,
              map.maxBestServiceBonus ?? serviceBonus
            );
          } else if (mode === "connectivity-risk") {
            const disconnected = Number(cell.connectivityDisconnectedCells ?? 0);
            const lost = Number(cell.connectivityLostCells ?? 0);
            const footprint = Number(cell.connectivityFootprintCells ?? 0);
            const value = disconnected || lost;
            if (!(value > 0)) continue;
            heatmap.values[row][col] = value;
            heatmap.details[row][col] = [
              disconnected > 0 ? `${formatExplainabilityNumber(disconnected)} disconnected` : "",
              lost > 0 ? `${formatExplainabilityNumber(lost)} lost` : "",
              footprint > 0 ? `${formatExplainabilityNumber(footprint)} footprint` : ""
            ]
              .filter(Boolean)
              .join(", ");
            heatmap.maxValue = Math.max(
              heatmap.maxValue,
              map.maxConnectivityDisconnectedCells ?? disconnected,
              map.maxConnectivityLostCells ?? lost
            );
          }
        }
      }

      return heatmap;
    }

    function createFallbackExplainabilityHeatmap(mode, grid, solution) {
      if (mode === "service-value") {
        return createServiceValueHeatmap(grid, solution);
      }
      if (mode === "placement-opportunity") {
        return createPlacementOpportunityHeatmap(grid, solution);
      }
      if (mode === "connectivity-risk") {
        return createConnectivityRiskHeatmap(grid, solution);
      }
      return createEmptyHeatmap(grid);
    }

    function createExplainabilityHeatmap(mode, grid, solution) {
      return (
        createBackendExplainabilityHeatmap(mode, grid) ?? createFallbackExplainabilityHeatmap(mode, grid, solution)
      );
    }

    function describeExplainabilityValue(mode, value, detail = "") {
      if (!(value > 0)) return "";
      if (mode === "service-value") {
        return `service value +${formatExplainabilityNumber(value)}${detail ? ` (${detail})` : ""}`;
      }
      if (mode === "placement-opportunity") {
        return `placement opportunity ${formatExplainabilityNumber(value)}${detail ? ` (${detail})` : ""}`;
      }
      if (mode === "connectivity-risk") {
        return `connectivity risk ${formatExplainabilityNumber(value)} cell${value === 1 ? "" : "s"}${detail ? ` (${detail})` : ""}`;
      }
      return "";
    }

    function applyExplainabilityHeatmapStyle(cell, mode, value, maxValue) {
      if (!(value > 0) || !(maxValue > 0)) return;
      const intensity = Math.max(0.18, Math.min(1, value / maxValue));
      const warmAlpha = (0.26 + intensity * 0.5).toFixed(2);
      const hotAlpha = (0.18 + intensity * 0.52).toFixed(2);
      const borderAlpha = (0.26 + intensity * 0.4).toFixed(2);
      cell.className += ` heatmap-cell ${mode}-heatmap-cell`;
      cell.dataset.explainabilityValue = String(value);
      if (mode === "service-value") {
        cell.dataset.serviceValue = String(value);
      } else if (mode === "placement-opportunity") {
        cell.dataset.placementOpportunity = String(value);
      } else if (mode === "connectivity-risk") {
        cell.dataset.connectivityRisk = String(value);
      }
      cell.style.setProperty("--heatmap-warm-alpha", warmAlpha);
      cell.style.setProperty("--heatmap-hot-alpha", hotAlpha);
      cell.style.setProperty("--heatmap-border-alpha", borderAlpha);
    }

    function hidesBuildingOverlayForMode(mode = normalizeExplainabilityMode()) {
      return mode === "service-value";
    }

    return Object.freeze({
      applyExplainabilityHeatmapStyle,
      createExplainabilityHeatmap,
      describeExplainabilityValue,
      formatExplainabilityNumber,
      getPlannerExplainabilityCell,
      hidesBuildingOverlayForMode,
      normalizeExplainabilityMode
    });
  }

  globalObject.PlannerHeatmaps = Object.freeze({
    createPlannerHeatmapHelpers
  });
})(window);
