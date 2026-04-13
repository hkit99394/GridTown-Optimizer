(function attachPlannerSolveRuntime(globalObject) {
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
      const bestLabel =
        typeof payload.bestTotalPopulation === "number"
          ? ` Best so far: ${Number(payload.bestTotalPopulation).toLocaleString()}.`
          : "";

      if (state.isStopping) {
        if (payload.hasFeasibleSolution) {
          return optimizer === "cp-sat"
            ? `Stop requested. Finalizing the best feasible ${optimizerLabel} result.${bestLabel}`
            : optimizer === "lns"
              ? `Stop requested. Finalizing the best ${optimizerLabel} result found after neighborhood repair.${bestLabel}`
              : `Stop requested. Finalizing the best ${optimizerLabel} result found so far.${bestLabel}`;
        }
        return `Stop requested. Waiting for ${optimizerLabel} to stop. No result has been found yet.`;
      }

      if (payload.hasFeasibleSolution) {
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
      state.result = payload;
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
      state.layoutEditor.mode = "inspect";
      state.layoutEditor.pendingPlacement = null;
      state.layoutEditor.status = "";
      clearExpansionAdvice();
      try {
        startSolveTimer();
        const request = buildSolveRequest();
        state.resultContext = request;
        if (state.optimizer === "cp-sat") {
          const timeLimitSeconds = request.params.cpSat?.timeLimitSeconds;
          setSolveState(
            timeLimitSeconds
              ? `Running CP-SAT solver with a ${timeLimitSeconds}s limit...`
              : "Running CP-SAT solver until it finishes or you stop it..."
          );
        } else if (state.optimizer === "lns") {
          setSolveState(
            `${state.lns.useDisplayedSeed && getDisplayedLayoutCheckpoint() ? "Running LNS from the displayed seed" : "Running LNS from a greedy seed"} with ${request.params.lns.iterations} neighborhood repairs and a ${request.params.lns.repairTimeLimitSeconds}s repair cap...`
          );
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

        state.result = payload;
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
              : `Solved with ${getOptimizerLabel(payload.stats.optimizer)}${payload.stats.cpSatStatus ? ` (${payload.stats.cpSatStatus})` : ""}.`
        );
      } catch (error) {
        state.result = null;
        state.resultIsLiveSnapshot = false;
        state.resultError = error instanceof Error ? error.message : "Unknown solve error.";
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
    createSolveRuntime,
  });
})(window);
