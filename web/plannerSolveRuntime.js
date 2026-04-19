(function attachPlannerSolveRuntime(globalObject) {
  function normalizeProgressElapsedMs(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.max(0, Math.round(numericValue));
  }

  function readAutoStage(payload) {
    return payload?.solution?.autoStage ?? payload?.stats?.autoStage ?? payload?.autoStage ?? null;
  }

  function buildSolveProgressLogEntry(payload, options = {}) {
    if (!payload?.solution && typeof payload?.bestTotalPopulation !== "number") return null;

    const telemetry = payload?.solution?.cpSatTelemetry ?? null;
    const autoStage = readAutoStage(payload);
    const totalPopulation =
      typeof payload?.stats?.totalPopulation === "number"
        ? payload.stats.totalPopulation
        : typeof payload?.solution?.totalPopulation === "number"
          ? payload.solution.totalPopulation
          : typeof payload?.bestTotalPopulation === "number"
            ? payload.bestTotalPopulation
            : null;

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
      note: null,
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

    function buildSolveProgressMessage(payload) {
      const optimizer = payload.optimizer || state.optimizer;
      const optimizerLabel = getOptimizerLabel(optimizer);
      const autoStage = readAutoStage(payload);
      const activeOptimizer = payload.activeOptimizer || payload.solution?.activeOptimizer || payload.stats?.activeOptimizer || null;
      const bestLabel =
        typeof payload.bestTotalPopulation === "number"
          ? ` Best so far: ${Number(payload.bestTotalPopulation).toLocaleString()}.`
          : "";

      if (state.isStopping) {
        if (payload.hasFeasibleSolution) {
          if (optimizer === "auto") {
            return `Stop requested. Finalizing Auto${activeOptimizer ? ` (${getOptimizerLabel(activeOptimizer)})` : ""}.${bestLabel}`;
          }
          return optimizer === "cp-sat"
            ? `Stop requested. Finalizing the best feasible ${optimizerLabel} result.${bestLabel}`
            : optimizer === "lns"
              ? `Stop requested. Finalizing the best ${optimizerLabel} result found after neighborhood repair.${bestLabel}`
              : `Stop requested. Finalizing the best ${optimizerLabel} result found so far.${bestLabel}`;
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
          return `Running ${optimizerLabel} solver. ${cycleLabel}${activeOptimizer ? `${getOptimizerLabel(activeOptimizer)} stage is active. ` : ""}${weakCycleLabel}${bestLabel.trim()}`.trim();
        }
        return optimizer === "cp-sat"
          ? `Running ${optimizerLabel} solver. Feasible solution found and still improving.${bestLabel}`
          : optimizer === "lns"
            ? (
              state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
                ? `Running ${optimizerLabel} solver. Displayed seed is ready and neighborhood repairs are still improving.${bestLabel}`
                : `Running ${optimizerLabel} solver. Greedy seed is ready and neighborhood repairs are still improving.${bestLabel}`
            )
            : `Running ${optimizerLabel} solver. Search is still improving.${bestLabel}`;
      }

      if (optimizer === "cp-sat") {
        return `Running ${optimizerLabel} solver. Searching for the first feasible solution...`;
      }
      if (optimizer === "auto") {
        return "Running Auto solver. Starting the greedy seed stage...";
      }
      if (optimizer === "lns") {
        return state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint()
          ? `Running ${optimizerLabel} solver. Loading the displayed seed before neighborhood repair...`
          : `Running ${optimizerLabel} solver. Building the greedy seed before neighborhood repair...`;
      }
      return `Running ${optimizerLabel} solver. Searching for an initial result...`;
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
      state.layoutEditor.edited = false;
      state.layoutEditor.status = "";
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
      state.isSolving = true;
      state.isStopping = false;
      state.activeSolveRequestId = createSolveRequestId();
      state.resultIsLiveSnapshot = false;
      state.resultError = "";
      state.solveProgressLog = [];
      state.layoutEditor.mode = "inspect";
      state.layoutEditor.pendingPlacement = null;
      state.layoutEditor.status = "";
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
          setSolveState("Running Auto solver. Greedy seed, LNS repair, and bounded CP-SAT passes will be orchestrated automatically...");
        } else {
          setSolveState("Running greedy solver...");
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
        state.layoutEditor.edited = false;
        state.layoutEditor.status = "";
        state.layoutEditor.mode = "inspect";
        state.layoutEditor.pendingPlacement = null;
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
        state.layoutEditor.edited = false;
        state.layoutEditor.status = "";
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
