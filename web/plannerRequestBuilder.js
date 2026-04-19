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

    function getCheckpointBuildErrorMessage(error) {
      if (error && typeof error === "object" && typeof error.message === "string") {
        return error.message;
      }
      return "The displayed output cannot be reused as a continuation checkpoint.";
    }

    function tryBuildCheckpoint(result, resultContext, elapsedMs) {
      if (!result?.solution || !resultContext?.grid || !resultContext?.params) {
        return {
          checkpoint: null,
          error: "missing",
        };
      }
      try {
        return {
          checkpoint: buildCpSatWarmStartCheckpoint(result, resultContext, elapsedMs),
          error: null,
        };
      } catch (error) {
        return {
          checkpoint: null,
          error: getCheckpointBuildErrorMessage(error),
        };
      }
    }

    function getSavedLayoutCheckpoint(entry) {
      if (entry?.result?.validation?.valid !== true) {
        return null;
      }
      if (entry?.continueCpSat) {
        return cloneJson(entry.continueCpSat);
      }
      return tryBuildCheckpoint(entry?.result, entry?.resultContext, getSavedLayoutElapsedMs(entry)).checkpoint;
    }

    function getDisplayedLayoutCheckpointState() {
      return tryBuildCheckpoint(state.result, state.resultContext, state.resultElapsedMs);
    }

    function getDisplayedLayoutCheckpoint() {
      return getDisplayedLayoutCheckpointState().checkpoint;
    }

    function getDisplayedLayoutCheckpointError() {
      return getDisplayedLayoutCheckpointState().error;
    }

    function getDisplayedLayoutSourceLabel() {
      const name = elements.layoutStorageName?.value?.trim();
      return name || "the displayed output";
    }

    function buildCurrentModelFingerprint(requestOptions) {
      const previewRequest = buildSolveRequest(requestOptions);
      return computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
    }

    function renderDisplayedLayoutContinuationStatus(options) {
      const {
        element,
        enabled,
        disabledMessage,
        missingMessage,
        activeOptimizer,
        defaultLabel,
        readyLabel,
        mismatchLabel,
        previewRequestOptions,
      } = options;
      if (!element) return;
      if (!enabled) {
        element.textContent = disabledMessage;
        return;
      }

      const { checkpoint, error } = getDisplayedLayoutCheckpointState();
      if (error) {
        element.textContent = error === "missing" ? missingMessage : error;
        return;
      }
      if (!checkpoint) {
        element.textContent = missingMessage;
        return;
      }

      const sourceLabel = getDisplayedLayoutSourceLabel();
      const population = Number(checkpoint.incumbent?.objective?.value ?? 0).toLocaleString();
      let message = `Using ${sourceLabel} as the default ${defaultLabel}. Best population ${population}.`;
      const optimizerUsesContinuation = state.optimizer === activeOptimizer || state.optimizer === "auto";

      try {
        const currentFingerprint = buildCurrentModelFingerprint(previewRequestOptions);
        if (!optimizerUsesContinuation) {
          message = `${sourceLabel} is ready as the default ${readyLabel}. Switch to ${activeOptimizer === "cp-sat" ? "CP-SAT" : "LNS"} to use it.`;
        } else if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
          message = `${sourceLabel} is displayed, but the current grid or building settings no longer match it for ${mismatchLabel}.`;
        }
      } catch {
        if (!optimizerUsesContinuation) {
          message = `${sourceLabel} is ready as the default ${readyLabel}. Switch to ${activeOptimizer === "cp-sat" ? "CP-SAT" : "LNS"} to use it.`;
        } else {
          message = `${sourceLabel} is displayed. Finish the current inputs to use it as a ${defaultLabel}.`;
        }
      }

      element.textContent = message;
    }

    function renderCpSatHintStatus() {
      renderDisplayedLayoutContinuationStatus({
        element: elements.cpSatHintStatus,
        enabled: state.cpSat.useDisplayedHint,
        disabledMessage: "Default CP-SAT hinting from the displayed output is turned off.",
        missingMessage: "No displayed output is available to use as a CP-SAT hint.",
        activeOptimizer: "cp-sat",
        defaultLabel: "CP-SAT hint",
        readyLabel: "CP-SAT hint",
        mismatchLabel: "CP-SAT hinting",
        previewRequestOptions: { hintMismatch: "ignore", includeWarmStartHint: false },
      });
    }

    function renderLnsSeedStatus() {
      renderDisplayedLayoutContinuationStatus({
        element: elements.lnsSeedStatus,
        enabled: state.lns.useDisplayedSeed,
        disabledMessage: "Default LNS seeding from the displayed output is turned off.",
        missingMessage: "No displayed output is available to use as an LNS seed.",
        activeOptimizer: "lns",
        defaultLabel: "LNS seed",
        readyLabel: "LNS seed",
        mismatchLabel: "LNS seeding",
        previewRequestOptions: {
          hintMismatch: "ignore",
          includeWarmStartHint: false,
          includeLnsSeed: false,
        },
      });
    }

    function buildDisplayedLayoutContinuationBasePayload(grid, params, options) {
      const {
        optimizer,
        enabled,
        hintMismatch,
        mismatchMessage,
      } = options;
      if ((params.optimizer !== optimizer && params.optimizer !== "auto") || !enabled) return undefined;

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) return undefined;
      const sourceLabel = getDisplayedLayoutSourceLabel();
      const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
      if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
        if (hintMismatch === "error") {
          throw new Error(`${sourceLabel} no longer matches the current grid or building settings. ${mismatchMessage}`);
        }
        return undefined;
      }

      return {
        checkpoint,
        sourceLabel,
        payload: {
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
        },
      };
    }

    function buildCpSatWarmStartHintPayload(grid, params, hintMismatch = "error") {
      const continuation = buildDisplayedLayoutContinuationBasePayload(grid, params, {
        optimizer: "cp-sat",
        enabled: state.cpSat.useDisplayedHint,
        hintMismatch,
        mismatchMessage: "Turn off default hinting or restore matching inputs first.",
      });
      return continuation?.payload;
    }

    function buildLnsSeedPayload(grid, params, hintMismatch = "error") {
      const continuation = buildDisplayedLayoutContinuationBasePayload(grid, params, {
        optimizer: "lns",
        enabled: state.lns.useDisplayedSeed,
        hintMismatch,
        mismatchMessage: "Turn off default seeding or restore matching inputs first.",
      });
      if (!continuation) return undefined;

      return {
        ...continuation.payload,
        solution: cloneJson(continuation.checkpoint.hint.solution),
      };
    }

    function buildGreedyPayload(optimizer) {
      const randomSeed = readOptionalInteger(state.greedy.randomSeed, 0);
      const payload = {
        localSearch: Boolean(state.greedy.localSearch),
        ...(randomSeed !== undefined ? { randomSeed } : {}),
        restarts: clampInteger(state.greedy.restarts, optimizer === "auto" ? 4 : 1, 1),
        serviceRefineIterations: clampInteger(state.greedy.serviceRefineIterations, optimizer === "auto" ? 1 : 0, 0),
        serviceRefineCandidateLimit: clampInteger(state.greedy.serviceRefineCandidateLimit, optimizer === "auto" ? 24 : 1, 1),
        exhaustiveServiceSearch: optimizer === "auto" ? false : Boolean(state.greedy.exhaustiveServiceSearch),
        serviceExactPoolLimit: clampInteger(state.greedy.serviceExactPoolLimit, optimizer === "auto" ? 8 : 1, 1),
        serviceExactMaxCombinations: clampInteger(state.greedy.serviceExactMaxCombinations, optimizer === "auto" ? 512 : 1, 1),
      };

      if (optimizer !== "auto") {
        return payload;
      }

      return {
        ...payload,
        restarts: Math.min(payload.restarts, 4),
        serviceRefineIterations: Math.min(payload.serviceRefineIterations, 1),
        serviceRefineCandidateLimit: Math.min(payload.serviceRefineCandidateLimit, 24),
        serviceExactPoolLimit: Math.min(payload.serviceExactPoolLimit, 8),
        serviceExactMaxCombinations: Math.min(payload.serviceExactMaxCombinations, 512),
      };
    }

    function buildSolveRequest(options = {}) {
      const { hintMismatch = "error", includeWarmStartHint = true, includeLnsSeed = true } = options;
      const autoWallClockLimitSeconds = readOptionalInteger(state.auto?.wallClockLimitSeconds ?? "", 1);
      const timeLimitSeconds = readOptionalInteger(state.cpSat.timeLimitSeconds, 1);
      const noImprovementTimeoutSeconds = readOptionalInteger(state.cpSat.noImprovementTimeoutSeconds, 1);
      const cpSatRandomSeed = readOptionalInteger(state.cpSat.randomSeed, 0);
      const defaultNeighborhoodRows = Math.max(1, Math.ceil(state.grid.length / 2));
      const defaultNeighborhoodCols = Math.max(1, Math.ceil((state.grid[0]?.length ?? 1) / 2));
      const grid = cloneGrid(state.grid);
      const params = {
        optimizer: state.optimizer,
        serviceTypes: state.serviceTypes.map((entry, index) => parseServiceCatalogEntry(entry, index)),
        residentialTypes: state.residentialTypes.map((entry, index) => parseResidentialCatalogEntry(entry, index)),
        greedy: buildGreedyPayload(state.optimizer),
        cpSat: {
          numWorkers: clampInteger(state.cpSat.numWorkers, 8, 1),
          logSearchProgress: Boolean(state.cpSat.logSearchProgress),
          useDisplayedHint: Boolean(state.cpSat.useDisplayedHint),
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
          useDisplayedSeed: Boolean(state.lns.useDisplayedSeed),
        },
        ...(autoWallClockLimitSeconds !== undefined
          ? {
              auto: {
                wallClockLimitSeconds: autoWallClockLimitSeconds,
              },
            }
          : {}),
      };

      const maxServices = readOptionalInteger(state.availableBuildings.services, 1);
      const maxResidentials = readOptionalInteger(state.availableBuildings.residentials, 1);
      if (maxServices !== undefined || maxResidentials !== undefined) {
        params.availableBuildings = {};
        if (maxServices !== undefined) params.availableBuildings.services = maxServices;
        if (maxResidentials !== undefined) params.availableBuildings.residentials = maxResidentials;
      }

      if (includeWarmStartHint && (params.optimizer === "cp-sat" || params.optimizer === "auto")) {
        const warmStartHint = buildCpSatWarmStartHintPayload(grid, params, hintMismatch);
        if (warmStartHint) {
          params.cpSat.warmStartHint = warmStartHint;
        }
      }

      if (includeLnsSeed && (params.optimizer === "lns" || params.optimizer === "auto")) {
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
