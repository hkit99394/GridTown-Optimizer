/**
 * @param {Window & { CityBuilderShell?: unknown }} globalObject
 */
(function attachPlannerShell(globalObject) {
  /**
   * @typedef {object} ShellToggleContainer
   * @property {(selector: string) => Array<{ disabled: boolean }>} querySelectorAll
   */

  /**
   * @typedef {object} ShellControl
   * @property {boolean} disabled
   * @property {string} [textContent]
   */

  /**
   * @typedef {object} ShellElements
   * @property {ShellControl} solveButton
   * @property {ShellControl} stopSolveButton
   * @property {ShellControl} loadConfigButton
   * @property {ShellControl} loadLayoutButton
   * @property {ShellControl} saveLayoutButton
   * @property {ShellControl} lnsUseDisplayedSeed
   * @property {ShellControl} cpSatUseDisplayedHint
   * @property {ShellControl} expansionNextService
   * @property {ShellControl} expansionNextResidential
   * @property {ShellControl} compareExpansionButton
   * @property {ShellControl | null | undefined} moveSelectedBuildingButton
   * @property {ShellControl | null | undefined} removeSelectedBuildingButton
   * @property {ShellControl | null | undefined} rotatePendingPlacementButton
   * @property {ShellControl | null | undefined} validateEditedLayoutButton
   * @property {ShellToggleContainer} layoutEditModeToggle
   * @property {ShellToggleContainer} remainingServiceList
   * @property {ShellToggleContainer} remainingResidentialList
   * @property {{ textContent: string }} solveStatus
   */

  /**
   * @typedef {object} PlannerShellState
   * @property {boolean} isSolving
   * @property {string | null | undefined} activeSolveRequestId
   * @property {boolean} isStopping
   * @property {Record<string, any> | null | undefined} result
   * @property {Record<string, any> | null | undefined} resultContext
   * @property {{ edited?: boolean, isApplying: boolean, pendingValidation: boolean, pendingPlacement?: { canRotate?: boolean } | null }} layoutEditor
   * @property {{ isRunning: boolean }} expansionAdvice
   */

  /**
   * @typedef {object} PlannerShellCallbacks
   * @property {() => boolean} hasSelectedBuilding
   * @property {() => { hasAnyCandidate: boolean }} readExpansionCandidateFlags
   */

  /**
   * @typedef {object} PlannerShellOptions
   * @property {PlannerShellState} state
   * @property {ShellElements} elements
   * @property {PlannerShellCallbacks} callbacks
   */

  /**
   * @param {PlannerShellOptions} options
   */
  function createPlannerShellController(options) {
    const { state, elements, callbacks } = options;
    const { hasSelectedBuilding, readExpansionCandidateFlags } = callbacks;

    function hasEditableResult() {
      return Boolean(state.result && state.resultContext);
    }

    function isManualLayoutResult() {
      return Boolean(
        state.layoutEditor.edited || state.result?.solution?.manualLayout || state.result?.stats?.manualLayout
      );
    }

    function requiresManualLayoutValidation() {
      return Boolean(
        state.layoutEditor.pendingValidation || (isManualLayoutResult() && state.result?.validation?.valid === false)
      );
    }

    /**
     * @param {ShellToggleContainer | null | undefined} container
     * @param {string} selector
     * @param {boolean} disabled
     */
    function setActionButtonsDisabled(container, selector, disabled) {
      for (const button of container?.querySelectorAll?.(selector) ?? []) {
        button.disabled = disabled;
      }
    }

    /**
     * @param {string} optimizer
     * @returns {string}
     */
    function getOptimizerLabel(optimizer) {
      if (optimizer === "auto") return "Auto";
      if (optimizer === "cp-sat") return "CP-SAT";
      if (optimizer === "lns") return "LNS";
      return "Greedy";
    }

    function syncActionAvailability() {
      const { hasAnyCandidate } = readExpansionCandidateFlags();
      const selectedBuildingActive = Boolean(hasSelectedBuilding());
      const comparisonBusy = state.expansionAdvice.isRunning;
      const editorBusy = state.isSolving || state.layoutEditor.isApplying || comparisonBusy;
      const editableResult = hasEditableResult();
      const manualLayoutNeedsValidation = requiresManualLayoutValidation();
      const editorControlsDisabled = editorBusy || !editableResult;

      elements.solveButton.disabled = editorBusy;
      elements.solveButton.textContent = state.isSolving ? "Solving..." : "Run solver";
      elements.stopSolveButton.disabled = !(state.isSolving && state.activeSolveRequestId && !state.isStopping);
      elements.loadConfigButton.disabled = editorBusy;
      elements.loadLayoutButton.disabled = editorBusy;
      elements.saveLayoutButton.disabled = editorControlsDisabled;
      elements.lnsUseDisplayedSeed.disabled = editorBusy || manualLayoutNeedsValidation;
      elements.cpSatUseDisplayedHint.disabled = editorBusy || manualLayoutNeedsValidation;
      elements.expansionNextService.disabled = editorBusy;
      elements.expansionNextResidential.disabled = editorBusy;
      elements.compareExpansionButton.disabled =
        editorBusy || manualLayoutNeedsValidation || !editableResult || !hasAnyCandidate;

      if (elements.moveSelectedBuildingButton) {
        elements.moveSelectedBuildingButton.disabled = editorControlsDisabled || !selectedBuildingActive;
      }
      if (elements.removeSelectedBuildingButton) {
        elements.removeSelectedBuildingButton.disabled = editorControlsDisabled || !selectedBuildingActive;
      }
      setActionButtonsDisabled(elements.layoutEditModeToggle, "button", editorControlsDisabled);
      if (elements.rotatePendingPlacementButton) {
        elements.rotatePendingPlacementButton.disabled =
          editorControlsDisabled ||
          !state.layoutEditor.pendingPlacement ||
          !state.layoutEditor.pendingPlacement.canRotate;
      }
      if (elements.validateEditedLayoutButton) {
        elements.validateEditedLayoutButton.disabled = editorControlsDisabled || !state.layoutEditor.pendingValidation;
      }
      setActionButtonsDisabled(elements.remainingServiceList, "button[data-action]", editorControlsDisabled);
      setActionButtonsDisabled(elements.remainingResidentialList, "button[data-action]", editorControlsDisabled);
    }

    /**
     * @param {string} message
     */
    function setSolveState(message) {
      elements.solveStatus.textContent = message;
      syncActionAvailability();
    }

    return {
      getOptimizerLabel,
      setSolveState,
      syncActionAvailability
    };
  }

  const plannerShellGlobal = /** @type {Window & { CityBuilderShell?: unknown }} */ (globalObject);
  plannerShellGlobal.CityBuilderShell = Object.freeze({
    createPlannerShellController
  });
})(window);
