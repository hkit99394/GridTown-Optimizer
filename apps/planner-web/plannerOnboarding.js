/**
 * @param {Window & { CityBuilderOnboarding?: unknown, CityBuilderSamplePresets?: { applySampleProblemPreset: Function } }} globalObject
 */
(function attachPlannerOnboarding(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {number[][]} PlannerGrid
   * @typedef {{ label: string, grid: PlannerGrid, serviceTypes: JsonObject[], residentialTypes: JsonObject[], availableBuildings: { services: string, residentials: string } }} SampleProblemPreset
   * @typedef {{
   *   state: JsonObject,
   *   elements: JsonObject,
   *   sampleProblemPresets: Record<string, SampleProblemPreset>,
   *   helpers: { cloneGrid: (grid: PlannerGrid) => PlannerGrid },
   *   callbacks: { setSolveState: (message: string) => void, syncPlannerFromState: () => void }
   * }} PlannerOnboardingOptions
   */

  const { applySampleProblemPreset } = globalObject.CityBuilderSamplePresets ?? {};

  /**
   * @param {PlannerOnboardingOptions} options
   */
  function createPlannerOnboardingController(options) {
    const { state, elements, sampleProblemPresets, helpers, callbacks } = options;

    /**
     * @param {boolean} enabled
     */
    function setAdvancedMode(enabled) {
      state.advancedMode = Boolean(enabled);
      elements.advancedModeToggle.checked = state.advancedMode;
      globalObject.document.body.classList.toggle("advanced-mode", state.advancedMode);
    }

    async function refreshCpSatReadiness() {
      if (!elements.cpSatReadinessStatus) return;
      try {
        const response = await fetch("/api/cp-sat/readiness", {
          headers: { accept: "application/json" }
        });
        const payload = await response.json();
        const readiness = payload.cpSat ?? {};
        if (payload.ok && readiness.ready) {
          elements.cpSatReadinessStatus.textContent = `CP-SAT ready via ${readiness.pythonExecutable}.`;
          return;
        }
        elements.cpSatReadinessStatus.textContent =
          readiness.message ??
          "CP-SAT is not ready. Run npm run setup:cp-sat or set CITY_BUILDER_CP_SAT_PYTHON to a Python with OR-Tools.";
      } catch {
        elements.cpSatReadinessStatus.textContent =
          "CP-SAT readiness check is unavailable. Restart the planner server after updating the backend.";
      }
    }

    /**
     * @param {string} key
     */
    function loadSampleProblem(key) {
      const preset = sampleProblemPresets[key];
      if (!preset || typeof applySampleProblemPreset !== "function") return;
      applySampleProblemPreset({ state, preset, cloneGrid: helpers.cloneGrid });
      callbacks.syncPlannerFromState();
      elements.runtimePresetStatus.textContent = `Loaded "${preset.label}" with Auto selected.`;
      callbacks.setSolveState(elements.runtimePresetStatus.textContent);
    }

    function bindEvents() {
      elements.sampleProblemButtons.addEventListener(
        "click",
        /** @param {Event} event */ (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest("button");
          if (!(button instanceof HTMLButtonElement) || !button.dataset.sampleProblem) return;
          loadSampleProblem(button.dataset.sampleProblem);
        }
      );

      elements.advancedModeToggle.addEventListener("change", () => {
        setAdvancedMode(elements.advancedModeToggle.checked);
      });
    }

    function init() {
      setAdvancedMode(state.advancedMode);
      bindEvents();
      refreshCpSatReadiness();
    }

    return Object.freeze({
      init,
      loadSampleProblem,
      refreshCpSatReadiness,
      setAdvancedMode
    });
  }

  globalObject.CityBuilderOnboarding = Object.freeze({
    createPlannerOnboardingController
  });
})(window);
