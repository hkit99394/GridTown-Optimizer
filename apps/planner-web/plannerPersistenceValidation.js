/**
 * @param {Window & { CityBuilderPersistenceValidation?: unknown }} globalObject
 */
(function attachPlannerPersistenceValidation(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {{ isGridLike: (value: any) => boolean }} PersistenceValidationOptions
   */

  /**
   * @param {PersistenceValidationOptions} options
   */
  function createPlannerPersistenceValidationHelpers(options) {
    const { isGridLike } = options;
    const validOptimizers = new Set(["auto", "cp-sat", "greedy", "lns"]);

    /**
     * @param {unknown} value
     * @returns {value is JsonObject}
     */
    function isJsonObject(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    /**
     * @param {unknown} value
     * @param {number} [minimum]
     * @returns {boolean}
     */
    function isIntegerAtLeast(value, minimum = 0) {
      return typeof value === "number" && Number.isInteger(value) && value >= minimum;
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isRoadKey(value) {
      if (typeof value !== "string") return false;
      const match = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(value);
      if (!match) return false;
      const row = Number(match[1]);
      const col = Number(match[2]);
      return Number.isSafeInteger(row) && Number.isSafeInteger(col);
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isJsonObjectArray(value) {
      return Array.isArray(value) && value.every(isJsonObject);
    }

    /**
     * @param {unknown} value
     * @param {number} [minimum]
     * @returns {boolean}
     */
    function isCatalogInteger(value, minimum = 0) {
      if (typeof value === "number") return Number.isInteger(value) && value >= minimum;
      const text = String(value ?? "").trim();
      if (!/^\d+$/.test(text)) return false;
      const number = Number(text);
      return Number.isInteger(number) && number >= minimum;
    }

    /**
     * @param {unknown} value
     * @param {string} separator
     * @returns {[number, number] | null}
     */
    function parseCatalogPositivePair(value, separator) {
      const parts = String(value ?? "")
        .trim()
        .toLowerCase()
        .split(separator)
        .map((part) => part.trim());
      if (parts.length !== 2 || !parts.every((part) => /^\d+$/.test(part))) return null;
      const pair = parts.map((part) => Number(part));
      if (!pair.every((part) => Number.isInteger(part) && part > 0)) return null;
      return /** @type {[number, number]} */ (pair);
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isOptionalCatalogName(value) {
      return value === undefined || typeof value === "string";
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isOptionalCatalogAvailability(value) {
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        isCatalogInteger(value)
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidConfigServiceType(value) {
      if (!isJsonObject(value) || !isOptionalCatalogName(value.name)) return false;
      if (!isCatalogInteger(value.bonus)) return false;
      if (!isOptionalCatalogAvailability(value.avail)) return false;

      const size = parseCatalogPositivePair(value.size, "x");
      const effective = parseCatalogPositivePair(value.effective, "x");
      if (!size || !effective) return false;

      const [rows, cols] = size;
      const [effectiveRows, effectiveCols] = effective;
      const rangeByRows = (effectiveRows - rows) / 2;
      const rangeByCols = (effectiveCols - cols) / 2;
      return (
        Number.isInteger(rangeByRows) &&
        Number.isInteger(rangeByCols) &&
        rangeByRows === rangeByCols &&
        rangeByRows >= 0
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidConfigResidentialType(value) {
      if (!isJsonObject(value) || !isOptionalCatalogName(value.name)) return false;
      if (!parseCatalogPositivePair(value.size, "x")) return false;
      if (!parseCatalogPositivePair(String(value.resident ?? "").replaceAll(" ", ""), "/")) return false;
      return isOptionalCatalogAvailability(value.avail);
    }

    /**
     * @param {unknown} value
     * @param {(entry: unknown) => boolean} validateEntry
     * @returns {boolean}
     */
    function isOptionalCatalogArray(value, validateEntry) {
      return value === undefined || (Array.isArray(value) && value.every(validateEntry));
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isOptionalJsonObject(value) {
      return value === undefined || isJsonObject(value);
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isOptionalJsonObjectArray(value) {
      return value === undefined || isJsonObjectArray(value);
    }

    /**
     * @param {unknown} settings
     * @param {{ requireGrid: boolean }} options
     * @returns {boolean}
     */
    function hasValidPlannerSettings(settings, options) {
      if (!isJsonObject(settings)) return false;
      if (options.requireGrid && !isGridLike(settings.grid)) return false;
      if (settings.optimizer !== undefined) {
        if (typeof settings.optimizer !== "string" || !validOptimizers.has(settings.optimizer)) return false;
      }
      if (!isOptionalJsonObjectArray(settings.serviceTypes)) return false;
      if (!isOptionalJsonObjectArray(settings.residentialTypes)) return false;
      if (!isOptionalJsonObject(settings.availableBuildings)) return false;
      if (!isOptionalJsonObject(settings.greedy)) return false;
      if (!isOptionalJsonObject(settings.cpSat)) return false;
      if (!isOptionalJsonObject(settings.lns)) return false;
      if (!isOptionalJsonObject(settings.auto)) return false;
      if (settings.cpSat?.portfolio !== undefined && !isJsonObject(settings.cpSat.portfolio)) return false;
      return true;
    }

    /**
     * @param {unknown} settings
     * @returns {boolean}
     */
    function hasValidSavedConfigCatalogSettings(settings) {
      return (
        isJsonObject(settings) &&
        isOptionalCatalogArray(settings.serviceTypes, isValidConfigServiceType) &&
        isOptionalCatalogArray(settings.residentialTypes, isValidConfigResidentialType)
      );
    }

    /**
     * @param {unknown} value
     * @param {{ includeRange: boolean }} options
     * @returns {boolean}
     */
    function isValidPlacement(value, options) {
      return (
        isJsonObject(value) &&
        isIntegerAtLeast(value.r) &&
        isIntegerAtLeast(value.c) &&
        isIntegerAtLeast(value.rows, 1) &&
        isIntegerAtLeast(value.cols, 1) &&
        (!options.includeRange || isIntegerAtLeast(value.range))
      );
    }

    /**
     * @param {unknown} value
     * @param {number} expectedLength
     * @param {number} [minimum]
     * @returns {boolean}
     */
    function isIntegerArrayWithLength(value, expectedLength, minimum = 0) {
      return (
        Array.isArray(value) &&
        value.length === expectedLength &&
        value.every((entry) => isIntegerAtLeast(entry, minimum))
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidSerializedSolution(value) {
      if (!isJsonObject(value)) return false;
      if (!Array.isArray(value.roads) || !value.roads.every(isRoadKey)) return false;
      const services = value.services;
      if (!Array.isArray(services) || !services.every((service) => isValidPlacement(service, { includeRange: true }))) {
        return false;
      }
      if (!isIntegerArrayWithLength(value.serviceTypeIndices, services.length, -1)) return false;
      if (!isIntegerArrayWithLength(value.servicePopulationIncreases, services.length)) return false;
      const residentials = value.residentials;
      if (
        !Array.isArray(residentials) ||
        !residentials.every((residential) => isValidPlacement(residential, { includeRange: false }))
      ) {
        return false;
      }
      if (!isIntegerArrayWithLength(value.residentialTypeIndices, residentials.length, -1)) return false;
      if (!isIntegerArrayWithLength(value.populations, residentials.length)) return false;
      return isIntegerAtLeast(value.totalPopulation);
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidResultValidation(value) {
      if (!isJsonObject(value) || typeof value.valid !== "boolean") return false;
      if (
        value.errors !== undefined &&
        (!Array.isArray(value.errors) || !value.errors.every((entry) => typeof entry === "string"))
      ) {
        return false;
      }
      if (
        value.recomputedPopulations !== undefined &&
        (!Array.isArray(value.recomputedPopulations) ||
          !value.recomputedPopulations.every((entry) => isIntegerAtLeast(entry)))
      ) {
        return false;
      }
      if (value.recomputedTotalPopulation !== undefined && !isIntegerAtLeast(value.recomputedTotalPopulation)) {
        return false;
      }
      if (
        value.mapRows !== undefined &&
        (!Array.isArray(value.mapRows) || !value.mapRows.every((entry) => typeof entry === "string"))
      ) {
        return false;
      }
      return value.mapText === undefined || typeof value.mapText === "string";
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidResultStats(value) {
      if (!isJsonObject(value)) return false;
      if (
        value.optimizer !== undefined &&
        (typeof value.optimizer !== "string" || !validOptimizers.has(value.optimizer))
      ) {
        return false;
      }
      if (
        value.activeOptimizer !== undefined &&
        (typeof value.activeOptimizer !== "string" || !validOptimizers.has(value.activeOptimizer))
      ) {
        return false;
      }
      if (value.manualLayout !== undefined && typeof value.manualLayout !== "boolean") return false;
      return ["totalPopulation", "roadCount", "serviceCount", "residentialCount"].every(
        (property) => value[property] === undefined || isIntegerAtLeast(value[property])
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidSavedResult(value) {
      if (!isJsonObject(value) || !isValidSerializedSolution(value.solution)) return false;
      if (value.validation !== undefined && !isValidResultValidation(value.validation)) return false;
      if (value.stats !== undefined && !isValidResultStats(value.stats)) return false;
      if (
        value.progressLog !== undefined &&
        (!Array.isArray(value.progressLog) || !value.progressLog.every(isJsonObject))
      ) {
        return false;
      }
      return true;
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidResultContext(value) {
      return (
        isJsonObject(value) && isGridLike(value.grid) && hasValidPlannerSettings(value.params, { requireGrid: false })
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function hasValidSavedEntryMetadata(value) {
      return (
        isJsonObject(value) &&
        typeof value.id === "string" &&
        value.id.trim() !== "" &&
        typeof value.name === "string" &&
        value.name.trim() !== "" &&
        typeof value.savedAt === "string" &&
        value.savedAt.trim() !== ""
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidSavedConfigEntry(value) {
      return (
        hasValidSavedEntryMetadata(value) &&
        isJsonObject(value) &&
        hasValidPlannerSettings(value.snapshot, { requireGrid: true }) &&
        hasValidSavedConfigCatalogSettings(value.snapshot)
      );
    }

    /**
     * @param {unknown} value
     * @returns {boolean}
     */
    function isValidSavedLayoutEntry(value) {
      return (
        hasValidSavedEntryMetadata(value) &&
        isJsonObject(value) &&
        isValidSavedResult(value.result) &&
        isValidResultContext(value.resultContext) &&
        (value.elapsedMs === undefined || isIntegerAtLeast(value.elapsedMs)) &&
        (value.layoutEditorPendingValidation === undefined || typeof value.layoutEditorPendingValidation === "boolean")
      );
    }

    return Object.freeze({
      isValidSavedConfigEntry,
      isValidSavedLayoutEntry
    });
  }

  const validationGlobal =
    /** @type {Window & { CityBuilderPersistenceValidation?: unknown }} */
    (globalObject);

  validationGlobal.CityBuilderPersistenceValidation = Object.freeze({
    createPlannerPersistenceValidationHelpers
  });
})(window);
