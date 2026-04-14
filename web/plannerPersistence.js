(function attachPlannerPersistence(globalObject) {
  function createPlannerPersistence(options) {
    const {
      state,
      elements,
      constants,
      helpers,
      callbacks,
    } = options;
    const {
      CONFIG_STORAGE_KEY,
      LAYOUT_STORAGE_KEY,
      defaultResidentialTypes,
      defaultServiceTypes,
      sampleGrid,
    } = constants;
    const {
      buildCpSatWarmStartCheckpoint,
      cloneGrid,
      cloneJson,
      createSavedEntryId,
      formatElapsedTime,
      formatSavedTimestamp,
      getSavedLayoutElapsedMs,
      isGridLike,
      normalizeElapsedMs,
      normalizeOptimizer,
    } = helpers;
    const {
      applySolveRequestToPlanner,
      clearExpansionAdvice,
      clearRenderedResultState,
      renderResults,
      resetSolveTimer,
      setResultElapsed,
      setSolveState,
      syncPlannerFromState,
    } = callbacks;

    function readStoredEntries(storageKey) {
      try {
        const raw = globalObject.localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function writeStoredEntries(storageKey, entries) {
      globalObject.localStorage.setItem(storageKey, JSON.stringify(entries));
    }

    function populateSavedSelect(selectElement, entries, placeholder, labelBuilder = null) {
      selectElement.innerHTML = "";

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = placeholder;
      selectElement.append(emptyOption);

      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = labelBuilder ? labelBuilder(entry) : `${entry.name} • ${formatSavedTimestamp(entry.savedAt)}`;
        selectElement.append(option);
      });
    }

    function refreshSavedConfigOptions(selectedId = "") {
      const entries = readStoredEntries(CONFIG_STORAGE_KEY);
      populateSavedSelect(elements.savedConfigsSelect, entries, "Select a saved input setup");
      if (selectedId && entries.some((entry) => entry.id === selectedId)) {
        elements.savedConfigsSelect.value = selectedId;
      }
    }

    function refreshSavedLayoutOptions(selectedId = "") {
      const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
      populateSavedSelect(
        elements.savedLayoutsSelect,
        entries,
        "Select a saved layout",
        (entry) => `${entry.name} • ${formatElapsedTime(getSavedLayoutElapsedMs(entry))} • ${formatSavedTimestamp(entry.savedAt)}`
      );
      if (selectedId && entries.some((entry) => entry.id === selectedId)) {
        elements.savedLayoutsSelect.value = selectedId;
      }
    }

    function getConfigSnapshot() {
      return {
        grid: cloneGrid(state.grid),
        optimizer: state.optimizer,
        serviceTypes: cloneJson(state.serviceTypes),
        residentialTypes: cloneJson(state.residentialTypes),
        availableBuildings: cloneJson(state.availableBuildings),
        greedy: cloneJson(state.greedy),
        cpSat: cloneJson(state.cpSat),
        lns: cloneJson(state.lns),
      };
    }

    function applyConfigSnapshot(snapshot) {
      state.grid = isGridLike(snapshot?.grid) ? cloneGrid(snapshot.grid) : cloneGrid(sampleGrid);
      state.optimizer = normalizeOptimizer(snapshot?.optimizer);
      state.serviceTypes = Array.isArray(snapshot?.serviceTypes)
        ? snapshot.serviceTypes.map((entry) => ({
          avail: entry?.avail ?? "1",
          ...entry,
        }))
        : defaultServiceTypes.map((entry) => ({ ...entry }));
      state.residentialTypes = Array.isArray(snapshot?.residentialTypes)
        ? snapshot.residentialTypes.map((entry) => ({
          avail: entry?.avail ?? "1",
          ...entry,
        }))
        : defaultResidentialTypes.map((entry) => ({ ...entry }));
      state.availableBuildings = {
        services: snapshot?.availableBuildings?.services ?? "",
        residentials: snapshot?.availableBuildings?.residentials ?? "",
      };
      state.greedy = {
        ...state.greedy,
        randomSeed: "",
        ...(snapshot?.greedy ?? {}),
      };
      state.cpSat = {
        ...state.cpSat,
        randomSeed: "",
        ...(snapshot?.cpSat ?? {}),
      };
      state.lns = {
        ...state.lns,
        ...(snapshot?.lns ?? {}),
      };
    }

    function saveCurrentConfig() {
      const name = elements.configStorageName.value.trim() || `Input ${new Date().toLocaleString()}`;
      const entries = readStoredEntries(CONFIG_STORAGE_KEY);
      const existingIndex = entries.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
      const id = existingIndex >= 0 ? entries[existingIndex].id : createSavedEntryId();
      const nextEntry = {
        id,
        name,
        savedAt: new Date().toISOString(),
        snapshot: getConfigSnapshot(),
      };
      if (existingIndex >= 0) {
        entries[existingIndex] = nextEntry;
      } else {
        entries.unshift(nextEntry);
      }
      writeStoredEntries(CONFIG_STORAGE_KEY, entries);
      refreshSavedConfigOptions(id);
      elements.configStorageName.value = name;
      elements.configStorageStatus.textContent = `Saved input setup "${name}".`;
    }

    function loadSelectedConfig() {
      if (state.isSolving) {
        elements.configStorageStatus.textContent = "Wait for the current solve to finish before loading a different input setup.";
        return;
      }
      const selectedId = elements.savedConfigsSelect.value;
      if (!selectedId) {
        elements.configStorageStatus.textContent = "Choose a saved input setup first.";
        return;
      }
      const entry = readStoredEntries(CONFIG_STORAGE_KEY).find((item) => item.id === selectedId);
      if (!entry?.snapshot) {
        elements.configStorageStatus.textContent = "That saved input setup could not be found.";
        refreshSavedConfigOptions();
        return;
      }
      applyConfigSnapshot(entry.snapshot);
      clearRenderedResultState();
      state.resultContext = null;
      setResultElapsed(0);
      if (!state.isSolving) {
        resetSolveTimer();
      }
      syncPlannerFromState();
      renderResults();
      elements.configStorageName.value = entry.name;
      setSolveState(`Loaded input setup "${entry.name}".`);
      elements.configStorageStatus.textContent = `Loaded input setup "${entry.name}".`;
    }

    function deleteSelectedConfig() {
      const selectedId = elements.savedConfigsSelect.value;
      if (!selectedId) {
        elements.configStorageStatus.textContent = "Choose a saved input setup to delete.";
        return;
      }
      const entries = readStoredEntries(CONFIG_STORAGE_KEY);
      const entry = entries.find((item) => item.id === selectedId);
      writeStoredEntries(
        CONFIG_STORAGE_KEY,
        entries.filter((item) => item.id !== selectedId)
      );
      refreshSavedConfigOptions();
      elements.configStorageStatus.textContent = entry
        ? `Deleted input setup "${entry.name}".`
        : "Deleted the selected input setup.";
    }

    function saveCurrentLayout() {
      if (state.isSolving) {
        elements.layoutStorageStatus.textContent = "Wait for the current solve to finish before saving a layout.";
        return;
      }
      if (!state.result || !state.resultContext) {
        elements.layoutStorageStatus.textContent = "Run or load a result before saving a layout.";
        return;
      }
      const name = elements.layoutStorageName.value.trim() || `Layout ${new Date().toLocaleString()}`;
      const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
      const existingIndex = entries.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
      const id = existingIndex >= 0 ? entries[existingIndex].id : createSavedEntryId();
      const elapsedMs = normalizeElapsedMs(state.resultElapsedMs || state.solveTimerElapsedMs);
      const nextEntry = {
        id,
        name,
        savedAt: new Date().toISOString(),
        result: cloneJson(state.result),
        resultContext: cloneJson(state.resultContext),
        elapsedMs,
        continueCpSat: buildCpSatWarmStartCheckpoint(state.result, state.resultContext, elapsedMs),
      };
      if (existingIndex >= 0) {
        entries[existingIndex] = nextEntry;
      } else {
        entries.unshift(nextEntry);
      }
      writeStoredEntries(LAYOUT_STORAGE_KEY, entries);
      refreshSavedLayoutOptions(id);
      elements.layoutStorageName.value = name;
      elements.layoutStorageStatus.textContent = `Saved layout "${name}" with elapsed ${formatElapsedTime(elapsedMs)}.`;
    }

    function loadSelectedLayout() {
      if (state.isSolving) {
        elements.layoutStorageStatus.textContent = "Wait for the current solve to finish before loading a saved layout.";
        return;
      }
      const selectedId = elements.savedLayoutsSelect.value;
      if (!selectedId) {
        elements.layoutStorageStatus.textContent = "Choose a saved layout first.";
        return;
      }
      const entry = readStoredEntries(LAYOUT_STORAGE_KEY).find((item) => item.id === selectedId);
      if (!entry?.result || !entry?.resultContext) {
        elements.layoutStorageStatus.textContent = "That saved layout could not be found.";
        refreshSavedLayoutOptions();
        return;
      }
      clearExpansionAdvice();
      const loadedResultContext = cloneJson(entry.resultContext);
      state.selectedMapBuilding = null;
      state.selectedMapCell = null;
      state.layoutEditor.mode = "inspect";
      state.layoutEditor.pendingPlacement = null;
      state.layoutEditor.edited = false;
      state.layoutEditor.status = "";
      state.result = cloneJson(entry.result);
      state.resultIsLiveSnapshot = false;
      state.resultContext = loadedResultContext;
      state.resultError = "";
      applySolveRequestToPlanner(loadedResultContext, {
        preserveCpSatRuntime: false,
        optimizer: loadedResultContext?.params?.optimizer ?? state.optimizer,
      });
      const elapsedMs = getSavedLayoutElapsedMs(entry);
      setResultElapsed(elapsedMs, { syncTimerWhenIdle: true });
      renderResults();
      elements.layoutStorageName.value = entry.name;
      setSolveState(`Loaded saved layout "${entry.name}" and restored its planner settings.`);
      elements.layoutStorageStatus.textContent =
        `Displaying saved layout "${entry.name}" with its saved settings and elapsed ${formatElapsedTime(elapsedMs)}.`;
    }

    function deleteSelectedLayout() {
      const selectedId = elements.savedLayoutsSelect.value;
      if (!selectedId) {
        elements.layoutStorageStatus.textContent = "Choose a saved layout to delete.";
        return;
      }
      const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
      const entry = entries.find((item) => item.id === selectedId);
      writeStoredEntries(
        LAYOUT_STORAGE_KEY,
        entries.filter((item) => item.id !== selectedId)
      );
      refreshSavedLayoutOptions();
      elements.layoutStorageStatus.textContent = entry ? `Deleted layout "${entry.name}".` : "Deleted the selected layout.";
    }

    return {
      deleteSelectedConfig,
      deleteSelectedLayout,
      loadSelectedConfig,
      loadSelectedLayout,
      refreshSavedConfigOptions,
      refreshSavedLayoutOptions,
      saveCurrentConfig,
      saveCurrentLayout,
    };
  }

  globalObject.CityBuilderPersistence = Object.freeze({
    createPlannerPersistence,
  });
})(window);
