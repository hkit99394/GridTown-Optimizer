/**
 * @param {Window & { CityBuilderRequestBuilder?: unknown, CityBuilderShared?: { CP_SAT_PORTFOLIO_CAPABILITY_LIMITS?: Record<string, number>, buildCpSatContinuationPayload?: (checkpoint: Record<string, any>, options?: Record<string, any>) => Record<string, any> }, crypto?: Crypto }} globalObject
 */
(function attachPlannerRequestBuilder(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {"auto" | "greedy" | "cp-sat" | "lns"} OptimizerName
   */

  /**
   * @typedef {object} RequestBuilderState
   * @property {OptimizerName | string} optimizer
   * @property {number[][]} grid
   * @property {JsonObject[]} serviceTypes
   * @property {JsonObject[]} residentialTypes
   * @property {JsonObject} availableBuildings
   * @property {JsonObject} greedy
   * @property {JsonObject} cpSat
   * @property {JsonObject} lns
   * @property {JsonObject | null | undefined} auto
   * @property {JsonObject | null | undefined} result
   * @property {JsonObject | null | undefined} resultContext
   * @property {number} resultElapsedMs
   */

  /**
   * @typedef {object} RequestBuilderHelpers
   * @property {(request: JsonObject) => JsonObject} buildCpSatContinuationModelInput
   * @property {(checkpoint: JsonObject, options?: JsonObject) => JsonObject} [buildCpSatContinuationPayload]
   * @property {(result: JsonObject, resultContext: JsonObject, elapsedMs: number) => JsonObject} buildCpSatWarmStartCheckpoint
   * @property {(value: any, fallback: number, min?: number) => number} clampInteger
   * @property {(grid: number[][]) => number[][]} cloneGrid
   * @property {<T>(value: T) => T} cloneJson
   * @property {(modelInput: JsonObject) => string} computeCpSatModelFingerprint
   * @property {(entry: JsonObject) => number} getSavedLayoutElapsedMs
   * @property {(value: any, min?: number) => number | undefined} readOptionalInteger
   * @property {(entry: JsonObject, index: number) => JsonObject} parseResidentialCatalogEntry
   * @property {(entry: JsonObject, index: number) => JsonObject} parseServiceCatalogEntry
   */

  /**
   * @typedef {object} RequestBuilderOptions
   * @property {RequestBuilderState} state
   * @property {JsonObject} elements
   * @property {RequestBuilderHelpers} helpers
   */

  /**
   * @typedef {object} ContinuationStatusOptions
   * @property {{ textContent: string } | null | undefined} element
   * @property {boolean} enabled
   * @property {string} disabledMessage
   * @property {string} missingMessage
   * @property {OptimizerName} activeOptimizer
   * @property {string} defaultLabel
   * @property {string} readyLabel
   * @property {string} mismatchLabel
   * @property {SolveRequestOptions} previewRequestOptions
   */

  /**
   * @typedef {object} ContinuationPayloadOptions
   * @property {OptimizerName} optimizer
   * @property {boolean} enabled
   * @property {"error" | "ignore"} hintMismatch
   * @property {string} mismatchMessage
   */

  /**
   * @typedef {object} SolveRequestOptions
   * @property {"error" | "ignore"} [hintMismatch]
   * @property {boolean} [includeWarmStartHint]
   * @property {boolean} [includeLnsSeed]
   */

  const requestBuilderGlobal =
    /** @type {Window & { CityBuilderRequestBuilder?: unknown, CityBuilderShared?: { CP_SAT_PORTFOLIO_CAPABILITY_LIMITS?: Record<string, number>, buildCpSatContinuationPayload?: (checkpoint: JsonObject, options?: JsonObject) => JsonObject }, crypto?: Crypto }} */ (
      globalObject
    );

  const CP_SAT_PORTFOLIO_CAPABILITY_LIMITS =
    requestBuilderGlobal.CityBuilderShared?.CP_SAT_PORTFOLIO_CAPABILITY_LIMITS ??
    Object.freeze({
      defaultWorkers: 3,
      defaultPerWorkerTimeLimitSeconds: 30,
      maxWorkers: 8,
      maxTotalWorkerThreads: 8,
      maxPerWorkerThreads: 4,
      maxTotalCpuBudgetSeconds: 8 * 60 * 60
    });
  const CP_SAT_PORTFOLIO_DEFAULT_WORKERS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.defaultWorkers;
  const CP_SAT_RANDOM_SEED_MAX = 0x7fffffff;
  const CP_SAT_PORTFOLIO_MAX_WORKERS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxWorkers;
  const CP_SAT_PORTFOLIO_MAX_TOTAL_WORKER_THREADS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalWorkerThreads;
  const CP_SAT_PORTFOLIO_MAX_PER_WORKER_THREADS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxPerWorkerThreads;
  const CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS = CP_SAT_PORTFOLIO_CAPABILITY_LIMITS.maxTotalCpuBudgetSeconds;

  /**
   * @param {RequestBuilderOptions} options
   */
  function createPlannerRequestBuilderController(options) {
    const { state, elements, helpers } = options;
    const {
      buildCpSatContinuationModelInput,
      buildCpSatContinuationPayload: helperBuildCpSatContinuationPayload,
      buildCpSatWarmStartCheckpoint,
      clampInteger,
      cloneGrid,
      cloneJson,
      computeCpSatModelFingerprint,
      getSavedLayoutElapsedMs,
      readOptionalInteger,
      parseResidentialCatalogEntry,
      parseServiceCatalogEntry
    } = helpers;
    const maybeBuildCpSatContinuationPayload =
      helperBuildCpSatContinuationPayload ?? requestBuilderGlobal.CityBuilderShared?.buildCpSatContinuationPayload;
    if (typeof maybeBuildCpSatContinuationPayload !== "function") {
      throw new Error("CityBuilderShared.buildCpSatContinuationPayload must load before plannerRequestBuilder.js.");
    }
    const buildCpSatContinuationPayload = maybeBuildCpSatContinuationPayload;

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

    /**
     * @param {unknown} error
     * @returns {string}
     */
    function getCheckpointBuildErrorMessage(error) {
      if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return /** @type {{ message: string }} */ (error).message;
      }
      return "The displayed output cannot be reused as a continuation checkpoint.";
    }

    /**
     * @param {JsonObject | null | undefined} result
     * @param {JsonObject | null | undefined} resultContext
     * @param {number} elapsedMs
     * @returns {{ checkpoint: JsonObject | null, error: string | null }}
     */
    function tryBuildCheckpoint(result, resultContext, elapsedMs) {
      if (!result?.solution || !resultContext?.grid || !resultContext?.params) {
        return {
          checkpoint: null,
          error: "missing"
        };
      }
      try {
        return {
          checkpoint: buildCpSatWarmStartCheckpoint(result, resultContext, elapsedMs),
          error: null
        };
      } catch (error) {
        return {
          checkpoint: null,
          error: getCheckpointBuildErrorMessage(error)
        };
      }
    }

    /**
     * @param {JsonObject | null | undefined} entry
     * @returns {JsonObject | null}
     */
    function getSavedLayoutCheckpoint(entry) {
      if (entry?.result?.validation?.valid !== true) {
        return null;
      }
      const rebuiltCheckpoint = tryBuildCheckpoint(
        entry?.result,
        entry?.resultContext,
        getSavedLayoutElapsedMs(entry)
      ).checkpoint;
      if (!rebuiltCheckpoint) return null;
      if (
        entry?.continueCpSat?.kind === "city-builder.cp-sat-checkpoint" &&
        entry.continueCpSat.version === 1 &&
        entry.continueCpSat.compatibility?.modelFingerprint === rebuiltCheckpoint.compatibility?.modelFingerprint &&
        entry.continueCpSat.compatibility?.candidateUniverseHash ===
          rebuiltCheckpoint.compatibility?.candidateUniverseHash
      ) {
        return cloneJson(entry.continueCpSat);
      }
      return rebuiltCheckpoint;
    }

    function getDisplayedLayoutCheckpointState() {
      return tryBuildCheckpoint(state.result, state.resultContext, state.resultElapsedMs);
    }

    function getDisplayedLayoutCheckpoint() {
      return getDisplayedLayoutCheckpointState().checkpoint;
    }

    function getDisplayedLayoutSourceLabel() {
      const name = elements.layoutStorageName?.value?.trim();
      return name || "the displayed output";
    }

    /**
     * @param {SolveRequestOptions} requestOptions
     * @returns {string}
     */
    function buildCurrentModelFingerprint(requestOptions) {
      const previewRequest = buildSolveRequest(requestOptions);
      return computeCpSatModelFingerprint(buildCpSatContinuationModelInput(previewRequest));
    }

    /**
     * @param {ContinuationStatusOptions} options
     */
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
        previewRequestOptions
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
        previewRequestOptions: { hintMismatch: "ignore", includeWarmStartHint: false }
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
          includeLnsSeed: false
        }
      });
    }

    /**
     * @param {number[][]} grid
     * @param {JsonObject} params
     * @param {ContinuationPayloadOptions} options
     * @returns {{ checkpoint: JsonObject, sourceLabel: string } | undefined}
     */
    function getDisplayedLayoutContinuationSource(grid, params, options) {
      const { optimizer, enabled, hintMismatch, mismatchMessage } = options;
      if ((params.optimizer !== optimizer && params.optimizer !== "auto") || !enabled) return undefined;

      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint) return undefined;
      const sourceLabel = getDisplayedLayoutSourceLabel();
      const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput({ grid, params }));
      if (currentFingerprint !== checkpoint.compatibility.modelFingerprint) {
        if (hintMismatch === "error" && params.optimizer !== "auto") {
          throw new Error(`${sourceLabel} no longer matches the current grid or building settings. ${mismatchMessage}`);
        }
        return undefined;
      }

      return {
        checkpoint,
        sourceLabel
      };
    }

    /**
     * @param {number[][]} grid
     * @param {JsonObject} params
     * @param {"error" | "ignore"} [hintMismatch]
     * @returns {JsonObject | undefined}
     */
    function buildCpSatWarmStartHintPayload(grid, params, hintMismatch = "error") {
      const continuation = getDisplayedLayoutContinuationSource(grid, params, {
        optimizer: "cp-sat",
        enabled: state.cpSat.useDisplayedHint,
        hintMismatch,
        mismatchMessage: "Turn off default hinting or restore matching inputs first."
      });
      if (!continuation) return undefined;
      return buildCpSatContinuationPayload(continuation.checkpoint, {
        sourceName: continuation.sourceLabel,
        hintConflictLimit: 20
      });
    }

    /**
     * @param {number[][]} grid
     * @param {JsonObject} params
     * @param {"error" | "ignore"} [hintMismatch]
     * @returns {JsonObject | undefined}
     */
    function buildLnsSeedPayload(grid, params, hintMismatch = "error") {
      const continuation = getDisplayedLayoutContinuationSource(grid, params, {
        optimizer: "lns",
        enabled: state.lns.useDisplayedSeed,
        hintMismatch,
        mismatchMessage: "Turn off default seeding or restore matching inputs first."
      });
      if (!continuation) return undefined;

      return buildCpSatContinuationPayload(continuation.checkpoint, {
        sourceName: continuation.sourceLabel,
        hintConflictLimit: 20,
        includeSolution: true
      });
    }

    /**
     * @param {any} value
     * @param {number} [min]
     * @returns {number | undefined}
     */
    function readOptionalFiniteNumber(value, min = 0) {
      if (value === "" || value == null) return undefined;
      const number = Number(value);
      if (!Number.isFinite(number)) return undefined;
      return Math.max(min, number);
    }

    /**
     * @param {any} value
     * @param {number} min
     * @param {number} max
     * @returns {number | undefined}
     */
    function clampOptionalFiniteNumber(value, min, max) {
      const number = readOptionalFiniteNumber(value, min);
      return number === undefined ? undefined : Math.min(max, number);
    }

    /**
     * @param {OptimizerName} optimizer
     * @returns {JsonObject}
     */
    function buildGreedyPayload(optimizer) {
      const randomSeed = optimizer === "auto" ? undefined : readOptionalInteger(state.greedy.randomSeed, 0);
      const timeLimitSeconds =
        optimizer === "greedy" ? readOptionalInteger(state.greedy.timeLimitSeconds, 1) : undefined;
      const densityTieBreaker = optimizer === "greedy" && Boolean(state.greedy.densityTieBreaker);
      const densityTieBreakerTolerancePercent = densityTieBreaker
        ? clampOptionalFiniteNumber(state.greedy.densityTieBreakerTolerancePercent, 0, 100)
        : undefined;
      const payload = {
        localSearch: Boolean(state.greedy.localSearch),
        ...(randomSeed !== undefined ? { randomSeed } : {}),
        ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
        profile: optimizer === "greedy" && Boolean(state.greedy.profile),
        densityTieBreaker,
        ...(densityTieBreakerTolerancePercent !== undefined ? { densityTieBreakerTolerancePercent } : {}),
        restarts: clampInteger(state.greedy.restarts, optimizer === "auto" ? 4 : 1, 1),
        serviceRefineIterations: clampInteger(state.greedy.serviceRefineIterations, optimizer === "auto" ? 1 : 0, 0),
        serviceRefineCandidateLimit: clampInteger(
          state.greedy.serviceRefineCandidateLimit,
          optimizer === "auto" ? 24 : 1,
          1
        ),
        exhaustiveServiceSearch: optimizer === "auto" ? false : Boolean(state.greedy.exhaustiveServiceSearch),
        diagnostics: optimizer === "greedy" && Boolean(state.greedy.diagnostics),
        serviceExactPoolLimit: clampInteger(state.greedy.serviceExactPoolLimit, optimizer === "auto" ? 8 : 1, 1),
        serviceExactMaxCombinations: clampInteger(
          state.greedy.serviceExactMaxCombinations,
          optimizer === "auto" ? 512 : 1,
          1
        )
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
        serviceExactMaxCombinations: Math.min(payload.serviceExactMaxCombinations, 512)
      };
    }

    /**
     * @param {any} optimizer
     * @returns {OptimizerName}
     */
    function normalizeRequestOptimizer(optimizer) {
      return optimizer === "auto" || optimizer === "greedy" || optimizer === "cp-sat" || optimizer === "lns"
        ? optimizer
        : "auto";
    }

    /**
     * @param {any} value
     * @returns {number[] | undefined}
     */
    function parseCpSatPortfolioRandomSeeds(value) {
      const seedText = String(value ?? "").trim();
      if (!seedText) return undefined;

      const tokens = seedText.split(/[\s,;]+/).filter(Boolean);
      if (tokens.length > CP_SAT_PORTFOLIO_MAX_WORKERS) {
        throw new Error(`CP-SAT portfolio supports at most ${CP_SAT_PORTFOLIO_MAX_WORKERS} explicit seeds.`);
      }

      const seeds = tokens.map((token, index) => {
        if (!/^\d+$/.test(token)) {
          throw new Error(`CP-SAT portfolio seed ${index + 1} must be an integer >= 0.`);
        }
        const seed = Number(token);
        if (!Number.isSafeInteger(seed) || seed > CP_SAT_RANDOM_SEED_MAX) {
          throw new Error(`CP-SAT portfolio seed ${index + 1} is too large.`);
        }
        return seed;
      });
      if (new Set(seeds).size !== seeds.length) {
        throw new Error("CP-SAT portfolio explicit seeds must be unique.");
      }
      return seeds;
    }

    /**
     * @param {OptimizerName} optimizer
     * @param {number | undefined} outerTimeLimitSeconds
     * @returns {JsonObject | undefined}
     */
    function buildCpSatPortfolioPayload(optimizer, outerTimeLimitSeconds) {
      const portfolio = state.cpSat.portfolio ?? {};
      if (optimizer !== "cp-sat" || !portfolio.enabled) return undefined;

      const randomSeeds = parseCpSatPortfolioRandomSeeds(portfolio.randomSeeds);
      const workerCount = Math.min(
        randomSeeds?.length ?? clampInteger(portfolio.workerCount, CP_SAT_PORTFOLIO_DEFAULT_WORKERS, 1),
        CP_SAT_PORTFOLIO_MAX_WORKERS
      );
      const maxPerWorkerThreads = Math.max(
        1,
        Math.min(
          CP_SAT_PORTFOLIO_MAX_PER_WORKER_THREADS,
          Math.floor(CP_SAT_PORTFOLIO_MAX_TOTAL_WORKER_THREADS / workerCount)
        )
      );
      const perWorkerNumWorkers = Math.min(clampInteger(portfolio.perWorkerNumWorkers, 1, 1), maxPerWorkerThreads);
      const requestedPerWorkerTimeLimitSeconds =
        readOptionalInteger(portfolio.perWorkerTimeLimitSeconds, 1) ?? outerTimeLimitSeconds;
      const maxPerWorkerTimeLimitSeconds = Math.max(
        1,
        Math.floor(CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS / (workerCount * perWorkerNumWorkers))
      );
      const perWorkerTimeLimitSeconds =
        requestedPerWorkerTimeLimitSeconds === undefined
          ? undefined
          : Math.min(requestedPerWorkerTimeLimitSeconds, maxPerWorkerTimeLimitSeconds);

      return {
        workerCount,
        ...(randomSeeds ? { randomSeeds } : {}),
        ...(perWorkerTimeLimitSeconds !== undefined
          ? {
              totalCpuBudgetSeconds: CP_SAT_PORTFOLIO_MAX_TOTAL_CPU_SECONDS,
              perWorkerTimeLimitSeconds
            }
          : {}),
        perWorkerNumWorkers,
        randomizeSearch: portfolio.randomizeSearch !== false
      };
    }

    /**
     * @param {SolveRequestOptions} [options]
     * @returns {{ grid: number[][], params: JsonObject }}
     */
    function buildSolveRequest(options = {}) {
      const { hintMismatch = "error", includeWarmStartHint = true, includeLnsSeed = true } = options;
      const optimizer = normalizeRequestOptimizer(state.optimizer);
      const autoWallClockLimitSeconds = readOptionalInteger(state.auto?.wallClockLimitSeconds ?? "", 1);
      const autoContinueAfterPopulationCapSeconds = readOptionalInteger(
        state.auto?.continueAfterPopulationCapSeconds ?? "",
        0
      );
      const timeLimitSeconds = readOptionalInteger(state.cpSat.timeLimitSeconds, 1);
      const noImprovementTimeoutSeconds = readOptionalInteger(state.cpSat.noImprovementTimeoutSeconds, 1);
      const cpSatRandomSeed = readOptionalInteger(state.cpSat.randomSeed, 0);
      const defaultNeighborhoodRows = Math.max(1, Math.ceil(state.grid.length / 2));
      const defaultNeighborhoodCols = Math.max(1, Math.ceil((state.grid[0]?.length ?? 1) / 2));
      const grid = cloneGrid(state.grid);
      /** @type {JsonObject} */
      const params = {
        optimizer,
        serviceTypes: state.serviceTypes.map((entry, index) => parseServiceCatalogEntry(entry, index)),
        residentialTypes: state.residentialTypes.map((entry, index) => parseResidentialCatalogEntry(entry, index)),
        ...(autoWallClockLimitSeconds !== undefined || autoContinueAfterPopulationCapSeconds !== undefined
          ? {
              auto: {
                ...(autoWallClockLimitSeconds !== undefined
                  ? { wallClockLimitSeconds: autoWallClockLimitSeconds }
                  : {}),
                ...(autoContinueAfterPopulationCapSeconds !== undefined
                  ? { continueAfterPopulationCapSeconds: autoContinueAfterPopulationCapSeconds }
                  : {})
              }
            }
          : {})
      };
      if (optimizer !== "auto") {
        params.greedy = buildGreedyPayload(optimizer);
        params.cpSat = {
          numWorkers: clampInteger(state.cpSat.numWorkers, 8, 1),
          logSearchProgress: Boolean(state.cpSat.logSearchProgress),
          ...(cpSatRandomSeed !== undefined ? { randomSeed: cpSatRandomSeed } : {}),
          ...(timeLimitSeconds !== undefined ? { timeLimitSeconds } : {}),
          ...(noImprovementTimeoutSeconds !== undefined ? { noImprovementTimeoutSeconds } : {})
        };
        params.lns = {
          iterations: clampInteger(state.lns.iterations, 12, 1),
          maxNoImprovementIterations: clampInteger(state.lns.maxNoImprovementIterations, 4, 1),
          neighborhoodRows: clampInteger(state.lns.neighborhoodRows, defaultNeighborhoodRows, 1),
          neighborhoodCols: clampInteger(state.lns.neighborhoodCols, defaultNeighborhoodCols, 1),
          repairTimeLimitSeconds: clampInteger(state.lns.repairTimeLimitSeconds, 5, 1)
        };
      }
      const cpSatPortfolio = buildCpSatPortfolioPayload(optimizer, timeLimitSeconds);
      if (cpSatPortfolio) {
        params.cpSat.portfolio = cpSatPortfolio;
      }

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
          params.cpSat ??= {};
          params.cpSat.warmStartHint = warmStartHint;
        }
      }

      if (includeLnsSeed && (params.optimizer === "lns" || params.optimizer === "auto")) {
        const seedHint = buildLnsSeedPayload(grid, params, hintMismatch);
        if (seedHint) {
          params.lns ??= {};
          params.lns.seedHint = seedHint;
        }
      }

      return {
        grid,
        params
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
      updatePayloadPreview
    });
  }

  requestBuilderGlobal.CityBuilderRequestBuilder = Object.freeze({
    createPlannerRequestBuilderController
  });
})(window);
