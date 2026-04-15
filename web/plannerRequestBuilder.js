(function attachPlannerRequestBuilder(globalObject) {
  function createPlannerRequestBuilderController(options) {
    const {
      state,
      elements,
      helpers,
    } = options;
    const {
      buildCpSatContinuationModelInput,
      buildCpSatWarmStartCheckpoint,
      clampInteger,
      cloneGrid,
      cloneJson,
      computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs,
      readOptionalInteger,
      parseResidentialCatalogEntry,
      parseServiceCatalogEntry,
    } = helpers;

    function generateCpSatRandomSeed() {
      const cryptoObject = globalObject.crypto;
      if (cryptoObject?.getRandomValues) {
        const values = new Uint32Array(1);
        cryptoObject.getRandomValues(values);
        return Math.max(1, values[0] & 0x7fffffff);
      }
      return Math.max(1, Math.floor(Math.random() * 0x7fffffff));
    }

    function ensureCpSatRandomSeed() {
      const existingSeed = readOptionalInteger(state.cpSat.randomSeed, 0);
      if (existingSeed !== undefined) return existingSeed;
      const generatedSeed = generateCpSatRandomSeed();
      state.cpSat.randomSeed = String(generatedSeed);
      if (elements.cpSatRandomSeed) {
        elements.cpSatRandomSeed.value = String(generatedSeed);
      }
      updatePayloadPreview();
      return generatedSeed;
    }

    function getSavedLayoutCheckpoint(entry) {
      if (entry?.continueCpSat) {
        return cloneJson(entry.continueCpSat);
      }
      return buildCpSatWarmStartCheckpoint(entry?.result, entry?.resultContext, getSavedLayoutElapsedMs(entry));
    }

    function getDisplayedLayoutCheckpoint() {
      if (!state.result?.solution || !state.resultContext?.grid || !state.resultContext?.params) return null;
      try {
        return buildCpSatWarmStartCheckpoint(state.result, state.resultContext, state.resultElapsedMs);
      } catch {
        return null;
      }
    }

    function getDisplayedLayoutSourceLabel() {
      const name = elements.layoutStorageName?.value?.trim();
      return name || "the displayed output";
    }

    function renderCpSatHintStatus() {
      if (!elements.cpSatHintStatus) return;
      if (!state.cpSat.useDisplayedHint) {
        elements.cpSatHintStatus.textContent = "Default CP-SAT hinting from the displayed output is turned off.";
        return;
      }

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) {
        elements.cpSatHintStatus.textContent = "No displayed output is available to use as a CP-SAT hint.";
        return;
      }

      const sourceLabel = getDisplayedLayoutSourceLabel();
      const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
      let message = `Using ${sourceLabel} as the default CP-SAT hint. Best population ${population}.`;

      try {
        const previewRequest = buildSolveRequest({ hintMismatch: "ignore", includeWarmStartHint: false });
        const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
        if (state.optimizer !== "cp-sat") {
          message = `${sourceLabel} is ready as the default CP-SAT hint. Switch to CP-SAT to use it.`;
        } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
          message = `${sourceLabel} is displayed, but the current grid or building settings no longer match it for CP-SAT hinting.`;
        }
      } catch {
        if (state.optimizer !== "cp-sat") {
          message = `${sourceLabel} is ready as the default CP-SAT hint. Switch to CP-SAT to use it.`;
        } else {
          message = `${sourceLabel} is displayed. Finish the current inputs to use it as a CP-SAT hint.`;
        }
      }

      elements.cpSatHintStatus.textContent = message;
    }

    function renderLnsSeedStatus() {
      if (!elements.lnsSeedStatus) return;
      if (!state.lns.useDisplayedSeed) {
        elements.lnsSeedStatus.textContent = "Default LNS seeding from the displayed output is turned off.";
        return;
      }

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) {
        elements.lnsSeedStatus.textContent = "No displayed output is available to use as an LNS seed.";
        return;
      }

      const sourceLabel = getDisplayedLayoutSourceLabel();
      const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
      let message = `Using ${sourceLabel} as the default LNS seed. Best population ${population}.`;

      try {
        const previewRequest = buildSolveRequest({
          hintMismatch: "ignore",
          includeWarmStartHint: false,
          includeLnsSeed: false,
        });
        const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
        if (state.optimizer !== "lns") {
          message = `${sourceLabel} is ready as the default LNS seed. Switch to LNS to use it.`;
        } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
          message = `${sourceLabel} is displayed, but the current grid or building settings no longer match it for LNS seeding.`;
        }
      } catch {
        if (state.optimizer !== "lns") {
          message = `${sourceLabel} is ready as the default LNS seed. Switch to LNS to use it.`;
        } else {
          message = `${sourceLabel} is displayed. Finish the current inputs to use it as an LNS seed.`;
        }
      }

      elements.lnsSeedStatus.textContent = message;
    }

    function buildCpSatWarmStartHintPayload(grid, params, hintMismatch = "error") {
      if (params.optimizer !== "cp-sat" || !state.cpSat.useDisplayedHint) return undefined;

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) return undefined;
      const sourceLabel = getDisplayedLayoutSourceLabel();
      const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
      if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
        if (hintMismatch === "error") {
          throw new Error(
            `${sourceLabel} no longer matches the current grid or building settings. Turn off default hinting or restore matching inputs first.`
          );
        }
        return undefined;
      }

      return {
        sourceName: sourceLabel,
        modelFingerprint: checkpoint.compatibility.modelFingerprint,
        roadKeys: cloneJson(checkpoint.hint.roadKeys),
        serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
        residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
        objectiveLowerBound: checkpoint.resumePolicy.objectiveCutoff.value,
        preferStrictImprove: Boolean(checkpoint.resumePolicy.objectiveCutoff.preferStrictImprove),
        repairHint: Boolean(checkpoint.resumePolicy.repairHint),
        fixVariablesToHintedValue: Boolean(checkpoint.resumePolicy.fixVariablesToHintedValue),
        hintConflictLimit: 20,
      };
    }

    function buildLnsSeedPayload(grid, params, hintMismatch = "error") {
      if (params.optimizer !== "lns" || !state.lns.useDisplayedSeed) return undefined;

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) return undefined;
      const sourceLabel = getDisplayedLayoutSourceLabel();
      const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
      if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
        if (hintMismatch === "error") {
          throw new Error(
            `${sourceLabel} no longer matches the current grid or building settings. Turn off default seeding or restore matching inputs first.`
          );
        }
        return undefined;
      }

      return {
        sourceName: sourceLabel,
        modelFingerprint: checkpoint.compatibility.modelFingerprint,
        roadKeys: cloneJson(checkpoint.hint.roadKeys),
        serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
        residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
        solution: cloneJson(checkpoint.hint.solution),
        objectiveLowerBound: checkpoint.resumePolicy.objectiveCutoff.value,
        preferStrictImprove: Boolean(checkpoint.resumePolicy.objectiveCutoff.preferStrictImprove),
        repairHint: Boolean(checkpoint.resumePolicy.repairHint),
        fixVariablesToHintedValue: Boolean(checkpoint.resumePolicy.fixVariablesToHintedValue),
        hintConflictLimit: 20,
      };
    }

    function buildSolveRequest(options = {}) {
      const { hintMismatch = "error", includeWarmStartHint = true, includeLnsSeed = true } = options;
      const timeLimitSeconds = readOptionalInteger(state.cpSat.timeLimitSeconds, 1);
      const noImprovementTimeoutSeconds = readOptionalInteger(state.cpSat.noImprovementTimeoutSeconds, 1);
      const cpSatRandomSeed = readOptionalInteger(state.cpSat.randomSeed, 0);
      const greedyRandomSeed = readOptionalInteger(state.greedy.randomSeed, 0);
      const defaultNeighborhoodRows = Math.max(1, Math.ceil(state.grid.length / 2));
      const defaultNeighborhoodCols = Math.max(1, Math.ceil((state.grid[0]?.length ?? 1) / 2));
      const grid = cloneGrid(state.grid);
      const params = {
        optimizer: state.optimizer,
        serviceTypes: state.serviceTypes.map((entry, index) => parseServiceCatalogEntry(entry, index)),
        residentialTypes: state.residentialTypes.map((entry, index) => parseResidentialCatalogEntry(entry, index)),
        greedy: {
          localSearch: Boolean(state.greedy.localSearch),
          ...(greedyRandomSeed !== undefined ? { randomSeed: greedyRandomSeed } : {}),
          restarts: clampInteger(state.greedy.restarts, 1, 1),
          serviceRefineIterations: clampInteger(state.greedy.serviceRefineIterations, 0, 0),
          serviceRefineCandidateLimit: clampInteger(state.greedy.serviceRefineCandidateLimit, 1, 1),
          exhaustiveServiceSearch: Boolean(state.greedy.exhaustiveServiceSearch),
          serviceExactPoolLimit: clampInteger(state.greedy.serviceExactPoolLimit, 1, 1),
          serviceExactMaxCombinations: clampInteger(state.greedy.serviceExactMaxCombinations, 1, 1),
        },
        cpSat: {
          numWorkers: clampInteger(state.cpSat.numWorkers, 8, 1),
          logSearchProgress: Boolean(state.cpSat.logSearchProgress),
          ...(cpSatRandomSeed !== undefined ? { randomSeed: cpSatRandomSeed } : {}),
          ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
          ...(noImprovementTimeoutSeconds !== undefined ? { noImprovementTimeoutSeconds } : {}),
          ...(state.cpSat.pythonExecutable.trim() ? { pythonExecutable: state.cpSat.pythonExecutable.trim() } : {}),
        },
        lns: {
          iterations: clampInteger(state.lns.iterations, 12, 1),
          maxNoImprovementIterations: clampInteger(state.lns.maxNoImprovementIterations, 4, 1),
          neighborhoodRows: clampInteger(state.lns.neighborhoodRows, defaultNeighborhoodRows, 1),
          neighborhoodCols: clampInteger(state.lns.neighborhoodCols, defaultNeighborhoodCols, 1),
          repairTimeLimitSeconds: clampInteger(state.lns.repairTimeLimitSeconds, 5, 1),
        },
      };

      const maxServices = readOptionalInteger(state.availableBuildings.services, 1);
      const maxResidentials = readOptionalInteger(state.availableBuildings.residentials, 1);
      if (maxServices !== undefined || maxResidentials !== undefined) {
        params.availableBuildings = {};
        if (maxServices !== undefined) params.availableBuildings.services = maxServices;
        if (maxResidentials !== undefined) params.availableBuildings.residentials = maxResidentials;
      }

      if (includeWarmStartHint && params.optimizer === "cp-sat") {
        const warmStartHint = buildCpSatWarmStartHintPayload(grid, params, hintMismatch);
        if (warmStartHint) {
          params.cpSat.warmStartHint = warmStartHint;
        }
      }

      if (includeLnsSeed && params.optimizer === "lns") {
        const seedHint = buildLnsSeedPayload(grid, params, hintMismatch);
        if (seedHint) {
          params.lns.seedHint = seedHint;
        }
      }

      return {
        grid,
        params,
      };
    }

    function updatePayloadPreview() {
      try {
        elements.payloadPreview.textContent = JSON.stringify(buildSolveRequest({ hintMismatch: "ignore" }), null, 2);
      } catch (error) {
        elements.payloadPreview.textContent = `Payload not ready.\n${error instanceof Error ? error.message : "Unknown parsing error."}`;
      }
      renderCpSatHintStatus();
      renderLnsSeedStatus();
    }

    return Object.freeze({
      buildSolveRequest,
      ensureCpSatRandomSeed,
      getDisplayedLayoutCheckpoint,
      getDisplayedLayoutSourceLabel,
      getSavedLayoutCheckpoint,
      renderCpSatHintStatus,
      renderLnsSeedStatus,
      updatePayloadPreview,
    });
  }

  globalObject.CityBuilderRequestBuilder = Object.freeze({
    createPlannerRequestBuilderController,
  });
})(window);
