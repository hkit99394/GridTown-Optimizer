/**
 * @param {Window & { CityBuilderPersistence?: unknown, CityBuilderPersistenceValidation?: any }} globalObject
 */
(function attachPlannerPersistence(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {{ id: string, name: string, savedAt: string, [key: string]: any }} SavedEntry
   */

  /**
   * @typedef {object} PersistenceConstants
   * @property {string} CONFIG_STORAGE_KEY
   * @property {string} LAYOUT_STORAGE_KEY
   * @property {JsonObject[]} defaultResidentialTypes
   * @property {JsonObject[]} defaultServiceTypes
   * @property {any} sampleGrid
   */

  /**
   * @typedef {object} PersistenceHelpers
   * @property {(result: JsonObject, resultContext: JsonObject, elapsedMs: number) => JsonObject} buildCpSatWarmStartCheckpoint
   * @property {(grid: any) => any} cloneGrid
   * @property {<T>(value: T) => T} cloneJson
   * @property {() => string} createSavedEntryId
   * @property {(ms: number) => string} formatElapsedTime
   * @property {(savedAt: string) => string} formatSavedTimestamp
   * @property {(entry: SavedEntry) => number} getSavedLayoutElapsedMs
   * @property {(entry: SavedEntry) => number | null} [getSavedLayoutPopulation]
   * @property {(value: any) => boolean} isGridLike
   * @property {(value: any) => number} normalizeElapsedMs
   * @property {(optimizer: any) => string} normalizeOptimizer
   */

  /**
   * @typedef {object} PersistenceOptions
   * @property {JsonObject} state
   * @property {JsonObject} elements
   * @property {PersistenceConstants} constants
   * @property {PersistenceHelpers} helpers
   * @property {JsonObject} callbacks
   */

  /**
   * @param {PersistenceOptions} options
   */
  function createPlannerPersistence(options) {
    /**
     * @param {SavedEntry} entry
     * @returns {number | null}
     */
    function getDefaultSavedLayoutPopulation(entry) {
      const population = Number(
        entry?.result?.validation?.recomputedTotalPopulation ??
          entry?.result?.stats?.totalPopulation ??
          entry?.result?.solution?.totalPopulation ??
          entry?.continueCpSat?.incumbent?.objective?.value
      );
      return Number.isFinite(population) ? Math.max(0, Math.round(population)) : null;
    }

    const { state, elements, constants, helpers, callbacks } = options;
    const { CONFIG_STORAGE_KEY, LAYOUT_STORAGE_KEY, defaultResidentialTypes, defaultServiceTypes, sampleGrid } =
      constants;
    const {
      buildCpSatWarmStartCheckpoint,
      cloneGrid,
      cloneJson,
      createSavedEntryId,
      formatElapsedTime,
      formatSavedTimestamp,
      getSavedLayoutElapsedMs,
      getSavedLayoutPopulation = getDefaultSavedLayoutPopulation,
      isGridLike,
      normalizeElapsedMs,
      normalizeOptimizer
    } = helpers;
    const {
      applySolveRequestToPlanner,
      clearExpansionAdvice,
      clearRenderedResultState,
      renderResults,
      resetSolveTimer,
      setResultElapsed,
      setSolveState,
      syncPlannerFromState
    } = callbacks;
    const persistenceValidationGlobal =
      /** @type {Window & { CityBuilderPersistenceValidation?: { createPlannerPersistenceValidationHelpers?: (options: { isGridLike: (value: any) => boolean }) => any } }} */ (
        globalObject
      );
    if (!persistenceValidationGlobal.CityBuilderPersistenceValidation?.createPlannerPersistenceValidationHelpers) {
      throw new Error("Planner persistence validation helpers are not loaded.");
    }
    const { isValidSavedConfigEntry, isValidSavedLayoutEntry } =
      persistenceValidationGlobal.CityBuilderPersistenceValidation.createPlannerPersistenceValidationHelpers({
        isGridLike
      });

    /**
     * @param {string} storageKey
     * @returns {SavedEntry[]}
     */
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

    /**
     * @param {string} storageKey
     * @param {SavedEntry[]} entries
     */
    function writeStoredEntries(storageKey, entries) {
      globalObject.localStorage.setItem(storageKey, JSON.stringify(entries));
    }

    /**
     * @param {string} propertyName
     * @param {SavedEntry[]} entries
     * @returns {JsonObject}
     */
    function buildStorageExportPayload(propertyName, entries) {
      return {
        schemaVersion: 1,
        kind: `city-builder.planner-${propertyName}.v1`,
        exportedAt: new Date().toISOString(),
        [propertyName]: entries
      };
    }

    /**
     * @param {string} fileName
     * @param {JsonObject} payload
     */
    function downloadJsonFile(fileName, payload) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = globalObject.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      globalObject.URL.revokeObjectURL(url);
    }

    /**
     * @param {string} storageKey
     * @param {string} propertyName
     * @param {string} emptyLabel
     * @param {HTMLElement} statusElement
     * @returns {JsonObject | null}
     */
    function exportStoredEntries(storageKey, propertyName, emptyLabel, statusElement) {
      const entries = readStoredEntries(storageKey);
      if (!entries.length) {
        statusElement.textContent = `No saved ${emptyLabel} to export.`;
        return null;
      }
      const payload = buildStorageExportPayload(propertyName, entries);
      downloadJsonFile(`city-builder-${propertyName}-${new Date().toISOString().slice(0, 10)}.json`, payload);
      statusElement.textContent = `Exported ${entries.length} saved ${emptyLabel}.`;
      return payload;
    }

    /**
     * @param {any} value
     * @param {string} fallbackName
     * @param {string[]} requiredProperties
     * @param {(entry: SavedEntry) => boolean} validateEntry
     * @returns {SavedEntry | null}
     */
    function normalizeImportedEntry(value, fallbackName, requiredProperties, validateEntry) {
      if (!value || typeof value !== "object" || requiredProperties.some((property) => !value[property])) return null;
      const entry = cloneJson(value);
      entry.id = typeof entry.id === "string" && entry.id.trim() ? entry.id : createSavedEntryId();
      entry.name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : fallbackName;
      entry.savedAt =
        typeof entry.savedAt === "string" && entry.savedAt.trim() ? entry.savedAt : new Date().toISOString();
      return validateEntry(entry) ? entry : null;
    }

    /**
     * @param {string} importText
     * @param {string} propertyName
     * @param {string[]} requiredProperties
     * @param {string} fallbackPrefix
     * @param {(entry: SavedEntry) => boolean} validateEntry
     * @returns {SavedEntry[]}
     */
    function parseImportedEntries(importText, propertyName, requiredProperties, fallbackPrefix, validateEntry) {
      const parsed = JSON.parse(importText);
      const rawEntries = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.[propertyName])
          ? parsed[propertyName]
          : null;
      if (!rawEntries) throw new Error(`Import JSON must contain a ${propertyName} array.`);
      /** @type {SavedEntry[]} */
      const entries = [];
      rawEntries.forEach((entry, index) => {
        const normalizedEntry = normalizeImportedEntry(
          entry,
          `${fallbackPrefix} ${index + 1}`,
          requiredProperties,
          validateEntry
        );
        if (normalizedEntry) entries.push(normalizedEntry);
      });
      if (!entries.length)
        throw new Error(`Import JSON did not contain valid saved ${fallbackPrefix.toLowerCase()} entries.`);
      return entries;
    }

    /**
     * @param {string} storageKey
     * @param {SavedEntry[]} importedEntries
     * @returns {{ added: number, updated: number, total: number, selectedId: string }}
     */
    function mergeStoredEntries(storageKey, importedEntries) {
      const entries = readStoredEntries(storageKey);
      let added = 0;
      let updated = 0;
      importedEntries.forEach((entry) => {
        const lowerName = entry.name.toLowerCase();
        const existingIndex = entries.findIndex(
          (item) => item.id === entry.id || String(item.name ?? "").toLowerCase() === lowerName
        );
        if (existingIndex >= 0) {
          entries[existingIndex] = entry;
          updated += 1;
        } else {
          entries.unshift(entry);
          added += 1;
        }
      });
      writeStoredEntries(storageKey, entries);
      return { added, updated, total: importedEntries.length, selectedId: importedEntries[0]?.id ?? "" };
    }

    /**
     * @param {string} storageKey
     * @param {string} propertyName
     * @param {string[]} requiredProperties
     * @param {string} fallbackPrefix
     * @param {(entry: SavedEntry) => boolean} validateEntry
     * @param {HTMLElement} statusElement
     * @param {(selectedId?: string) => void} refreshOptions
     * @param {string} importText
     * @returns {{ added: number, updated: number, total: number, selectedId: string } | null}
     */
    function importStoredEntriesFromText(
      storageKey,
      propertyName,
      requiredProperties,
      fallbackPrefix,
      validateEntry,
      statusElement,
      refreshOptions,
      importText
    ) {
      try {
        const summary = mergeStoredEntries(
          storageKey,
          parseImportedEntries(importText, propertyName, requiredProperties, fallbackPrefix, validateEntry)
        );
        refreshOptions(summary.selectedId);
        statusElement.textContent = `Imported ${summary.total} saved ${fallbackPrefix.toLowerCase()} entries (${summary.added} new, ${summary.updated} updated).`;
        return summary;
      } catch (error) {
        statusElement.textContent = `Could not import saved ${fallbackPrefix.toLowerCase()} entries: ${
          error instanceof Error ? error.message : "Invalid JSON."
        }`;
        return null;
      }
    }

    /**
     * @param {File | undefined} file
     * @param {(importText: string) => any} importText
     * @param {HTMLElement} statusElement
     * @param {string} label
     */
    async function importStoredEntriesFromFile(file, importText, statusElement, label) {
      if (!file) {
        statusElement.textContent = `Choose a saved ${label} JSON file first.`;
        return null;
      }
      return importText(await file.text());
    }

    const PENDING_MANUAL_LAYOUT_ERROR = "Manual edits are pending validation. Use Validate layout when you're ready.";
    const PENDING_PERSISTED_LAYOUT_ERROR =
      "Saved layout validation is pending. Validate the layout before using it as a CP-SAT hint or LNS seed.";

    /**
     * @param {JsonObject | null | undefined} result
     * @returns {boolean}
     */
    function isManualLayoutResult(result) {
      return Boolean(result?.solution?.manualLayout || result?.stats?.manualLayout);
    }

    /**
     * @param {JsonObject | null | undefined} result
     * @returns {boolean}
     */
    function hasPendingManualLayoutValidation(result) {
      if (!isManualLayoutResult(result) || result?.validation?.valid === true) return false;
      return (
        Array.isArray(result?.validation?.errors) && result.validation.errors.includes(PENDING_MANUAL_LAYOUT_ERROR)
      );
    }

    /**
     * @param {JsonObject | null | undefined} result
     * @returns {boolean}
     */
    function hasPendingPersistedLayoutValidation(result) {
      return (
        result?.validation?.valid === false &&
        Array.isArray(result.validation.errors) &&
        result.validation.errors.includes(PENDING_PERSISTED_LAYOUT_ERROR)
      );
    }

    /**
     * @param {JsonObject} result
     * @returns {JsonObject}
     */
    function markResultPendingPersistedValidation(result) {
      const nextResult = cloneJson(result);
      nextResult.validation = {
        ...(nextResult.validation ?? {}),
        valid: false,
        errors: [PENDING_PERSISTED_LAYOUT_ERROR]
      };
      return nextResult;
    }

    /**
     * @param {SavedEntry} entry
     * @returns {SavedEntry}
     */
    function markImportedLayoutPendingPersistedValidation(entry) {
      if (entry?.result?.validation?.valid !== true) return entry;
      entry.result = markResultPendingPersistedValidation(entry.result);
      entry.layoutEditorPendingValidation = true;
      delete entry.continueCpSat;
      return entry;
    }

    /**
     * @param {SavedEntry} entry
     * @returns {boolean}
     */
    function readSavedLayoutPendingValidation(entry) {
      if (entry?.layoutEditorPendingValidation === true) return true;
      if (hasPendingPersistedLayoutValidation(entry?.result)) return true;
      if (entry?.layoutEditorPendingValidation === false) return false;
      return hasPendingManualLayoutValidation(entry?.result);
    }

    /**
     * @param {boolean} pendingValidation
     */
    function resetLayoutEditorForLoadedResult(pendingValidation) {
      state.selectedMapBuilding = null;
      state.selectedMapCell = null;
      state.layoutEditor.mode = "inspect";
      state.layoutEditor.pendingPlacement = null;
      state.layoutEditor.edited = false;
      state.layoutEditor.pendingValidation = pendingValidation;
      state.layoutEditor.status = "";
      state.layoutEditor.isApplying = false;
    }

    /**
     * @param {HTMLSelectElement} selectElement
     * @param {SavedEntry[]} entries
     * @param {string} placeholder
     * @param {((entry: SavedEntry) => string) | null} [labelBuilder]
     */
    function populateSavedSelect(selectElement, entries, placeholder, labelBuilder = null) {
      selectElement.innerHTML = "";

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = placeholder;
      selectElement.append(emptyOption);

      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = labelBuilder
          ? labelBuilder(entry)
          : `${entry.name} • ${formatSavedTimestamp(entry.savedAt)}`;
        selectElement.append(option);
      });
    }

    /**
     * @param {string} [selectedId]
     */
    function refreshSavedConfigOptions(selectedId = "") {
      const entries = readStoredEntries(CONFIG_STORAGE_KEY);
      populateSavedSelect(elements.savedConfigsSelect, entries, "Select a saved input setup");
      if (selectedId && entries.some((entry) => entry.id === selectedId)) {
        elements.savedConfigsSelect.value = selectedId;
      }
    }

    /**
     * @param {string} [selectedId]
     */
    function refreshSavedLayoutOptions(selectedId = "") {
      const entries = readStoredEntries(LAYOUT_STORAGE_KEY);
      populateSavedSelect(elements.savedLayoutsSelect, entries, "Select a saved layout", (entry) => {
        const population = getSavedLayoutPopulation(entry);
        const populationLabel =
          population === null ? "Population n/a" : `Population ${Number(population).toLocaleString()}`;
        return `${entry.name} • ${populationLabel} • ${formatSavedTimestamp(entry.savedAt)}`;
      });
      if (selectedId && entries.some((entry) => entry.id === selectedId)) {
        elements.savedLayoutsSelect.value = selectedId;
      }
    }

    /**
     * @returns {JsonObject}
     */
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
        auto: cloneJson(state.auto ?? { wallClockLimitSeconds: "" })
      };
    }

    /**
     * @param {JsonObject} snapshot
     */
    function applyConfigSnapshot(snapshot) {
      state.grid = isGridLike(snapshot?.grid) ? cloneGrid(snapshot.grid) : cloneGrid(sampleGrid);
      state.optimizer = normalizeOptimizer(snapshot?.optimizer);
      state.serviceTypes = Array.isArray(snapshot?.serviceTypes)
        ? snapshot.serviceTypes.map((entry) => ({
            avail: entry?.avail ?? "1",
            ...entry
          }))
        : defaultServiceTypes.map((entry) => ({ ...entry }));
      state.residentialTypes = Array.isArray(snapshot?.residentialTypes)
        ? snapshot.residentialTypes.map((entry) => ({
            avail: entry?.avail ?? "1",
            ...entry
          }))
        : defaultResidentialTypes.map((entry) => ({ ...entry }));
      state.availableBuildings = {
        services: snapshot?.availableBuildings?.services ?? "",
        residentials: snapshot?.availableBuildings?.residentials ?? ""
      };
      state.greedy = {
        ...state.greedy,
        randomSeed: "",
        ...(snapshot?.greedy ?? {})
      };
      state.cpSat = {
        ...state.cpSat,
        randomSeed: "",
        ...(snapshot?.cpSat ?? {})
      };
      state.lns = {
        ...state.lns,
        ...(snapshot?.lns ?? {})
      };
      state.auto = {
        ...(state.auto ?? { wallClockLimitSeconds: "" }),
        ...(snapshot?.auto ?? {})
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
        snapshot: getConfigSnapshot()
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

    function exportSavedConfigs() {
      return exportStoredEntries(CONFIG_STORAGE_KEY, "configs", "input setup", elements.configStorageStatus);
    }

    /**
     * @param {string} importText
     */
    function importSavedConfigsFromText(importText) {
      return importStoredEntriesFromText(
        CONFIG_STORAGE_KEY,
        "configs",
        ["snapshot"],
        "Input setup",
        isValidSavedConfigEntry,
        elements.configStorageStatus,
        refreshSavedConfigOptions,
        importText
      );
    }

    /**
     * @param {File | undefined} file
     */
    function importSavedConfigsFromFile(file) {
      return importStoredEntriesFromFile(file, importSavedConfigsFromText, elements.configStorageStatus, "input setup");
    }

    function loadSelectedConfig() {
      if (state.isSolving) {
        elements.configStorageStatus.textContent =
          "Wait for the current solve to finish before loading a different input setup.";
        return;
      }
      const selectedId = elements.savedConfigsSelect.value;
      if (!selectedId) {
        elements.configStorageStatus.textContent = "Choose a saved input setup first.";
        return;
      }
      const entry = readStoredEntries(CONFIG_STORAGE_KEY).find((item) => item.id === selectedId);
      if (!entry) {
        elements.configStorageStatus.textContent = "That saved input setup could not be found.";
        refreshSavedConfigOptions();
        return;
      }
      if (!isValidSavedConfigEntry(entry)) {
        elements.configStorageStatus.textContent = "That saved input setup is invalid and was not loaded.";
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
      let continueCpSat = null;
      let continuationStatus = "";
      try {
        continueCpSat = buildCpSatWarmStartCheckpoint(state.result, state.resultContext, elapsedMs);
      } catch (error) {
        continuationStatus = error instanceof Error ? ` ${error.message}` : "";
      }
      const nextEntry = {
        id,
        name,
        savedAt: new Date().toISOString(),
        result: cloneJson(state.result),
        resultContext: cloneJson(state.resultContext),
        elapsedMs,
        layoutEditorPendingValidation: Boolean(state.layoutEditor.pendingValidation),
        ...(continueCpSat ? { continueCpSat } : {})
      };
      if (existingIndex >= 0) {
        entries[existingIndex] = nextEntry;
      } else {
        entries.unshift(nextEntry);
      }
      writeStoredEntries(LAYOUT_STORAGE_KEY, entries);
      refreshSavedLayoutOptions(id);
      elements.layoutStorageName.value = name;
      elements.layoutStorageStatus.textContent = continueCpSat
        ? `Saved layout "${name}" with elapsed ${formatElapsedTime(elapsedMs)}.`
        : `Saved layout "${name}" with elapsed ${formatElapsedTime(elapsedMs)}.${continuationStatus}`;
    }

    function exportSavedLayouts() {
      return exportStoredEntries(LAYOUT_STORAGE_KEY, "layouts", "layout", elements.layoutStorageStatus);
    }

    /**
     * @param {string} importText
     */
    function importSavedLayoutsFromText(importText) {
      return importStoredEntriesFromText(
        LAYOUT_STORAGE_KEY,
        "layouts",
        ["result", "resultContext"],
        "Layout",
        (entry) => {
          if (!isValidSavedLayoutEntry(entry)) return false;
          markImportedLayoutPendingPersistedValidation(entry);
          return true;
        },
        elements.layoutStorageStatus,
        refreshSavedLayoutOptions,
        importText
      );
    }

    /**
     * @param {File | undefined} file
     */
    function importSavedLayoutsFromFile(file) {
      return importStoredEntriesFromFile(file, importSavedLayoutsFromText, elements.layoutStorageStatus, "layout");
    }

    function loadSelectedLayout() {
      if (state.isSolving) {
        elements.layoutStorageStatus.textContent =
          "Wait for the current solve to finish before loading a saved layout.";
        return;
      }
      const selectedId = elements.savedLayoutsSelect.value;
      if (!selectedId) {
        elements.layoutStorageStatus.textContent = "Choose a saved layout first.";
        return;
      }
      const entry = readStoredEntries(LAYOUT_STORAGE_KEY).find((item) => item.id === selectedId);
      if (!entry) {
        elements.layoutStorageStatus.textContent = "That saved layout could not be found.";
        refreshSavedLayoutOptions();
        return;
      }
      if (!isValidSavedLayoutEntry(entry)) {
        elements.layoutStorageStatus.textContent = "That saved layout is invalid and was not loaded.";
        refreshSavedLayoutOptions();
        return;
      }
      clearExpansionAdvice();
      const loadedResultContext = cloneJson(entry.resultContext);
      const persistedValidResultNeedsValidation = entry.result?.validation?.valid === true;
      const loadedResult = persistedValidResultNeedsValidation
        ? markResultPendingPersistedValidation(entry.result)
        : cloneJson(entry.result);
      resetLayoutEditorForLoadedResult(readSavedLayoutPendingValidation(entry) || persistedValidResultNeedsValidation);
      state.result = loadedResult;
      state.solveProgressLog = Array.isArray(entry.result?.progressLog) ? cloneJson(entry.result.progressLog) : [];
      state.resultIsLiveSnapshot = false;
      state.resultContext = loadedResultContext;
      state.resultError = "";
      applySolveRequestToPlanner(loadedResultContext, {
        preserveCpSatRuntime: false,
        optimizer: loadedResultContext?.params?.optimizer ?? state.optimizer
      });
      const elapsedMs = getSavedLayoutElapsedMs(entry);
      setResultElapsed(elapsedMs, { syncTimerWhenIdle: true });
      renderResults();
      elements.layoutStorageName.value = entry.name;
      setSolveState(`Loaded saved layout "${entry.name}" and restored its planner settings.`);
      elements.layoutStorageStatus.textContent = `Displaying saved layout "${entry.name}" with its saved settings and elapsed ${formatElapsedTime(elapsedMs)}.`;
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
      elements.layoutStorageStatus.textContent = entry
        ? `Deleted layout "${entry.name}".`
        : "Deleted the selected layout.";
    }

    return {
      deleteSelectedConfig,
      deleteSelectedLayout,
      exportSavedConfigs,
      exportSavedLayouts,
      importSavedConfigsFromFile,
      importSavedConfigsFromText,
      importSavedLayoutsFromFile,
      importSavedLayoutsFromText,
      loadSelectedConfig,
      loadSelectedLayout,
      refreshSavedConfigOptions,
      refreshSavedLayoutOptions,
      saveCurrentConfig,
      saveCurrentLayout
    };
  }

  const plannerPersistenceGlobal = /** @type {Window & { CityBuilderPersistence?: unknown }} */ (globalObject);
  plannerPersistenceGlobal.CityBuilderPersistence = Object.freeze({
    createPlannerPersistence
  });
})(window);
