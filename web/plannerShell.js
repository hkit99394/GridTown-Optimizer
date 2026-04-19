(function attachPlannerShell(globalObject) {
  function createPlannerShellController(options) {
    const {
      state,
      elements,
      callbacks,
    } = options;
    const {
      hasSelectedBuilding,
      readExpansionCandidateFlags,
    } = callbacks;

    function hasEditableResult() {
      return Boolean(state.result && state.resultContext);
    }

    function isManualLayoutResult() {
      return Boolean(
        state.layoutEditor.edited
        || state.result?.solution?.manualLayout
        || state.result?.stats?.manualLayout
      );
    }

    function requiresManualLayoutValidation() {
      return Boolean(
        state.layoutEditor.pendingValidation
        || (isManualLayoutResult() && state.result?.validation?.valid === false)
      );
    }

    function setActionButtonsDisabled(container, selector, disabled) {
      for (const button of container?.querySelectorAll?.(selector) ?? []) {
        button.disabled = disabled;
      }
    }

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
        editorBusy
        || manualLayoutNeedsValidation
        || !editableResult
        || !hasAnyCandidate;

      if (elements.moveSelectedBuildingButton) {
        elements.moveSelectedBuildingButton.disabled =
          editorControlsDisabled || !selectedBuildingActive;
      }
      if (elements.removeSelectedBuildingButton) {
        elements.removeSelectedBuildingButton.disabled =
          editorControlsDisabled || !selectedBuildingActive;
      }
      setActionButtonsDisabled(elements.layoutEditModeToggle, "button", editorControlsDisabled);
      if (elements.rotatePendingPlacementButton) {
        elements.rotatePendingPlacementButton.disabled =
          editorControlsDisabled
          || !state.layoutEditor.pendingPlacement
          || !state.layoutEditor.pendingPlacement.canRotate;
      }
      if (elements.validateEditedLayoutButton) {
        elements.validateEditedLayoutButton.disabled =
          editorControlsDisabled
          || !state.layoutEditor.pendingValidation;
      }
      setActionButtonsDisabled(elements.remainingServiceList, "button[data-action]", editorControlsDisabled);
      setActionButtonsDisabled(elements.remainingResidentialList, "button[data-action]", editorControlsDisabled);
    }

    function setSolveState(message) {
      elements.solveStatus.textContent = message;
      syncActionAvailability();
    }

    return {
      getOptimizerLabel,
      setSolveState,
      syncActionAvailability,
    };
  }

  globalObject.CityBuilderShell = Object.freeze({
    createPlannerShellController,
  });
})(window);
