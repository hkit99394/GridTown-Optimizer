(function attachPlannerSolveRuntime(globalObject) {
  const AUTO_QUALITY_PATH_LABEL = "recommended quality path";
  const GREEDY_MODE_LABEL = "heavy standalone heuristic / advanced inspection mode";

  function normalizeProgressElapsedMs(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.round(numericValue));
  }

  function readAutoStage(payload) {
    return payload?.solution?.autoStage ?? payload?.stats?.autoStage ?? payload?.autoStage ?? null;
  }

  function readLnsTelemetry(payload) {
    return payload?.solution?.lnsTelemetry ?? payload?.stats?.lnsTelemetry ?? null;
  }

  function readLatestLnsOutcome(lnsTelemetry) {
    const outcomes = Array.isArray(lnsTelemetry?.outcomes) ? lnsTelemetry.outcomes : [];
    return outcomes.length ? outcomes[outcomes.length - 1] : null;
  }

  function finiteNumberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function buildPortfolioProgressSummary(portfolio) {
    const workers = Array.isArray(portfolio?.workers) ? portfolio.workers : [];
    if (!portfolio || workers.length === 0) return null;
    return {
      workerCount: portfolio.workerCount ?? workers.length,
      completedWorkers: workers.length,
      feasibleWorkers: workers.filter((worker) => worker.feasible).length,
      selectedWorkerIndex: portfolio.selectedWorkerIndex ?? null,
    };
  }

  function buildProgressSummary(payload, totalPopulation, elapsedMs) {
    if (payload?.stats?.progressSummary) return payload.stats.progressSummary;
    const telemetry = payload?.solution?.cpSatTelemetry ?? null;
    const autoStage = readAutoStage(payload);
    const lnsTelemetry = readLnsTelemetry(payload);
    const latestLnsOutcome = readLatestLnsOutcome(lnsTelemetry);
    const cpSatStatus = payload?.solution?.cpSatStatus ?? payload?.stats?.cpSatStatus ?? null;
    const currentScore =
      finiteNumberOrNull(latestLnsOutcome?.populationAfter)
      ?? finiteNumberOrNull(telemetry?.incumbentPopulation)
      ?? totalPopulation;
    const lnsSeedSource = lnsTelemetry?.seedSource ?? null;
    const reuseSource = lnsSeedSource === "greedy"
      ? "greedy-seed"
      : lnsSeedSource;
    return {
      currentScore,
      bestScore: totalPopulation,
      activeStage:
        payload?.stats?.activeOptimizer
        ?? payload?.solution?.activeOptimizer
        ?? autoStage?.activeStage
        ?? payload?.stats?.optimizer
        ?? payload?.solution?.optimizer
        ?? payload?.optimizer
        ?? null,
      reuseSource,
      elapsedTimeSeconds:
        finiteNumberOrNull(telemetry?.solveWallTimeSeconds)
        ?? Math.max(0, normalizeProgressElapsedMs(elapsedMs) / 1000),
      timeSinceImprovementSeconds: finiteNumberOrNull(telemetry?.secondsSinceLastImprovement),
      stopReason:
        autoStage?.stopReason
        ?? (lnsTelemetry?.stopReason && lnsTelemetry.stopReason !== "running" ? lnsTelemetry.stopReason : null)
        ?? null,
      exactGap: finiteNumberOrNull(telemetry?.populationGapUpperBound),
      portfolioWorkerSummary: buildPortfolioProgressSummary(payload?.solution?.cpSatPortfolio),
    };
  }

  function formatProgressMessageSuffix(summary) {
    if (!summary) return "";
    const parts = [];
    if (typeof summary.bestScore === "number") {
      parts.push(`best ${Number(summary.bestScore).toLocaleString()}`);
    }
    if (summary.activeStage) {
      parts.push(`stage ${summary.activeStage}`);
    }
    if (summary.reuseSource) {
      parts.push(`reuse ${summary.reuseSource}`);
    }
    if (typeof summary.exactGap === "number") {
      parts.push(`gap ${Number(summary.exactGap).toLocaleString()}`);
    }
    if (typeof summary.timeSinceImprovementSeconds === "number") {
      parts.push(`${summary.timeSinceImprovementSeconds.toFixed(1)}s since improvement`);
    }
    return parts.length ? ` ${parts.join("; ")}.` : "";
  }

  function buildLnsProgressNote(lnsTelemetry) {
    if (!lnsTelemetry) return null;
    const latestOutcome = readLatestLnsOutcome(lnsTelemetry);
    if (!latestOutcome) {
      return lnsTelemetry.stopReason === "running"
        ? `LNS seeded from ${lnsTelemetry.seedSource}.`
        : `LNS stopped: ${lnsTelemetry.stopReason}.`;
    }
    const improvement = latestOutcome.improvement > 0 ? ` +${latestOutcome.improvement}` : "";
    return `LNS ${latestOutcome.status}${improvement} in ${latestOutcome.phase} neighborhood ${Number(latestOutcome.iteration ?? 0) + 1}. Stop: ${lnsTelemetry.stopReason}.`;
  }

  function cloneProgressLogEntry(entry) {
    try {
      return JSON.parse(JSON.stringify(entry));
    } catch {
      return { ...entry };
    }
  }

  function buildSolveProgressLogEntry(payload, options = {}) {
    if (payload?.progressEntry && typeof payload.progressEntry === "object") {
      return cloneProgressLogEntry(payload.progressEntry);
    }

    if (!payload?.solution && typeof payload?.bestTotalPopulation !== "number") return null;

    const telemetry = payload?.solution?.cpSatTelemetry ?? null;
    const autoStage = readAutoStage(payload);
    const lnsTelemetry = readLnsTelemetry(payload);
    const latestLnsOutcome = readLatestLnsOutcome(lnsTelemetry);
    const lnsProgressFields = lnsTelemetry
      ? {
          lnsStopReason: lnsTelemetry.stopReason ?? null,
          lnsNeighborhoodStatus: latestLnsOutcome?.status ?? null,
          lnsNeighborhoodImprovement:
            typeof latestLnsOutcome?.improvement === "number" ? latestLnsOutcome.improvement : null,
          lnsNeighborhoodsCompleted:
            typeof lnsTelemetry?.iterationsCompleted === "number" ? lnsTelemetry.iterationsCompleted : null,
        }
      : {};
    const totalPopulation =
      typeof payload?.stats?.totalPopulation === "number"
        ? payload.stats.totalPopulation
        : typeof payload?.solution?.totalPopulation === "number"
          ? payload.solution.totalPopulation
          : typeof payload?.bestTotalPopulation === "number"
            ? payload.bestTotalPopulation
          : null;
    const progressSummary = buildProgressSummary(payload, totalPopulation, options.elapsedMs);

    return {
      capturedAt: typeof options.capturedAt === "string" && options.capturedAt.trim()
        ? options.capturedAt
        : new Date().toISOString(),
      elapsedMs: normalizeProgressElapsedMs(options.elapsedMs),
      source: options.source === "final-result" ? "final-result" : "live-snapshot",
      optimizer: payload?.stats?.optimizer ?? payload?.solution?.optimizer ?? payload?.optimizer ?? options.fallbackOptimizer ?? null,
      ...(
        (payload?.stats?.activeOptimizer ?? payload?.solution?.activeOptimizer ?? payload?.activeOptimizer)
          ? {
              activeOptimizer:
                payload?.stats?.activeOptimizer
                ?? payload?.solution?.activeOptimizer
                ?? payload?.activeOptimizer,
            }
          : {}
      ),
      ...(autoStage ? { autoStage } : {}),
      hasFeasibleSolution: true,
      totalPopulation,
      cpSatStatus: payload?.solution?.cpSatStatus ?? payload?.stats?.cpSatStatus ?? null,
      ...lnsProgressFields,
      progressSummary,
      bestPopulationUpperBound:
        typeof telemetry?.bestPopulationUpperBound === "number" ? telemetry.bestPopulationUpperBound : null,
      populationGapUpperBound:
        typeof telemetry?.populationGapUpperBound === "number" ? telemetry.populationGapUpperBound : null,
      solveWallTimeSeconds:
        typeof telemetry?.solveWallTimeSeconds === "number" ? telemetry.solveWallTimeSeconds : null,
      lastImprovementAtSeconds:
        typeof telemetry?.lastImprovementAtSeconds === "number" ? telemetry.lastImprovementAtSeconds : null,
      secondsSinceLastImprovement:
        typeof telemetry?.secondsSinceLastImprovement === "number" ? telemetry.secondsSinceLastImprovement : null,
      note: buildLnsProgressNote(lnsTelemetry),
    };
  }

  function appendSolveProgressLog(logEntries, payload, options = {}) {
    const entry = buildSolveProgressLogEntry(payload, options);
    if (!entry) return Array.isArray(logEntries) ? logEntries.slice() : [];
    const nextEntries = Array.isArray(logEntries) ? logEntries.slice() : [];
    const lastEntry = nextEntries[nextEntries.length - 1];

    if (
      lastEntry
      && lastEntry.elapsedMs === entry.elapsedMs
      && lastEntry.source === entry.source
      && lastEntry.optimizer === entry.optimizer
      && lastEntry.activeOptimizer === entry.activeOptimizer
      && lastEntry.hasFeasibleSolution === entry.hasFeasibleSolution
      && lastEntry.totalPopulation === entry.totalPopulation
      && lastEntry.cpSatStatus === entry.cpSatStatus
      && (lastEntry.lnsStopReason ?? null) === (entry.lnsStopReason ?? null)
      && (lastEntry.lnsNeighborhoodStatus ?? null) === (entry.lnsNeighborhoodStatus ?? null)
      && (lastEntry.lnsNeighborhoodImprovement ?? null) === (entry.lnsNeighborhoodImprovement ?? null)
      && (lastEntry.lnsNeighborhoodsCompleted ?? null) === (entry.lnsNeighborhoodsCompleted ?? null)
      && JSON.stringify(lastEntry.progressSummary ?? null) === JSON.stringify(entry.progressSummary ?? null)
      && lastEntry.bestPopulationUpperBound === entry.bestPopulationUpperBound
      && lastEntry.populationGapUpperBound === entry.populationGapUpperBound
      && lastEntry.solveWallTimeSeconds === entry.solveWallTimeSeconds
      && lastEntry.lastImprovementAtSeconds === entry.lastImprovementAtSeconds
      && lastEntry.secondsSinceLastImprovement === entry.secondsSinceLastImprovement
      && JSON.stringify(lastEntry.autoStage ?? null) === JSON.stringify(entry.autoStage ?? null)
    ) {
      nextEntries[nextEntries.length - 1] = entry;
      return nextEntries;
    }

    nextEntries.push(entry);
    return nextEntries;
  }

  function createSolveRuntime(options) {
    const {
      state,
      elements,
      constants,
      helpers,
      callbacks,
    } = options;
    const {
      LIVE_SNAPSHOT_REFRESH_INTERVAL_MS,
      SOLVE_STATUS_POLL_INTERVAL_MS,
    } = constants;
    const {
      createSolveRequestId,
      delay,
      formatElapsedTime,
      normalizeElapsedMs,
    } = helpers;
    const {
      buildSolveRequest,
      clearExpansionAdvice,
      ensureCpSatRandomSeed,
      getDisplayedLayoutCheckpoint,
      getOptimizerLabel,
      renderResults,
      setSolveState,
    } = callbacks;

    function setResultElapsed(ms, options = {}) {
      const { syncTimerWhenIdle = false } = options;
      state.resultElapsedMs = normalizeElapsedMs(ms);
      if (elements.resultElapsed) {
        elements.resultElapsed.textContent = formatElapsedTime(state.resultElapsedMs);
      }
      if (syncTimerWhenIdle && !state.isSolving) {
        clearSolveTimerTicker();
        state.solveTimerStartedAt = 0;
        state.solveTimerElapsedMs = state.resultElapsedMs;
        state.solveTimerFrozen = true;
        renderSolveTimer();
      }
    }

    function renderSolveTimer() {
      elements.solveTimer.textContent = `Elapsed ${formatElapsedTime(state.solveTimerElapsedMs)}`;
    }

    function clearSolveTimerTicker() {
      if (state.solveTimerHandle) {
        globalObject.clearInterval(state.solveTimerHandle);
        state.solveTimerHandle = 0;
      }
    }

    function syncSolveTimer() {
      if (!state.solveTimerStartedAt || state.solveTimerFrozen) {
        renderSolveTimer();
        return;
      }
      state.solveTimerElapsedMs = Date.now() - state.solveTimerStartedAt;
      renderSolveTimer();
    }

    function resetSolveTimer() {
      clearSolveTimerTicker();
      state.solveTimerStartedAt = 0;
      state.solveTimerElapsedMs = 0;
      state.solveTimerFrozen = true;
      renderSolveTimer();
    }

    function startSolveTimer() {
      clearSolveTimerTicker();
      state.solveTimerStartedAt = Date.now();
      state.solveTimerElapsedMs = 0;
      state.solveTimerFrozen = false;
      renderSolveTimer();
      state.solveTimerHandle = globalObject.setInterval(syncSolveTimer, 250);
    }

    function pauseSolveTimer() {
      if (!state.solveTimerStartedAt || state.solveTimerFrozen) {
        renderSolveTimer();
        return;
      }
      state.solveTimerElapsedMs = Date.now() - state.solveTimerStartedAt;
      state.solveTimerFrozen = true;
      clearSolveTimerTicker();
      renderSolveTimer();
    }

    function resumeSolveTimer() {
      if (!state.solveTimerStartedAt || !state.solveTimerFrozen) return;
      state.solveTimerStartedAt = Date.now() - state.solveTimerElapsedMs;
      state.solveTimerFrozen = false;
      renderSolveTimer();
      state.solveTimerHandle = globalObject.setInterval(syncSolveTimer, 250);
    }

    function clearManualEditState(options = {}) {
      const { resetMode = false } = options;
      state.layoutEditor.edited = false;
      state.layoutEditor.pendingValidation = false;
      state.layoutEditor.status = "";
      if (resetMode) {
        state.layoutEditor.mode = "inspect";
        state.layoutEditor.pendingPlacement = null;
      }
    }

    function buildSolveProgressMessage(payload) {
      const optimizer = payload.optimizer || state.optimizer;
      const optimizerLabel = getOptimizerLabel(optimizer);
      const autoStage = readAutoStage(payload);
      const lnsTelemetry = readLnsTelemetry(payload);
      const latestLnsOutcome = readLatestLnsOutcome(lnsTelemetry);
      const activeOptimizer = payload.activeOptimizer || payload.solution?.activeOptimizer || payload.stats?.activeOptimizer || null;
      const progressSuffix = formatProgressMessageSuffix(
        payload?.stats?.progressSummary
        ?? buildProgressSummary(
          payload,
          typeof payload.bestTotalPopulation === "number"
            ? payload.bestTotalPopulation
            : typeof payload?.stats?.totalPopulation === "number"
              ? payload.stats.totalPopulation
              : null,
          state.solveTimerElapsedMs
        )
      );
      const bestLabel =
        typeof payload.bestTotalPopulation === "number"
          ? ` Best so far: ${Number(payload.bestTotalPopulation).toLocaleString()}.`
          : "";

      if (state.isStopping) {
        if (payload.hasFeasibleSolution) {
          if (optimizer === "auto") {
            return `Stop requested. Finalizing Auto${activeOptimizer ? ` (${getOptimizerLabel(activeOptimizer)})` : ""}.${bestLabel}${progressSuffix}`;
          }
          return optimizer === "cp-sat"
            ? `Stop requested. Finalizing the best feasible ${optimizerLabel} result.${bestLabel}${progressSuffix}`
            : optimizer === "lns"
              ? `Stop requested. Finalizing the best ${optimizerLabel} result found after neighborhood repair.${bestLabel}${progressSuffix}`
              : `Stop requested. Finalizing the best ${optimizerLabel} result found so far.${bestLabel}${progressSuffix}`;
        }
        return `Stop requested. Waiting for ${optimizerLabel} to stop. No result has been found yet.`;
      }

      if (payload.hasFeasibleSolution) {
        if (optimizer === "auto") {
          const cycleLabel = autoStage?.cycleIndex > 0 ? `Cycle ${autoStage.cycleIndex}. ` : "";
          const weakCycleLabel =
            typeof autoStage?.consecutiveWeakCycles === "number"
              ? `Weak cycles: ${autoStage.consecutiveWeakCycles}. `
              : "";
          return `Running ${optimizerLabel} solver. ${cycleLabel}${activeOptimizer ? `${getOptimizerLabel(activeOptimizer)} stage is active. ` : ""}${weakCycleLabel}${bestLabel.trim()}${progressSuffix}`.trim();
        }
        return optimizer === "cp-sat"
          ? `Running ${optimizerLabel} solver. Feasible solution found and still improving.${bestLabel}${progressSuffix}`
          : optimizer === "lns"
            ? (
              latestLnsOutcome
                ? `Running ${optimizerLabel} solver. Last ${latestLnsOutcome.phase} repair was ${latestLnsOutcome.status}.${bestLabel}${progressSuffix}`
                : state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
                  ? `Running ${optimizerLabel} solver. Displayed seed is ready and neighborhood repairs are starting.${bestLabel}${progressSuffix}`
                  : `Running ${optimizerLabel} solver. Greedy seed is ready and neighborhood repairs are starting.${bestLabel}${progressSuffix}`
            )
            : `Running ${optimizerLabel} solver. ${GREEDY_MODE_LABEL} is still improving.${bestLabel}${progressSuffix}`;
      }

      if (optimizer === "cp-sat") {
        return `Running ${optimizerLabel} solver. Searching for the first feasible solution...`;
      }
      if (optimizer === "auto") {
        return "Running Auto solver. Starting the capped fast Greedy seed stage before LNS and bounded CP-SAT improve it...";
      }
      if (optimizer === "lns") {
        return state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
          ? `Running ${optimizerLabel} solver. Loading the displayed seed before neighborhood repair...`
          : `Running ${optimizerLabel} solver. Building the greedy seed before neighborhood repair...`;
      }
      return `Running ${optimizerLabel} solver. Running the heavy standalone heuristic search...`;
    }

    function applyRunningSnapshot(payload) {
      if (!payload?.solution || payload.jobStatus !== "running") return;
      clearExpansionAdvice();
      state.solveProgressLog = appendSolveProgressLog(state.solveProgressLog, payload, {
        elapsedMs: state.solveTimerElapsedMs,
        fallbackOptimizer: state.optimizer,
        source: "live-snapshot",
      });
      state.result = {
        ...payload,
        progressLog: state.solveProgressLog.slice(),
      };
      state.resultIsLiveSnapshot = true;
      state.resultError = "";
      clearManualEditState();
      setResultElapsed(state.solveTimerElapsedMs);
      renderResults();
    }

    async function requestStopSolve() {
      if (!state.isSolving || !state.activeSolveRequestId || state.isStopping) return;

      state.isStopping = true;
      pauseSolveTimer();
      setSolveState(`Stopping ${getOptimizerLabel(state.optimizer)} solver...`);

      try {
        const response = await fetch("/api/solve/cancel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ requestId: state.activeSolveRequestId }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Failed to send the stop request.");
        }
        setSolveState(
          payload.stopped
            ? (payload.message || `Stop requested. Finalizing the current ${getOptimizerLabel(state.optimizer)} run...`)
            : `The ${getOptimizerLabel(state.optimizer)} solve is no longer running.`
        );
      } catch (error) {
        state.isStopping = false;
        resumeSolveTimer();
        setSolveState(error instanceof Error ? error.message : "Failed to send the stop request.");
      }
    }

    async function waitForSolveResult(requestId) {
      let hasReceivedRunningSnapshot = false;
      let nextSnapshotRefreshAt = 0;
      while (true) {
        const shouldRequestSnapshot = !hasReceivedRunningSnapshot || Date.now() >= nextSnapshotRefreshAt;
        const searchParams = new URLSearchParams({ requestId });
        if (shouldRequestSnapshot) {
          searchParams.set("includeSnapshot", "1");
        }

        const response = await fetch(`/api/solve/status?${searchParams.toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Failed to read solver status.");
        }

        if (payload.jobStatus === "running") {
          if (payload.liveSnapshot && payload.solution) {
            applyRunningSnapshot(payload);
            hasReceivedRunningSnapshot = true;
            nextSnapshotRefreshAt = Date.now() + LIVE_SNAPSHOT_REFRESH_INTERVAL_MS;
          }
          setSolveState(buildSolveProgressMessage(payload));
          await delay(SOLVE_STATUS_POLL_INTERVAL_MS);
          continue;
        }

        if (payload.solution) {
          return payload;
        }

        throw new Error(payload.error || (payload.jobStatus === "stopped" ? "Solve was stopped." : "Solve failed."));
      }
    }

    async function runSolve() {
      if (state.layoutEditor.isApplying) {
        setSolveState("Wait for layout validation to finish before starting a new solve.");
        return;
      }
      state.isSolving = true;
      state.isStopping = false;
      state.activeSolveRequestId = createSolveRequestId();
      state.resultIsLiveSnapshot = false;
      state.resultError = "";
      state.solveProgressLog = [];
      clearManualEditState({ resetMode: true });
      clearExpansionAdvice();
      try {
        startSolveTimer();
        if (state.optimizer === "cp-sat") {
          ensureCpSatRandomSeed();
        }
        const request = buildSolveRequest();
        state.resultContext = request;
        if (state.optimizer === "cp-sat") {
          const timeLimitSeconds = request.params.cpSat?.timeLimitSeconds;
          const noImprovementTimeoutSeconds = request.params.cpSat?.noImprovementTimeoutSeconds;
          const randomSeed = request.params.cpSat?.randomSeed;
          const runCaps = [];
          if (timeLimitSeconds) {
            runCaps.push(`${timeLimitSeconds}s max runtime`);
          }
          if (noImprovementTimeoutSeconds) {
            runCaps.push(`${noImprovementTimeoutSeconds}s no-improvement cutoff`);
          }
          setSolveState(
            runCaps.length > 0
              ? `Running CP-SAT solver with seed ${randomSeed ?? "auto"}, ${runCaps.join(", ")}...`
              : `Running CP-SAT solver with seed ${randomSeed ?? "auto"} until it finishes or you stop it...`
          );
        } else if (state.optimizer === "lns") {
          setSolveState(
            `${state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint() ? "Running LNS from the displayed seed" : "Running LNS from a greedy seed"} with ${request.params.lns.iterations} neighborhood repairs and a ${request.params.lns.repairTimeLimitSeconds}s repair cap...`
          );
        } else if (state.optimizer === "auto") {
          setSolveState(`Running Auto solver. This is the ${AUTO_QUALITY_PATH_LABEL}: a capped fast Greedy seed starts the run, then LNS and bounded CP-SAT continue improving the incumbent...`);
        } else {
          setSolveState(`Running Greedy solver in ${GREEDY_MODE_LABEL}...`);
        }
        const startResponse = await fetch("/api/solve/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...request,
            requestId: state.activeSolveRequestId,
          }),
        });
        const startPayload = await startResponse.json();
        if (!startResponse.ok || !startPayload.ok) {
          throw new Error(startPayload.error || "Failed to start the solver.");
        }
        const payload = await waitForSolveResult(state.activeSolveRequestId);

        state.solveProgressLog = appendSolveProgressLog(state.solveProgressLog, payload, {
          elapsedMs: state.solveTimerElapsedMs,
          fallbackOptimizer: state.optimizer,
          source: "final-result",
        });
        state.result = {
          ...payload,
          progressLog: state.solveProgressLog.slice(),
        };
        state.resultIsLiveSnapshot = false;
        state.resultError = "";
        clearManualEditState({ resetMode: true });
        state.selectedMapCell = null;
        pauseSolveTimer();
        setResultElapsed(state.solveTimerElapsedMs);
        const stoppedByUser = Boolean(payload.solution?.stoppedByUser || payload.stats?.stoppedByUser);
        setSolveState(
          payload.message
            ? payload.message
            : stoppedByUser
              ? `Stopped early. Showing the best ${getOptimizerLabel(payload.stats.optimizer)} result found${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
              : payload.stats.optimizer === "auto"
                ? `Solved with Auto${payload.stats.activeOptimizer ? ` (final ${getOptimizerLabel(payload.stats.activeOptimizer)} stage)` : ""}.`
                : `Solved with ${getOptimizerLabel(payload.stats.optimizer)}${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
        );
      } catch (error) {
        state.result = null;
        state.resultIsLiveSnapshot = false;
        state.resultError = error instanceof Error ? error.message : "Unknown solve error.";
        state.solveProgressLog = [];
        clearManualEditState();
        pauseSolveTimer();
        setResultElapsed(state.solveTimerElapsedMs);
        setSolveState(/stopped/i.test(state.resultError) ? "Solver stopped." : "Solver run failed.");
      } finally {
        state.isSolving = false;
        state.isStopping = false;
        state.activeSolveRequestId = "";
        setSolveState(elements.solveStatus.textContent);
        renderResults();
      }
    }

    return {
      pauseSolveTimer,
      requestStopSolve,
      resetSolveTimer,
      runSolve,
      setResultElapsed,
    };
  }

  globalObject.CityBuilderSolveRuntime = Object.freeze({
    appendSolveProgressLog,
    buildSolveProgressLogEntry,
    createSolveRuntime,
  });
})(window);
