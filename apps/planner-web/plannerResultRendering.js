/**
 * @param {Window & { PlannerResultRendering?: unknown }} globalObject
 */
(function attachPlannerResultRendering(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {number[][]} PlannerGrid
   * @typedef {{ r: number, c: number }} ResultCell
   * @typedef {{ r: number, c: number, rows: number, cols: number, range?: number, [key: string]: any }} ResultPlacement
   * @typedef {{ kind: "service" | "residential", index: number }} ResultSelection
   * @typedef {{ kind: "service" | "residential", placement: ResultPlacement, index: number }} SelectedResultPlacement
   * @typedef {SelectedResultPlacement | null} MaybeSelectedResultPlacement
   * @typedef {JsonObject & { populations: number[], residentials: ResultPlacement[], residentialTypeIndices: number[], roads: string[], servicePopulationIncreases: number[], services: ResultPlacement[], serviceTypeIndices: number[] }} ResultSolution
   * @typedef {JsonObject | null | undefined} MaybeJson
   * @typedef {HTMLElement | null | undefined} MaybeElement
   * @typedef {PlannerGrid | null | undefined} MaybeGrid
   * @typedef {{ id: string, name: string, bonus: number }} BonusCoverageEntry
   * @typedef {{ totalAvailable: number, used: number, remaining: number }} TypeAvailabilitySummary
   * @typedef {{ cellSize: number, gap: number, paddingX: number, paddingY: number }} MatrixLayout
   * @typedef {{ result?: JsonObject | null, resultContext?: JsonObject | null, grid: PlannerGrid, resultExplainabilityMode: string, resultHeatmapEnabled: boolean, selectedMapBuilding: ResultSelection | null, selectedMapCell: ResultCell | null, isSolving: boolean, layoutEditor: JsonObject }} RenderingState
   */

  /**
   * @param {MaybeJson} type
   * @param {boolean} isService
   */
  function getTypeTotalAvailable(type, isService) {
    const fallback = isService ? 1 : 0;
    const rawAvailable = type?.avail ?? fallback;
    const parsedAvailable = Number(rawAvailable);
    return Number.isFinite(parsedAvailable) ? Math.max(0, Math.floor(parsedAvailable)) : fallback;
  }

  /**
   * @param {{ state: RenderingState }} options
   */
  function createPlannerResultAvailabilityHelpers(options) {
    const { state } = options;

    /**
     * @param {unknown} typeIndices
     * @param {number} typeCount
     */
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

    /**
     * @param {string} kind
     * @param {number} typeIndex
     * @param {ResultSolution | null | undefined} solution
     */
    function getTypeAvailabilitySummary(kind, typeIndex, solution) {
      const isService = kind === "service";
      const types = isService
        ? (state.resultContext?.params?.serviceTypes ?? [])
        : (state.resultContext?.params?.residentialTypes ?? []);
      const usedCounts = countPlacementsByType(
        isService ? solution?.serviceTypeIndices : solution?.residentialTypeIndices,
        types.length
      );
      const totalAvailable = getTypeTotalAvailable(types[typeIndex], isService);
      const used = usedCounts[typeIndex] ?? 0;
      return {
        totalAvailable,
        used,
        remaining: Math.max(0, totalAvailable - used)
      };
    }

    return Object.freeze({
      countPlacementsByType,
      getTypeAvailabilitySummary
    });
  }

  /**
   * @param {object} options
   * @param {RenderingState} options.state
   * @param {JsonObject} options.elements
   * @param {object} options.helpers
   * @param {(cell: HTMLElement, mode: string, value: number, maxValue: number) => void} options.helpers.applyExplainabilityHeatmapStyle
   * @param {(mode: string, grid: PlannerGrid, solution: ResultSolution) => JsonObject | null} options.helpers.createExplainabilityHeatmap
   * @param {(mode: string, value: number, detail: string) => string} options.helpers.describeExplainabilityValue
   * @param {(solution: ResultSolution | null | undefined, row: number, col: number) => MaybeSelectedResultPlacement} options.helpers.findBuildingAtCell
   * @param {(value: unknown) => string} options.helpers.formatExplainabilityNumber
   * @param {(row: number, col: number) => JsonObject | null} options.helpers.getPlannerExplainabilityCell
   * @param {(grid?: MaybeGrid) => ResultCell | null} options.helpers.getSelectedMapCell
   * @param {(solution: ResultSolution | null | undefined, selection?: ResultSelection | null | undefined) => MaybeSelectedResultPlacement} options.helpers.getSelectedMapPlacement
   * @param {(kind: string, typeIndex: number, solution: ResultSolution | null | undefined) => TypeAvailabilitySummary} options.helpers.getTypeAvailabilitySummary
   * @param {() => boolean} options.helpers.hasPendingManualValidation
   * @param {(placement: ResultPlacement, row: number, col: number) => boolean} options.helpers.isCellInsidePlacement
   * @param {(service: ResultPlacement, row: number, col: number) => boolean} options.helpers.isCellInsideServiceEffect
   * @param {() => string} options.helpers.normalizeExplainabilityMode
   * @param {(mode: string) => boolean} options.helpers.hidesBuildingOverlayForMode
   * @param {(typeIndex: number) => string} options.helpers.lookupResidentialName
   * @param {(typeIndex: number) => string} options.helpers.lookupServiceName
   * @param {object} options.callbacks
   * @param {(gridElement: HTMLElement) => void} options.callbacks.applyMatrixLayout
   * @param {(optimizer: string) => string} options.callbacks.getOptimizerLabel
   */
  function createPlannerResultRenderingHelpers(options) {
    const { state, elements, helpers, callbacks } = options;
    const {
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
      isCellInsidePlacement,
      isCellInsideServiceEffect,
      normalizeExplainabilityMode,
      hidesBuildingOverlayForMode: heatmapHidesBuildingOverlayForMode,
      lookupResidentialName,
      lookupServiceName
    } = helpers;
    const { applyMatrixLayout, getOptimizerLabel } = callbacks;
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
     * @param {MaybeGrid} grid
     * @param {ResultSolution | null | undefined} solution
     * @param {number} row
     * @param {number} col
     */
    function getSolvedCellKind(grid, solution, row, col) {
      if (grid?.[row]?.[col] !== 1) return "blocked";
      if (findBuildingAtCell(solution, row, col)?.kind === "service") return "service";
      if (findBuildingAtCell(solution, row, col)?.kind === "residential") return "residential";
      if ((solution?.roads ?? []).includes?.(`${row},${col}`)) return "road";
      return "empty";
    }

    /**
     * @param {ResultSolution | null | undefined} solution
     * @param {number} row
     * @param {number} col
     * @returns {BonusCoverageEntry[]}
     */
    function getCellBonusCoverage(solution, row, col) {
      const grid = state.resultContext?.grid ?? state.grid;
      if (!grid?.length || grid[row]?.[col] !== 1 || !solution) return [];

      return (solution.services ?? []).flatMap((service, index) => {
        if (isCellInsidePlacement(service, row, col) || !isCellInsideServiceEffect(service, row, col)) return [];

        return [
          {
            id: `S${index + 1}`,
            name: lookupServiceName(solution.serviceTypeIndices?.[index] ?? -1),
            bonus: Number(solution.servicePopulationIncreases?.[index] ?? 0)
          }
        ];
      });
    }

    /**
     * @param {JsonObject | null | undefined} cell
     */
    function formatCellExplainability(cell) {
      if (!cell) return "";
      const parts = [];
      if (cell.serviceValue > 0) {
        parts.push(`service value +${formatExplainabilityNumber(cell.serviceValue)}`);
      }
      if (cell.residentialOpportunity > 0) {
        parts.push(`residential up to ${formatExplainabilityNumber(cell.residentialOpportunity)}`);
      }
      if (cell.bestServiceBonus > 0) {
        parts.push(`best remaining service +${formatExplainabilityNumber(cell.bestServiceBonus)}`);
      }
      if (cell.connectivityDisconnectedCells > 0 || cell.connectivityLostCells > 0) {
        parts.push(
          `connectivity risk ${formatExplainabilityNumber(cell.connectivityDisconnectedCells || cell.connectivityLostCells)} cell` +
            `${(cell.connectivityDisconnectedCells || cell.connectivityLostCells) === 1 ? "" : "s"}`
        );
      }
      const anchorReachable = cell.roadAnchorReachable;
      if (anchorReachable) {
        parts.push(`anchor distance ${formatExplainabilityNumber(cell.roadAnchorDistance ?? 0)}`);
      }
      return parts.join("; ");
    }

    /**
     * @param {unknown} population
     * @param {JsonObject | null | undefined} type
     */
    function getResidentialPossibleImprovement(population, type) {
      const currentPopulation = Number(population);
      const maxPopulation = Number(type?.max);
      if (!Number.isFinite(currentPopulation) || !Number.isFinite(maxPopulation)) return null;
      const possibleImprovement = maxPopulation - currentPopulation;
      if (possibleImprovement <= 0) return null;
      return {
        possibleImprovement,
        maxPopulation
      };
    }

    /**
     * @param {ResultSolution | null | undefined} [solution]
     */
    function renderSelectedBuildingDetail(solution = state.result?.solution) {
      if (!elements.selectedBuildingTitle || !elements.selectedBuildingFacts || !elements.selectedBuildingSummary) {
        return;
      }

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
        const kind = getSolvedCellKind(
          state.resultContext?.grid ?? state.grid,
          solution,
          selectedCell.r,
          selectedCell.c
        );
        const coverage = getCellBonusCoverage(solution, selectedCell.r, selectedCell.c);
        const explainability = getPlannerExplainabilityCell(selectedCell.r, selectedCell.c);
        const explainabilityText = formatCellExplainability(explainability);
        const totalBonus = coverage.reduce((sum, entry) => sum + entry.bonus, 0);
        const sourceText = coverage.length
          ? coverage.map((entry) => `${entry.name} (${entry.id})`).join(", ")
          : "no nearby service zones";
        const categoryLabel =
          kind === "road"
            ? "Road"
            : kind === "empty"
              ? "Empty cell"
              : kind === "blocked"
                ? "Blocked cell"
                : kind === "service"
                  ? "Service cell"
                  : "Residential cell";

        elements.selectedBuildingTitle.textContent = `${categoryLabel} (${selectedCell.r}, ${selectedCell.c})`;
        elements.selectedBuildingSummary.textContent =
          kind === "blocked"
            ? "Blocked cells do not receive service bonus coverage."
            : `Potential service bonus at this position is +${totalBonus} population from ${sourceText}.` +
              `${explainabilityText ? ` Planner map: ${explainabilityText}.` : ""}`;
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
        const anchorReachable = Boolean(explainability?.roadAnchorReachable);
        elements.selectedBuildingAvailability.textContent =
          kind === "empty"
            ? anchorReachable
              ? "Open and anchor reachable"
              : "Open cell"
            : kind === "road"
              ? anchorReachable
                ? "Occupied by anchor reachable road"
                : "Occupied by road"
              : kind === "blocked"
                ? "Not buildable"
                : "Occupied by a building";
        elements.selectedBuildingFacts.hidden = false;
        return;
      }

      if (!selected || !solution) return;
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
      const residentialPopulation = solution.populations?.[selected.index] ?? 0;
      const residentialPossibleImprovement = isService
        ? null
        : getResidentialPossibleImprovement(residentialPopulation, type);
      const residentialPossibleImprovementSummary = residentialPossibleImprovement
        ? ` Possible improvement: +${residentialPossibleImprovement.possibleImprovement} to max ${residentialPossibleImprovement.maxPopulation}.`
        : "";
      const residentialPossibleImprovementEffect = residentialPossibleImprovement
        ? `, possible improvement +${residentialPossibleImprovement.possibleImprovement}`
        : "";

      elements.selectedBuildingTitle.textContent = name;
      elements.selectedBuildingSummary.textContent = isService
        ? `${buildingId} is a service placement covering ${placement.rows}x${placement.cols} with range ${placement.range}.`
        : pendingManualValidation
          ? `${buildingId} is a residential placement with population pending validation.`
          : `${buildingId} is a residential placement contributing ${residentialPopulation} population.${residentialPossibleImprovementSummary}`;
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
          : `${residentialPopulation} population, type range ${type?.min ?? 0}-${type?.max ?? 0}${residentialPossibleImprovementEffect}`;
      elements.selectedBuildingAvailability.textContent = `${availability.remaining} left of ${availability.totalAvailable} for this type`;
      elements.selectedBuildingFacts.hidden = false;
    }

    /**
     * @param {MaybeElement} listElement
     * @param {JsonObject[] | null | undefined} types
     * @param {number[]} usedCounts
     * @param {string} labelPrefix
     */
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
            return [
              {
                name: type?.name || `${labelPrefix} Type ${index + 1}`,
                kind: isService ? "service" : "residential",
                typeIndex: index,
                remaining,
                totalAvailable,
                detail: isService
                  ? `${Number(type?.bonus ?? 0)}`
                  : `${Number(type?.min ?? 0)}/${Number(type?.max ?? 0)}, ${Number(type?.w ?? 0)}x${Number(type?.h ?? 0)}`
              }
            ];
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
     * @param {ResultSolution | null | undefined} solution
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

    /**
     * @param {MaybeJson} solution
     */
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

    /**
     * @param {MaybeJson} solution
     * @param {MaybeJson} stats
     */
    function formatCpSatSeedStatus(solution, stats) {
      if (stats?.optimizer === "auto" || solution?.optimizer === "auto") {
        return formatAutoSeedStatus(solution);
      }
      const configuredSeed = state.resultContext?.params?.cpSat?.randomSeed;
      const portfolio = solution?.cpSatPortfolio ?? null;
      const portfolioWorkers = /** @type {JsonObject[]} */ (portfolio?.workers ?? []);
      if (portfolioWorkers.length > 0) {
        const selectedWorker = portfolioWorkers.find((worker) => worker.workerIndex === portfolio?.selectedWorkerIndex);
        const feasibleWorkers = portfolioWorkers.filter((worker) => worker.feasible);
        const populations = feasibleWorkers
          .map((worker) => (Number.isFinite(worker.totalPopulation) ? Number(worker.totalPopulation) : null))
          .filter((population) => population !== null);
        const populationSpread = populations.length > 1 ? Math.max(...populations) - Math.min(...populations) : null;
        const selectedLabel = `selected worker ${Number(selectedWorker?.workerIndex ?? 0) + 1}/${portfolio?.workerCount ?? portfolioWorkers.length}`;
        const seedLabel = Number.isInteger(selectedWorker?.randomSeed) ? ` seed ${selectedWorker?.randomSeed}` : "";
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

    /**
     * @param {PlannerGrid} grid
     * @param {ResultSolution} solution
     */
    function createSolvedMapMatrix(grid, solution) {
      const matrix = /** @type {string[][]} */ (
        grid.map((row) => row.map((cell) => (cell === 1 ? "empty" : "blocked")))
      );

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

    /**
     * @param {string} kind
     * @param {number} row
     * @param {number} col
     * @param {string} hoverLabel
     */
    function describeSolvedCell(kind, row, col, hoverLabel) {
      if (hoverLabel) {
        return `Solved cell ${row},${col} belongs to ${hoverLabel}`;
      }
      const label =
        kind === "road"
          ? "road"
          : kind === "service"
            ? "service building"
            : kind === "residential"
              ? "residential building"
              : kind === "blocked"
                ? "blocked"
                : "empty allowed";
      return `Solved cell ${row},${col} is ${label}`;
    }

    /**
     * @param {ResultSolution} solution
     * @param {number} rows
     * @param {number} cols
     */
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

    /**
     * @param {Element} element
     * @returns {MatrixLayout}
     */
    function readMatrixLayout(element) {
      const styles = globalObject.getComputedStyle(element);
      return {
        cellSize: Number.parseFloat(styles.getPropertyValue("--matrix-cell-size")) || 28,
        gap: Number.parseFloat(styles.getPropertyValue("--matrix-gap")) || 6,
        paddingX: Number.parseFloat(styles.paddingLeft) || 18,
        paddingY: Number.parseFloat(styles.paddingTop) || 18
      };
    }

    /**
     * @param {"service" | "residential"} kind
     * @param {number} index
     * @param {ResultPlacement} placement
     * @param {MatrixLayout} layout
     * @param {string} label
     * @param {boolean} [isSelected]
     */
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

    /**
     * @param {ResultSolution | null | undefined} solution
     */
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

    function getActiveExplainabilityMode() {
      return normalizeExplainabilityMode();
    }

    /**
     * @param {string} [mode]
     */
    function hidesBuildingOverlayForMode(mode = getActiveExplainabilityMode()) {
      return heatmapHidesBuildingOverlayForMode(mode);
    }

    function refreshResultOverlay() {
      if (!state.result?.solution || !elements.resultMapGrid.dataset.cols) {
        clearResultOverlay();
        return;
      }
      if (hidesBuildingOverlayForMode()) {
        clearResultOverlay();
        return;
      }
      renderBuildingOverlay(state.result.solution);
    }

    /**
     * @param {MaybeGrid} grid
     * @param {ResultSolution} solution
     */
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
      const explainabilityMode = getActiveExplainabilityMode();
      const showExplainabilityMap = explainabilityMode !== "layout";
      const hideOverlayForMode = hidesBuildingOverlayForMode(explainabilityMode);
      const heatmap = showExplainabilityMap ? createExplainabilityHeatmap(explainabilityMode, grid, solution) : null;
      state.selectedMapBuilding = getSelectedMapPlacement(solution)?.kind ? state.selectedMapBuilding : null;
      state.selectedMapCell = getSelectedMapCell(grid);
      elements.resultMapGrid.innerHTML = "";
      elements.resultMapGrid.dataset.cols = String(cols);

      for (let r = 0; r < matrix.length; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const kind = matrix[r][c];
          const visualKind = hideOverlayForMode && kind !== "blocked" ? "empty" : kind;
          const hoverLabel = hideOverlayForMode ? "" : hoverLabels[r]?.[c] || "";
          const explainabilityValue = heatmap?.values?.[r]?.[c] ?? 0;
          const explainabilityDetail = heatmap?.details?.[r]?.[c] ?? "";
          const explainabilityValueLabel = describeExplainabilityValue(
            explainabilityMode,
            explainabilityValue,
            explainabilityDetail
          );
          const explainabilityLabel = explainabilityValueLabel ? `, ${explainabilityValueLabel}` : "";
          const cell = document.createElement("div");
          cell.className = `grid-cell ${visualKind}`;
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute("aria-label", `${describeSolvedCell(visualKind, r, c, hoverLabel)}${explainabilityLabel}`);
          cell.title = `${hoverLabel || `(${r}, ${c}) ${visualKind}`}${explainabilityLabel}`;
          applyExplainabilityHeatmapStyle(cell, explainabilityMode, explainabilityValue, heatmap?.maxValue ?? 0);
          if (!hideOverlayForMode && (kind === "service" || kind === "residential")) {
            cell.classList.add("selectable");
          }
          if (state.selectedMapCell?.r === r && state.selectedMapCell?.c === c) {
            cell.classList.add("selected");
          }
          elements.resultMapGrid.append(cell);
        }
      }

      applyMatrixLayout(elements.resultMapGrid);
      if (hideOverlayForMode) {
        clearResultOverlay();
      } else {
        renderBuildingOverlay(solution);
      }
      renderSelectedBuildingDetail(solution);
    }

    return Object.freeze({
      clearResultOverlay,
      formatCpSatSeedStatus,
      getActiveExplainabilityMode,
      hidesBuildingOverlayForMode,
      refreshResultOverlay,
      renderGreedyDiagnostics,
      renderRemainingAvailability,
      renderSelectedBuildingDetail,
      renderSolvedMap
    });
  }

  const renderingGlobal =
    /** @type {Window & { PlannerResultRendering?: unknown }} */
    (globalObject);

  renderingGlobal.PlannerResultRendering = Object.freeze({
    createPlannerResultAvailabilityHelpers,
    createPlannerResultRenderingHelpers
  });
})(window);
