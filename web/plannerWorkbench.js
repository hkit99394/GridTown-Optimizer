(function attachPlannerWorkbench(globalObject) {
  function createPlannerWorkbenchController(options) {
    const {
      state,
      elements,
      constants,
      helpers,
      callbacks,
    } = options;
    const {
      sampleGrid,
    } = constants;
    const {
      cloneGrid,
      createGrid,
      escapeHtml,
      isGridLike,
      normalizeOptimizer,
      parseCatalogImportText,
      serializeResidentialTypeForCatalog,
      serializeServiceTypeForCatalog,
    } = helpers;
    const {
      getOptimizerLabel,
      refreshResultOverlay,
      renderExpansionAdvice,
      setSolveState,
      updatePayloadPreview,
    } = callbacks;

    function applySolveRequestToPlanner(request, options = {}) {
      const { preserveCpSatRuntime = true, optimizer = "auto" } = options;
      if (!isGridLike(request?.grid) || typeof request?.params !== "object" || request.params == null) {
        throw new Error("That saved layout does not include a usable planner configuration.");
      }

      const params = request.params;
      state.grid = cloneGrid(request.grid);
      state.serviceTypes = Array.isArray(params.serviceTypes)
        ? params.serviceTypes.map((serviceType) => serializeServiceTypeForCatalog(serviceType))
        : [];
      state.residentialTypes = Array.isArray(params.residentialTypes)
        ? params.residentialTypes.map((residentialType) => serializeResidentialTypeForCatalog(residentialType))
        : [];
      state.availableBuildings = {
        services: params.availableBuildings?.services != null ? String(params.availableBuildings.services) : (params.maxServices != null ? String(params.maxServices) : ""),
        residentials: params.availableBuildings?.residentials != null
          ? String(params.availableBuildings.residentials)
          : (params.maxResidentials != null ? String(params.maxResidentials) : ""),
      };
      state.optimizer = normalizeOptimizer(optimizer);
      if (params.greedy) {
        state.greedy = {
          ...state.greedy,
          randomSeed: "",
          ...params.greedy,
        };
      }
      if (params.lns) {
        state.lns = {
          ...state.lns,
          ...params.lns,
        };
      }
      state.auto = {
        ...(state.auto ?? { wallClockLimitSeconds: "" }),
        wallClockLimitSeconds: params.auto?.wallClockLimitSeconds != null ? String(params.auto.wallClockLimitSeconds) : "",
      };

      if (!preserveCpSatRuntime && params.cpSat) {
        state.cpSat = {
          ...state.cpSat,
          randomSeed: "",
          ...(params.cpSat.timeLimitSeconds != null ? { timeLimitSeconds: String(params.cpSat.timeLimitSeconds) } : {}),
          ...(params.cpSat.noImprovementTimeoutSeconds != null
            ? { noImprovementTimeoutSeconds: String(params.cpSat.noImprovementTimeoutSeconds) }
            : {}),
          ...(params.cpSat.randomSeed != null ? { randomSeed: String(params.cpSat.randomSeed) } : {}),
          ...(params.cpSat.numWorkers != null ? { numWorkers: params.cpSat.numWorkers } : {}),
          ...(params.cpSat.logSearchProgress != null ? { logSearchProgress: Boolean(params.cpSat.logSearchProgress) } : {}),
          ...(params.cpSat.pythonExecutable != null ? { pythonExecutable: String(params.cpSat.pythonExecutable) } : {}),
          ...(params.cpSat.useDisplayedHint != null ? { useDisplayedHint: Boolean(params.cpSat.useDisplayedHint) } : {}),
        };
      }

      syncPlannerFromState();
    }

    function syncPlannerFromState() {
      updateGridDimensionInputs();
      setOptimizer(state.optimizer);
      syncSolverFields();
      elements.expansionNextService.value = state.expansionAdvice.nextServiceText;
      elements.expansionNextResidential.value = state.expansionAdvice.nextResidentialText;
      renderGrid();
      renderServiceTypes();
      renderResidentialTypes();
      updatePayloadPreview();
      updateSummary();
      renderExpansionAdvice();
    }

    function setPaintMode(mode) {
      state.paintMode = mode;
      for (const button of elements.paintModeToggle.querySelectorAll("button")) {
        button.classList.toggle("active", button.dataset.paintMode === mode);
      }
    }

    function setOptimizer(optimizer) {
      state.optimizer = normalizeOptimizer(optimizer);
      const showAutoPanels = state.optimizer === "auto";
      for (const button of elements.solverToggle.querySelectorAll("button")) {
        button.classList.toggle("active", button.dataset.optimizer === state.optimizer);
      }
      if (elements.autoPanel) {
        elements.autoPanel.hidden = !showAutoPanels;
      }
      elements.greedyPanel.hidden = !showAutoPanels && state.optimizer !== "greedy";
      elements.lnsPanel.hidden = !showAutoPanels && state.optimizer !== "lns";
      elements.cpSatPanel.hidden = !showAutoPanels && state.optimizer !== "cp-sat";
      syncSolverFields();
      updateSummary();
    }

    function updateGridDimensionInputs() {
      elements.gridRows.value = String(state.grid.length);
      elements.gridCols.value = String(state.grid[0]?.length ?? 0);
    }

    function countAllowedCells() {
      return state.grid.reduce(
        (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + (cell === 1 ? 1 : 0), 0),
        0
      );
    }

    function getMatrixMetrics(cols, frameWidth, layoutMode = "adaptive") {
      const maxSize =
        cols <= 12 ? 34 :
        cols <= 18 ? 30 :
        cols <= 24 ? 24 :
        cols <= 30 ? 20 :
        cols <= 40 ? 16 :
        12;
      const minSize =
        cols <= 18 ? 18 :
        cols <= 30 ? 13 :
        10;
      const gap =
        cols <= 16 ? 6 :
        cols <= 30 ? 4 :
        2;
      const usableWidth = Math.max(220, (frameWidth || 0) - 40);
      const fitSize = Math.floor((usableWidth - gap * Math.max(cols - 1, 0)) / Math.max(cols, 1));
      if (layoutMode === "comfortable") {
        const preferredSize =
          cols <= 12 ? 34 :
          cols <= 18 ? 30 :
          cols <= 24 ? 26 :
          cols <= 30 ? 22 :
          cols <= 40 ? 18 :
          14;
        const comfortableMin =
          cols <= 24 ? 20 :
          cols <= 30 ? 18 :
          cols <= 40 ? 14 :
          12;
        const size = Math.max(comfortableMin, Math.min(maxSize, Math.max(fitSize || preferredSize, preferredSize)));
        return { size, gap };
      }
      const size = Math.max(minSize, Math.min(maxSize, fitSize || maxSize));
      return { size, gap };
    }

    function applyMatrixLayout(gridElement) {
      if (!gridElement) return;
      const cols = Number(gridElement.dataset.cols || 0);
      if (!cols) return;
      const frame = typeof gridElement.closest === "function"
        ? (gridElement.closest(".matrix-frame, .grid-frame") || gridElement.parentElement)
        : gridElement.parentElement;
      const layoutMode = gridElement.dataset.layoutMode || "adaptive";
      const { size, gap } = getMatrixMetrics(cols, frame?.clientWidth ?? 0, layoutMode);
      gridElement.style.setProperty("--matrix-cell-size", `${size}px`);
      gridElement.style.setProperty("--matrix-gap", `${gap}px`);
      gridElement.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
    }

    function refreshMatrixLayouts() {
      applyMatrixLayout(elements.gridEditor);
      applyMatrixLayout(elements.resultMapGrid);
      refreshResultOverlay();
    }

    function buildCanvasCellLabel(value, row, col) {
      return `Cell ${row},${col} is ${value === 1 ? "allowed" : "blocked"}`;
    }

    function renderGrid() {
      const rows = state.grid.length;
      const cols = state.grid[0]?.length ?? 0;
      elements.gridEditor.innerHTML = "";
      elements.gridEditor.dataset.cols = String(cols);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = `grid-cell ${state.grid[r][c] === 1 ? "allowed" : "blocked"}`;
          cell.dataset.r = String(r);
          cell.dataset.c = String(c);
          cell.setAttribute("aria-label", buildCanvasCellLabel(state.grid[r][c], r, c));
          cell.title = `(${r}, ${c}) = ${state.grid[r][c]}`;
          elements.gridEditor.append(cell);
        }
      }
      updateGridStats();
      applyMatrixLayout(elements.gridEditor);
    }

    function updateGridStats() {
      const rows = state.grid.length;
      const cols = state.grid[0]?.length ?? 0;
      const allowed = countAllowedCells();
      const total = rows * cols;
      elements.gridStats.textContent = `${rows} x ${cols} grid, ${allowed} allowed, ${total - allowed} blocked.`;
      updateSummary();
    }

    function applyPaint(cellElement) {
      const row = Number(cellElement.dataset.r);
      const col = Number(cellElement.dataset.c);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      const current = state.grid[row][col];
      const next =
        state.paintMode === "toggle" ? (current === 1 ? 0 : 1) :
        state.paintMode === "allow" ? 1 :
        0;
      if (current === next) return;
      state.grid[row][col] = next;
      cellElement.classList.toggle("allowed", next === 1);
      cellElement.classList.toggle("blocked", next === 0);
      cellElement.setAttribute("aria-label", buildCanvasCellLabel(next, row, col));
      cellElement.title = `(${row}, ${col}) = ${next}`;
      updateGridStats();
      updatePayloadPreview();
    }

    function resizeGrid(rows, cols) {
      const next = createGrid(rows, cols, 1);
      for (let r = 0; r < Math.min(rows, state.grid.length); r += 1) {
        for (let c = 0; c < Math.min(cols, state.grid[0].length); c += 1) {
          next[r][c] = state.grid[r][c];
        }
      }
      state.grid = next;
      updateGridDimensionInputs();
      renderGrid();
      updatePayloadPreview();
    }

    function applyPreset(kind) {
      const rows = state.grid.length;
      const cols = state.grid[0]?.length ?? 0;
      if (kind === "all") {
        state.grid = createGrid(rows, cols, 1);
      } else if (kind === "clear") {
        state.grid = createGrid(rows, cols, 0);
      } else {
        state.grid = cloneGrid(sampleGrid);
        updateGridDimensionInputs();
      }
      renderGrid();
      updatePayloadPreview();
    }

    function applyRuntimePreset(kind) {
      const defaultNeighborhoodRows = Math.max(1, Math.ceil(state.grid.length / 2));
      const defaultNeighborhoodCols = Math.max(1, Math.ceil((state.grid[0]?.length ?? 1) / 2));

      if (kind === "heavy-greedy") {
        state.greedy = {
          ...state.greedy,
          localSearch: true,
          restarts: 20,
          serviceRefineIterations: 4,
          serviceRefineCandidateLimit: 60,
          exhaustiveServiceSearch: true,
          serviceExactPoolLimit: 22,
          serviceExactMaxCombinations: 12000,
        };
        elements.runtimePresetStatus.textContent =
          'Applied "Heavy Greedy": standalone heuristic settings with deeper service refinement and exact service search.';
      } else if (kind === "lns-improve") {
        state.lns = {
          ...state.lns,
          iterations: 16,
          maxNoImprovementIterations: 4,
          neighborhoodRows: defaultNeighborhoodRows,
          neighborhoodCols: defaultNeighborhoodCols,
          repairTimeLimitSeconds: 5,
          useDisplayedSeed: true,
        };
        elements.runtimePresetStatus.textContent =
          'Applied "LNS Improve": use the displayed layout as the seed and spend the budget on neighborhood repair.';
      } else if (kind === "bounded-cp-sat") {
        state.cpSat = {
          ...state.cpSat,
          timeLimitSeconds: "30",
          noImprovementTimeoutSeconds: "10",
          numWorkers: 8,
          useDisplayedHint: true,
        };
        elements.runtimePresetStatus.textContent =
          'Applied "Bounded CP-SAT": 30s max runtime with a 10s no-improvement cutoff and displayed-layout hinting.';
      } else {
        return;
      }

      const optimizer =
        kind === "heavy-greedy" ? "greedy"
        : kind === "lns-improve" ? "lns"
        : "cp-sat";
      setOptimizer(optimizer);
      syncSolverFields();
      updateSummary();
      updatePayloadPreview();
      if (!state.isSolving) {
        setSolveState?.(`${elements.runtimePresetStatus.textContent}`);
      }
    }

    function syncSolverFields() {
      if (elements.autoWallClockLimitSeconds) {
        elements.autoWallClockLimitSeconds.value = state.auto?.wallClockLimitSeconds ?? "";
      }

      elements.greedyLocalSearch.checked = state.greedy.localSearch;
      elements.greedyRandomSeed.value = state.greedy.randomSeed === "" ? "" : String(state.greedy.randomSeed ?? "");
      elements.greedyRestarts.value = String(state.greedy.restarts);
      elements.greedyServiceRefineIterations.value = String(state.greedy.serviceRefineIterations);
      elements.greedyServiceRefineCandidateLimit.value = String(state.greedy.serviceRefineCandidateLimit);
      elements.greedyExhaustiveServiceSearch.checked = state.greedy.exhaustiveServiceSearch;
      elements.greedyServiceExactPoolLimit.value = String(state.greedy.serviceExactPoolLimit);
      elements.greedyServiceExactMaxCombinations.value = String(state.greedy.serviceExactMaxCombinations);

      elements.lnsIterations.value = String(state.lns.iterations);
      elements.lnsMaxNoImprovementIterations.value = String(state.lns.maxNoImprovementIterations);
      elements.lnsNeighborhoodRows.value = String(state.lns.neighborhoodRows);
      elements.lnsNeighborhoodCols.value = String(state.lns.neighborhoodCols);
      elements.lnsRepairTimeLimitSeconds.value = String(state.lns.repairTimeLimitSeconds);
      elements.lnsPythonExecutable.value = state.cpSat.pythonExecutable;
      elements.lnsUseDisplayedSeed.checked = Boolean(state.lns.useDisplayedSeed);

      elements.cpSatTimeLimitSeconds.value = state.cpSat.timeLimitSeconds;
      elements.cpSatNoImprovementTimeoutSeconds.value = state.cpSat.noImprovementTimeoutSeconds;
      elements.cpSatRandomSeed.value = state.cpSat.randomSeed === "" ? "" : String(state.cpSat.randomSeed ?? "");
      elements.cpSatNumWorkers.value = String(state.cpSat.numWorkers);
      elements.cpSatLogSearchProgress.checked = state.cpSat.logSearchProgress;
      elements.cpSatPythonExecutable.value = state.cpSat.pythonExecutable;
      elements.cpSatUseDisplayedHint.checked = Boolean(state.cpSat.useDisplayedHint);

      elements.maxServices.value = state.availableBuildings.services;
      elements.maxResidentials.value = state.availableBuildings.residentials;
    }

    function renderServiceTypes() {
      if (state.serviceTypes.length === 0) {
        elements.serviceList.innerHTML = `
          <div class="catalog-shell">
            <div class="catalog-empty">No service types yet. Add one to start the catalog.</div>
          </div>
        `;
        updateSummary();
        return;
      }

      const rows = state.serviceTypes.map((entry, index) => `
        <tr>
          <td class="catalog-index">${index + 1}</td>
          <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="serviceTypes" data-index="${index}" data-field="name" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.bonus)}" data-collection="serviceTypes" data-index="${index}" data-field="bonus" /></td>
          <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="serviceTypes" data-index="${index}" data-field="size" /></td>
          <td><input type="text" value="${escapeHtml(entry.effective)}" data-collection="serviceTypes" data-index="${index}" data-field="effective" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.avail ?? "1")}" data-collection="serviceTypes" data-index="${index}" data-field="avail" /></td>
          <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-service" data-index="${index}">Remove</button></td>
        </tr>
      `).join("");

      elements.serviceList.innerHTML = `
        <div class="catalog-shell">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Bonus</th>
                <th>Size</th>
                <th>Effective</th>
                <th>Avail</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      updateSummary();
    }

    function renderResidentialTypes() {
      if (state.residentialTypes.length === 0) {
        elements.residentialList.innerHTML = `
          <div class="catalog-shell">
            <div class="catalog-empty">No residential types yet. Add one to start the catalog.</div>
          </div>
        `;
        updateSummary();
        return;
      }

      const rows = state.residentialTypes.map((entry, index) => `
        <tr>
          <td class="catalog-index">${index + 1}</td>
          <td><input type="text" value="${escapeHtml(entry.name)}" data-collection="residentialTypes" data-index="${index}" data-field="name" /></td>
          <td><input type="text" value="${escapeHtml(entry.resident)}" data-collection="residentialTypes" data-index="${index}" data-field="resident" /></td>
          <td><input type="text" value="${escapeHtml(entry.size)}" data-collection="residentialTypes" data-index="${index}" data-field="size" /></td>
          <td><input type="number" min="0" step="1" value="${escapeHtml(entry.avail)}" data-collection="residentialTypes" data-index="${index}" data-field="avail" /></td>
          <td class="catalog-action-cell"><button type="button" class="button ghost compact" data-action="remove-residential" data-index="${index}">Remove</button></td>
        </tr>
      `).join("");

      elements.residentialList.innerHTML = `
        <div class="catalog-shell">
          <table class="catalog-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Resident</th>
                <th>Size</th>
                <th>Avail</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      updateSummary();
    }

    function importCatalogText() {
      try {
        const imported = parseCatalogImportText(elements.catalogImportText.value);
        if (imported.services) {
          state.serviceTypes = imported.services.map((entry) => ({ ...entry }));
          renderServiceTypes();
        }
        if (imported.residentials) {
          state.residentialTypes = imported.residentials.map((entry) => ({ ...entry }));
          renderResidentialTypes();
        }
        updatePayloadPreview();
        const importedParts = [
          imported.services ? `${imported.services.length} service rows` : "",
          imported.residentials ? `${imported.residentials.length} residential rows` : "",
        ].filter(Boolean);
        elements.catalogImportStatus.textContent = `Imported ${importedParts.join(" and ")}.`;
      } catch (error) {
        elements.catalogImportStatus.textContent = error instanceof Error ? error.message : "Failed to import pasted tables.";
      }
    }

    function updateSummary() {
      const rows = state.grid.length;
      const cols = state.grid[0]?.length ?? 0;
      elements.summaryGridSize.textContent = `${rows} x ${cols}`;
      elements.summaryAllowedCells.textContent = String(countAllowedCells());
      elements.summaryServiceTypes.textContent = String(state.serviceTypes.length);
      elements.summaryResidentialTypes.textContent = String(state.residentialTypes.length);
      elements.summaryOptimizer.textContent = getOptimizerLabel(state.optimizer);
    }

    function handleCatalogInput(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const collectionName = target.dataset.collection;
      const index = Number(target.dataset.index);
      const field = target.dataset.field;
      if (!collectionName || !field || !Number.isInteger(index)) return;
      if (!Array.isArray(state[collectionName]) || !state[collectionName][index]) return;
      state[collectionName][index][field] = target.type === "checkbox" ? target.checked : target.value;
      updateSummary();
      updatePayloadPreview();
    }

    function handleCatalogClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;

      if (button.dataset.action === "remove-service") {
        state.serviceTypes.splice(index, 1);
        renderServiceTypes();
      } else if (button.dataset.action === "remove-residential") {
        state.residentialTypes.splice(index, 1);
        renderResidentialTypes();
      } else {
        return;
      }

      updatePayloadPreview();
    }

    function initResizeHandling() {
      if (typeof ResizeObserver === "undefined") {
        globalObject.addEventListener("resize", refreshMatrixLayouts);
        return;
      }

      const observer = new ResizeObserver(() => {
        refreshMatrixLayouts();
      });

      if (elements.gridEditor.parentElement) observer.observe(elements.gridEditor.parentElement);
      if (elements.resultMapGrid.parentElement) observer.observe(elements.resultMapGrid.parentElement);
    }

    return Object.freeze({
      applyMatrixLayout,
      applyPaint,
      applyPreset,
      applyRuntimePreset,
      applySolveRequestToPlanner,
      countAllowedCells,
      handleCatalogClick,
      handleCatalogInput,
      importCatalogText,
      initResizeHandling,
      refreshMatrixLayouts,
      renderGrid,
      renderResidentialTypes,
      renderServiceTypes,
      resizeGrid,
      setOptimizer,
      setPaintMode,
      syncPlannerFromState,
      syncSolverFields,
      updateSummary,
      updateGridDimensionInputs,
    });
  }

  globalObject.CityBuilderWorkbench = Object.freeze({
    createPlannerWorkbenchController,
  });
})(window);
