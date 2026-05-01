(function attachPlannerExpansion(globalObject) {
  function createExpansionAdviceController(options) {
    const {
      state,
      elements,
      constants,
      helpers,
      callbacks,
    } = options;
    const {
      COMPARISON_PROGRESS_HINT_INTERVAL_MS,
      SOLVE_STATUS_POLL_INTERVAL_MS,
    } = constants;
    const {
      buildCpSatContinuationModelInput,
      cloneJson,
      computeCpSatModelFingerprint,
      createSolveRequestId,
      delay,
      parseResidentialCatalogEntry,
      parseServiceCatalogEntry,
    } = helpers;
    const {
      buildSolveRequest,
      getDisplayedLayoutCheckpoint,
      getDisplayedLayoutSourceLabel,
      getOptimizerLabel,
      syncActionAvailability,
    } = callbacks;

    function clearExpansionAdvice() {
      state.expansionAdvice.isRunning = false;
      state.expansionAdvice.status = "";
      state.expansionAdvice.result = null;
      state.expansionAdvice.error = "";
    }

    function formatSignedPopulationDelta(delta) {
      const amount = Number(delta ?? 0);
      if (amount > 0) return `+${amount.toLocaleString()}`;
      if (amount < 0) return `-${Math.abs(amount).toLocaleString()}`;
      return "0";
    }

    function readExpansionCandidateFlags() {
      const hasServiceCandidate = Boolean(String(state.expansionAdvice.nextServiceText ?? "").trim());
      const hasResidentialCandidate = Boolean(String(state.expansionAdvice.nextResidentialText ?? "").trim());
      return {
        hasServiceCandidate,
        hasResidentialCandidate,
        hasAnyCandidate: hasServiceCandidate || hasResidentialCandidate,
        hasBothCandidates: hasServiceCandidate && hasResidentialCandidate,
      };
    }

    function getDisplayedResultSummary() {
      if (!state.result || !state.resultContext) {
        throw new Error("Run or load a layout before comparing additions.");
      }
      return {
        totalPopulation: Number(state.result.stats?.totalPopulation ?? state.result.solution?.totalPopulation ?? 0),
        serviceCount: Number(state.result.stats?.serviceCount ?? state.result.solution?.services?.length ?? 0),
        residentialCount: Number(state.result.stats?.residentialCount ?? state.result.solution?.residentials?.length ?? 0),
      };
    }

    function buildExpansionBaseRequest() {
      const summary = getDisplayedResultSummary();
      const request = cloneJson(state.resultContext);
      const plannerSolveRequest = buildSolveRequest({
        hintMismatch: "ignore",
        includeWarmStartHint: false,
        includeLnsSeed: false,
      });
      request.params.optimizer = plannerSolveRequest.params.optimizer;
      request.params.greedy = cloneJson(plannerSolveRequest.params.greedy ?? {});
      request.params.cpSat = cloneJson(plannerSolveRequest.params.cpSat ?? {});
      request.params.lns = cloneJson(plannerSolveRequest.params.lns ?? {});
      delete request.params.maxServices;
      delete request.params.maxResidentials;
      request.params.availableBuildings = {
        services: summary.serviceCount,
        residentials: summary.residentialCount,
      };
      return {
        request,
        baseline: summary,
      };
    }

    function checkpointMatchesComparisonRequest(checkpoint, request) {
      const currentFingerprint = computeCpSatModelFingerprint(buildCpSatContinuationModelInput(request));
      return currentFingerprint === checkpoint.compatibility.modelFingerprint;
    }

    function buildComparisonDisplayedLayoutCheckpointPayload(request) {
      const checkpoint = getDisplayedLayoutCheckpoint();
      if (!checkpoint || !checkpointMatchesComparisonRequest(checkpoint, request)) return null;
      return {
        sourceName: `${getDisplayedLayoutSourceLabel()} (comparison baseline)`,
        modelFingerprint: checkpoint.compatibility.modelFingerprint,
        roadKeys: cloneJson(checkpoint.hint.roadKeys),
        serviceCandidateKeys: cloneJson(checkpoint.hint.serviceCandidateKeys),
        residentialCandidateKeys: cloneJson(checkpoint.hint.residentialCandidateKeys),
        solution: cloneJson(checkpoint.hint.solution),
        hintConflictLimit: 20,
      };
    }

    function attachComparisonSeedOrHint(request) {
      if (request.params.optimizer === "cp-sat" && !state.cpSat.useDisplayedHint) {
        return request;
      }
      if (request.params.optimizer === "lns" && !state.lns.useDisplayedSeed) {
        return request;
      }
      if (request.params.optimizer === "auto" && !state.cpSat.useDisplayedHint && !state.lns.useDisplayedSeed) {
        return request;
      }

      const payload = buildComparisonDisplayedLayoutCheckpointPayload(request);
      if (!payload) return request;

      if (request.params.optimizer === "cp-sat") {
        request.params.cpSat = {
          ...(request.params.cpSat ?? {}),
          warmStartHint: cloneJson(payload),
        };
      } else if (request.params.optimizer === "lns") {
        request.params.lns = {
          ...(request.params.lns ?? {}),
          seedHint: cloneJson(payload),
        };
      } else if (request.params.optimizer === "auto") {
        if (state.cpSat.useDisplayedHint) {
          request.params.cpSat = {
            ...(request.params.cpSat ?? {}),
            warmStartHint: cloneJson(payload),
          };
        }
        if (state.lns.useDisplayedSeed) {
          request.params.lns = {
            ...(request.params.lns ?? {}),
            seedHint: cloneJson(payload),
          };
        }
      }

      return request;
    }

    function parseExpansionServiceCandidate(text) {
      const match = String(text ?? "").trim().match(/^\s*(.+?)(?:\s*,\s*|\t+)(\d+)(?:\s*,\s*|\t+)(\d+\s*x\s*\d+)(?:\s*,\s*|\t+)(\d+\s*x\s*\d+)\s*$/i);
      if (!match) {
        throw new Error("Next service must look like: Name, Bonus, 2x2, 12x12");
      }
      const [, name, bonus, size, effective] = match;
      return parseServiceCatalogEntry(
        {
          name: name.trim(),
          bonus: bonus.trim(),
          size: size.replaceAll(" ", ""),
          effective: effective.replaceAll(" ", ""),
        },
        state.serviceTypes.length
      );
    }

    function parseExpansionResidentialCandidate(text) {
      const match = String(text ?? "").trim().match(/^\s*(.+?)(?:\s*,\s*|\t+)(\d+\s*\/\s*\d+)(?:\s*,\s*|\t+|\s+)(\d+\s*x\s*\d+)\s*$/i);
      if (!match) {
        throw new Error("Next residential must look like: Name, 780/2340, 2x3");
      }
      const [, name, resident, size] = match;
      return parseResidentialCatalogEntry(
        {
          name: name.trim(),
          resident: resident.replaceAll(" ", ""),
          size: size.replaceAll(" ", ""),
          avail: "1",
        },
        state.residentialTypes.length
      );
    }

    function buildExpansionScenarioRequest(kind) {
      const { request, baseline } = buildExpansionBaseRequest();
      request.params.availableBuildings = {
        services: baseline.serviceCount + (kind === "service" ? 1 : 0),
        residentials: baseline.residentialCount + (kind === "residential" ? 1 : 0),
      };

      if (kind === "service") {
        const serviceCandidate = parseExpansionServiceCandidate(state.expansionAdvice.nextServiceText);
        request.params.serviceTypes = [...(request.params.serviceTypes ?? []), serviceCandidate];
        return {
          request: attachComparisonSeedOrHint(request),
          candidateName: serviceCandidate.name,
          baseline,
        };
      }

      const residentialCandidate = parseExpansionResidentialCandidate(state.expansionAdvice.nextResidentialText);
      request.params.residentialTypes = [...(request.params.residentialTypes ?? []), residentialCandidate];
      return {
        request: attachComparisonSeedOrHint(request),
        candidateName: residentialCandidate.name,
        baseline,
      };
    }

    function buildExpansionProgressMessage(candidateName, payload) {
      const optimizerLabel = getOptimizerLabel(payload?.optimizer || state.optimizer);
      if (typeof payload?.bestTotalPopulation === "number") {
        return `Testing ${candidateName} with ${optimizerLabel}. Latest reported best population: ${Number(payload.bestTotalPopulation).toLocaleString()}.`;
      }
      if (payload?.hasFeasibleSolution) {
        return `Testing ${candidateName} with ${optimizerLabel}. A feasible layout is available and still improving.`;
      }
      return `Testing ${candidateName} with ${optimizerLabel}. Still searching for the first feasible layout.`;
    }

    async function runComparisonSolve(request, candidateName) {
      const requestId = `${createSolveRequestId()}-compare`;
      const startResponse = await fetch("/api/solve/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...request,
          requestId,
        }),
      });
      const startPayload = await startResponse.json();
      if (!startResponse.ok || !startPayload.ok) {
        throw new Error(startPayload.error || "Failed to start the candidate comparison.");
      }

      let nextProgressHintAt = Date.now() + COMPARISON_PROGRESS_HINT_INTERVAL_MS;
      while (true) {
        const response = await fetch(`/api/solve/status?${new URLSearchParams({ requestId }).toString()}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Failed to read candidate comparison status.");
        }

        if (payload.jobStatus === "running") {
          if (Date.now() >= nextProgressHintAt) {
            state.expansionAdvice.status = buildExpansionProgressMessage(candidateName, payload);
            renderExpansionAdvice();
            nextProgressHintAt = Date.now() + COMPARISON_PROGRESS_HINT_INTERVAL_MS;
          }
          await delay(SOLVE_STATUS_POLL_INTERVAL_MS);
          continue;
        }

        if (payload.solution) {
          return payload;
        }

        throw new Error(payload.error || "Candidate comparison failed.");
      }
    }

    function renderExpansionAdvice() {
      if (!elements.expansionAdviceStatus || !elements.expansionAdviceMetrics) return;

      const hasResult = Boolean(state.result && state.resultContext);
      const { hasAnyCandidate, hasBothCandidates, hasServiceCandidate, hasResidentialCandidate } = readExpansionCandidateFlags();

      if (!hasResult) {
        elements.expansionAdviceStatus.textContent =
          "Run or load a layout first, then enter the next service and/or next residential candidate to estimate the impact.";
        elements.expansionAdviceMetrics.hidden = true;
        return;
      }

      if (state.expansionAdvice.isRunning) {
        elements.expansionAdviceStatus.textContent = state.expansionAdvice.status || "Comparing candidate additions...";
        elements.expansionAdviceMetrics.hidden = true;
        return;
      }

      if (state.expansionAdvice.error) {
        elements.expansionAdviceStatus.textContent = state.expansionAdvice.error;
        elements.expansionAdviceMetrics.hidden = true;
        return;
      }

      if (!state.expansionAdvice.result) {
        elements.expansionAdviceStatus.textContent = hasBothCandidates
          ? "Ready to compare both typed additions against the current displayed layout."
          : hasServiceCandidate
            ? "Ready to estimate the service addition against the current displayed layout."
            : hasResidentialCandidate
              ? "Ready to estimate the residential addition against the current displayed layout."
              : hasAnyCandidate
                ? "Ready to estimate the typed addition against the current displayed layout."
                : "Enter the next service and/or next residential candidate to estimate the population impact.";
        elements.expansionAdviceMetrics.hidden = true;
        return;
      }

      const result = state.expansionAdvice.result;
      elements.expansionAdviceStatus.textContent = result.detail;
      elements.expansionAdviceWinner.textContent = result.winner;
      elements.expansionAdviceBaseline.textContent = Number(result.baselinePopulation).toLocaleString();
      elements.expansionAdviceServiceOutcome.textContent =
        result.servicePopulation == null
          ? "Not tested"
          : `${Number(result.servicePopulation).toLocaleString()} (${formatSignedPopulationDelta(result.serviceDelta)})`;
      elements.expansionAdviceResidentialOutcome.textContent =
        result.residentialPopulation == null
          ? "Not tested"
          : `${Number(result.residentialPopulation).toLocaleString()} (${formatSignedPopulationDelta(result.residentialDelta)})`;
      elements.expansionAdviceMetrics.hidden = false;
    }

    async function compareExpansionOptions() {
      if (state.isSolving || state.expansionAdvice.isRunning) return;

      try {
        const { hasAnyCandidate, hasServiceCandidate, hasResidentialCandidate, hasBothCandidates } = readExpansionCandidateFlags();
        if (!hasAnyCandidate) {
          throw new Error("Enter at least one next-building candidate before estimating the impact.");
        }

        const baselineScenario = buildExpansionBaseRequest();
        const serviceScenario = hasServiceCandidate ? buildExpansionScenarioRequest("service") : null;
        const residentialScenario = hasResidentialCandidate ? buildExpansionScenarioRequest("residential") : null;
        const baselinePopulation = Number(baselineScenario.baseline.totalPopulation ?? 0);

        state.expansionAdvice.isRunning = true;
        state.expansionAdvice.error = "";
        state.expansionAdvice.result = null;
        state.expansionAdvice.status =
          `Using the displayed layout as the baseline at ${baselinePopulation.toLocaleString()}.`;
        renderExpansionAdvice();
        syncActionAvailability();

        const servicePayload = serviceScenario
          ? (
            state.expansionAdvice.status = `Testing service option "${serviceScenario.candidateName}"...`,
            renderExpansionAdvice(),
            await runComparisonSolve(serviceScenario.request, `service option "${serviceScenario.candidateName}"`)
          )
          : null;
        const residentialPayload = residentialScenario
          ? (
            state.expansionAdvice.status = `Testing residential option "${residentialScenario.candidateName}"...`,
            renderExpansionAdvice(),
            await runComparisonSolve(residentialScenario.request, `residential option "${residentialScenario.candidateName}"`)
          )
          : null;
        const servicePopulation = servicePayload
          ? Number(servicePayload.stats?.totalPopulation ?? servicePayload.solution?.totalPopulation ?? 0)
          : null;
        const residentialPopulation = residentialPayload
          ? Number(residentialPayload.stats?.totalPopulation ?? residentialPayload.solution?.totalPopulation ?? 0)
          : null;
        const serviceDelta = servicePopulation == null ? null : servicePopulation - baselinePopulation;
        const residentialDelta = residentialPopulation == null ? null : residentialPopulation - baselinePopulation;

        let winner = "Remain current layout";
        let detail = `Baseline reaches ${baselinePopulation.toLocaleString()}.`;

        if (hasBothCandidates && serviceScenario && residentialScenario && serviceDelta != null && residentialDelta != null) {
          detail =
            `Baseline reaches ${baselinePopulation.toLocaleString()}, ${serviceScenario.candidateName} reaches `
            + `${servicePopulation.toLocaleString()} (${formatSignedPopulationDelta(serviceDelta)}), `
            + `${residentialScenario.candidateName} reaches ${residentialPopulation.toLocaleString()} `
            + `(${formatSignedPopulationDelta(residentialDelta)}).`;

          if (serviceDelta <= 0 && residentialDelta <= 0) {
            winner = "Remain current layout";
            detail =
              `Neither typed addition improves the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline `
              + `of ${baselinePopulation.toLocaleString()}.`;
          } else if (serviceDelta > residentialDelta) {
            winner = `Add ${serviceScenario.candidateName}`;
          } else if (residentialDelta > serviceDelta) {
            winner = `Add ${residentialScenario.candidateName}`;
          } else {
            winner = "Tie";
            detail =
              `Both additions improve the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline by `
              + `${formatSignedPopulationDelta(serviceDelta)}.`;
          }
        } else if (serviceScenario && serviceDelta != null) {
          winner = serviceDelta > 0 ? `Add ${serviceScenario.candidateName}` : "Remain current layout";
          detail = serviceDelta > 0
            ? `${serviceScenario.candidateName} raises the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline from `
              + `${baselinePopulation.toLocaleString()} to ${servicePopulation.toLocaleString()} `
              + `(${formatSignedPopulationDelta(serviceDelta)}).`
            : `${serviceScenario.candidateName} reaches ${servicePopulation.toLocaleString()} `
              + `(${formatSignedPopulationDelta(serviceDelta)}), so keeping the current layout is still better than the baseline `
              + `of ${baselinePopulation.toLocaleString()}.`;
        } else if (residentialScenario && residentialDelta != null) {
          winner = residentialDelta > 0 ? `Add ${residentialScenario.candidateName}` : "Remain current layout";
          detail = residentialDelta > 0
            ? `${residentialScenario.candidateName} raises the current ${getOptimizerLabel(baselineScenario.request.params.optimizer)} baseline from `
              + `${baselinePopulation.toLocaleString()} to ${residentialPopulation.toLocaleString()} `
              + `(${formatSignedPopulationDelta(residentialDelta)}).`
            : `${residentialScenario.candidateName} reaches ${residentialPopulation.toLocaleString()} `
              + `(${formatSignedPopulationDelta(residentialDelta)}), so keeping the current layout is still better than the baseline `
              + `of ${baselinePopulation.toLocaleString()}.`;
        }

        state.expansionAdvice.isRunning = false;
        state.expansionAdvice.status = "";
        state.expansionAdvice.result = {
          winner,
          detail,
          baselinePopulation,
          servicePopulation,
          serviceDelta,
          residentialPopulation,
          residentialDelta,
        };
        renderExpansionAdvice();
      } catch (error) {
        state.expansionAdvice.isRunning = false;
        state.expansionAdvice.result = null;
        state.expansionAdvice.error = error instanceof Error
          ? error.message
          : "Failed to compare the typed additions.";
        renderExpansionAdvice();
      } finally {
        syncActionAvailability();
      }
    }

    return Object.freeze({
      clearExpansionAdvice,
      compareExpansionOptions,
      readExpansionCandidateFlags,
      renderExpansionAdvice,
    });
  }

  globalObject.CityBuilderExpansion = Object.freeze({
    createExpansionAdviceController,
  });
})(window);
