/**
 * @param {Window & { CityBuilderShared?: unknown }} globalObject
 */
(function attachPlannerShared(globalObject) {
  /**
   * @typedef {Record<string, any>} JsonObject
   * @typedef {number[][]} PlannerGrid
   * @typedef {{ r: number, c: number, rows: number, cols: number, range?: number, [key: string]: any }} CandidatePlacement
   * @typedef {JsonObject & { populations?: number[], residentials?: CandidatePlacement[], residentialTypeIndices?: number[], roads?: string[], servicePopulationIncreases?: number[], services?: CandidatePlacement[], serviceTypeIndices?: number[] }} CheckpointSolution
   * @typedef {{ kind: "services" | "residentials", rows: JsonObject[] }} CatalogImportBlock
   */

  const CP_SAT_PORTFOLIO_CAPABILITY_LIMITS = Object.freeze({
    defaultWorkers: 3,
    defaultPerWorkerTimeLimitSeconds: 30,
    maxWorkers: 8,
    maxTotalWorkerThreads: 8,
    maxPerWorkerThreads: 4,
    maxTotalCpuBudgetSeconds: 8 * 60 * 60
  });

  /**
   * @param {PlannerGrid} grid
   * @returns {PlannerGrid}
   */
  function cloneGrid(grid) {
    return grid.map((row) => [...row]);
  }

  /**
   * @param {number} rows
   * @param {number} cols
   * @param {number} [value]
   * @returns {PlannerGrid}
   */
  function createGrid(rows, cols, value = 1) {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
  }

  /**
   * @template T
   * @param {T} value
   * @returns {T}
   */
  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * @returns {string}
   */
  function createSavedEntryId() {
    return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
      entries.sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  /**
   * @param {string} value
   * @returns {string}
   */
  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  /**
   * @param {string[]} values
   * @returns {string[]}
   */
  function sortedUnique(values) {
    return Array.from(new Set(values)).sort();
  }

  /**
   * @param {CandidatePlacement} service
   * @param {number} typeIndex
   * @returns {string}
   */
  function buildServiceCandidateKey(service, typeIndex) {
    return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
  }

  /**
   * @param {CandidatePlacement} residential
   * @param {number} typeIndex
   * @returns {string}
   */
  function buildResidentialCandidateKey(residential, typeIndex) {
    return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
  }

  /**
   * @param {JsonObject | null | undefined} serviceType
   * @returns {JsonObject}
   */
  function serializeServiceTypeForCatalog(serviceType) {
    return {
      name: serviceType?.name ?? "",
      bonus: String(serviceType?.bonus ?? ""),
      size: `${serviceType?.rows ?? 0}x${serviceType?.cols ?? 0}`,
      effective: `${(serviceType?.rows ?? 0) + (serviceType?.range ?? 0) * 2}x${(serviceType?.cols ?? 0) + (serviceType?.range ?? 0) * 2}`,
      avail: String(serviceType?.avail ?? 1)
    };
  }

  /**
   * @param {JsonObject | null | undefined} residentialType
   * @returns {JsonObject}
   */
  function serializeResidentialTypeForCatalog(residentialType) {
    return {
      name: residentialType?.name ?? "",
      resident: `${residentialType?.min ?? 0}/${residentialType?.max ?? 0}`,
      size: `${residentialType?.w ?? 0}x${residentialType?.h ?? 0}`,
      avail: String(residentialType?.avail ?? "")
    };
  }

  /**
   * @param {JsonObject} request
   * @returns {JsonObject}
   */
  function buildCpSatContinuationModelInput(request) {
    const params = request?.params ?? {};
    const modelParams = {
      optimizer: "cp-sat",
      ...(Array.isArray(params.serviceTypes) ? { serviceTypes: cloneJson(params.serviceTypes) } : {}),
      ...(Array.isArray(params.residentialTypes) ? { residentialTypes: cloneJson(params.residentialTypes) } : {}),
      ...(params.residentialSettings ? { residentialSettings: cloneJson(params.residentialSettings) } : {}),
      ...(params.basePop != null ? { basePop: params.basePop } : {}),
      ...(params.maxPop != null ? { maxPop: params.maxPop } : {}),
      ...(params.availableBuildings ? { availableBuildings: cloneJson(params.availableBuildings) } : {}),
      ...(params.maxServices != null ? { maxServices: params.maxServices } : {}),
      ...(params.maxResidentials != null ? { maxResidentials: params.maxResidentials } : {})
    };

    return {
      grid: cloneGrid(request.grid),
      params: modelParams
    };
  }

  /**
   * @param {JsonObject} modelInput
   * @returns {string}
   */
  function computeCpSatModelFingerprint(modelInput) {
    return `fnv1a:${hashString(stableStringify(modelInput))}`;
  }

  /**
   * @param {unknown} value
   * @returns {number}
   */
  function normalizeElapsedMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.round(number);
  }

  const INVALID_CONTINUATION_LAYOUT_ERROR =
    "Only valid layouts can be reused as a CP-SAT hint or LNS seed. Fix the validation errors first.";
  const MISSING_CONTINUATION_VALIDATION_ERROR =
    "This layout is missing validation metadata. Re-evaluate or re-save it before reusing it as a CP-SAT hint or LNS seed.";

  /**
   * @param {JsonObject | null | undefined} result
   * @returns {JsonObject}
   */
  function validateContinuationSourceResult(result) {
    if (!result?.validation || result.validation.valid !== true) {
      if (result?.validation?.valid === false) {
        throw new Error(INVALID_CONTINUATION_LAYOUT_ERROR);
      }
      throw new Error(MISSING_CONTINUATION_VALIDATION_ERROR);
    }
    return result.validation;
  }

  /**
   * @param {JsonObject} result
   * @param {JsonObject} resultContext
   * @param {number} elapsedMs
   * @returns {JsonObject}
   */
  function buildCpSatWarmStartCheckpoint(result, resultContext, elapsedMs) {
    if (!result?.solution || !resultContext?.grid || !resultContext?.params) {
      throw new Error("This saved layout does not include enough data to build a CP-SAT hint.");
    }
    const validation = validateContinuationSourceResult(result);

    const solution = /** @type {CheckpointSolution} */ (result.solution);
    const modelInput = buildCpSatContinuationModelInput(resultContext);
    const roadKeys = sortedUnique(Array.isArray(solution.roads) ? solution.roads : []);
    const serviceCandidateKeys = sortedUnique(
      (solution.services ?? []).map((service, index) =>
        buildServiceCandidateKey(service, solution.serviceTypeIndices?.[index] ?? -1)
      )
    );
    const residentialCandidateKeys = sortedUnique(
      (solution.residentials ?? []).map((residential, index) =>
        buildResidentialCandidateKey(residential, solution.residentialTypeIndices?.[index] ?? -1)
      )
    );
    const candidateUniverseHash = `fnv1a:${hashString(
      stableStringify({
        roads: roadKeys,
        services: serviceCandidateKeys,
        residentials: residentialCandidateKeys
      })
    )}`;

    return {
      kind: "city-builder.cp-sat-checkpoint",
      version: 1,
      compatibility: {
        modelEncodingVersion: "cp-sat-layout-v1",
        candidateKeyVersion: 1,
        modelFingerprint: computeCpSatModelFingerprint(modelInput),
        candidateUniverseHash,
        createdWith: {}
      },
      modelInput,
      runtimeDefaults: {
        ...(resultContext.params?.cpSat?.numWorkers != null
          ? { numWorkers: resultContext.params.cpSat.numWorkers }
          : {}),
        ...(resultContext.params?.cpSat?.randomSeed != null
          ? { randomSeed: resultContext.params.cpSat.randomSeed }
          : {}),
        ...(resultContext.params?.cpSat?.randomizeSearch != null
          ? { randomizeSearch: resultContext.params.cpSat.randomizeSearch }
          : {}),
        ...(resultContext.params?.cpSat?.logSearchProgress != null
          ? { logSearchProgress: resultContext.params.cpSat.logSearchProgress }
          : {})
      },
      incumbent: {
        status: solution.cpSatStatus === "OPTIMAL" ? "OPTIMAL" : "FEASIBLE",
        objective: {
          name: "totalPopulation",
          sense: "maximize",
          value: Number(validation.recomputedTotalPopulation ?? solution.totalPopulation ?? 0),
          bestBound: null
        },
        elapsedMs: normalizeElapsedMs(elapsedMs),
        stoppedByUser: Boolean(solution.stoppedByUser || result.stats?.stoppedByUser)
      },
      hint: {
        roadKeys,
        serviceCandidateKeys,
        residentialCandidateKeys,
        solution: {
          roads: roadKeys,
          services: (solution.services ?? []).map((service, index) => ({
            r: service.r,
            c: service.c,
            rows: service.rows,
            cols: service.cols,
            range: service.range,
            typeIndex: solution.serviceTypeIndices?.[index] ?? -1,
            bonus: solution.servicePopulationIncreases?.[index] ?? 0
          })),
          residentials: (solution.residentials ?? []).map((residential, index) => ({
            r: residential.r,
            c: residential.c,
            rows: residential.rows,
            cols: residential.cols,
            typeIndex: solution.residentialTypeIndices?.[index] ?? -1,
            population: solution.populations?.[index] ?? 0
          })),
          populations: cloneJson(solution.populations ?? []),
          totalPopulation: Number(validation.recomputedTotalPopulation ?? solution.totalPopulation ?? 0)
        }
      },
      resumePolicy: {
        requireExactModelMatch: true,
        applyHints: true,
        repairHint: true,
        fixVariablesToHintedValue: false,
        objectiveCutoff: {
          op: ">=",
          value: Number(validation.recomputedTotalPopulation ?? solution.totalPopulation ?? 0),
          preferStrictImprove: false
        }
      }
    };
  }

  /**
   * @param {string} savedAt
   * @returns {string}
   */
  function formatSavedTimestamp(savedAt) {
    const date = new Date(savedAt);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
  }

  /**
   * @param {unknown} value
   * @param {number} fallback
   * @param {number} [min]
   * @returns {number}
   */
  function clampInteger(value, fallback, min = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.floor(number));
  }

  /**
   * @param {unknown} value
   * @param {number} [min]
   * @returns {number | undefined}
   */
  function readOptionalInteger(value, min = 1) {
    if (value === "" || value == null) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    return Math.max(min, Math.floor(number));
  }

  /**
   * @returns {string}
   */
  function createSolveRequestId() {
    return `solve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise((resolve) => {
      globalObject.setTimeout(resolve, ms);
    });
  }

  /**
   * @param {number} ms
   * @returns {string}
   */
  function formatElapsedTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  /**
   * @param {JsonObject | null | undefined} entry
   * @returns {number}
   */
  function getSavedLayoutElapsedMs(entry) {
    return normalizeElapsedMs(entry?.elapsedMs ?? entry?.resultElapsedMs ?? entry?.result?.stats?.elapsedMs ?? 0);
  }

  /**
   * @param {unknown} value
   * @returns {number | null}
   */
  function readFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /**
   * @param {JsonObject | null | undefined} entry
   * @returns {number | null}
   */
  function getSavedLayoutPopulation(entry) {
    const directPopulation =
      readFiniteNumber(entry?.result?.validation?.recomputedTotalPopulation) ??
      readFiniteNumber(entry?.result?.stats?.totalPopulation) ??
      readFiniteNumber(entry?.result?.solution?.totalPopulation) ??
      readFiniteNumber(entry?.continueCpSat?.incumbent?.objective?.value);
    if (directPopulation !== null) {
      return Math.max(0, Math.round(directPopulation));
    }

    const populations = entry?.result?.solution?.populations;
    if (!Array.isArray(populations)) return null;
    const summedPopulation = populations.reduce((sum, population) => {
      const number = readFiniteNumber(population);
      return number === null ? sum : sum + number;
    }, 0);
    return Math.max(0, Math.round(summedPopulation));
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /**
   * @param {unknown} line
   * @returns {string[]}
   */
  function splitTabularLine(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return [];
    if (trimmed.includes("\t")) {
      return trimmed.split("\t").map((cell) => cell.trim());
    }
    return trimmed.split(/\s{2,}/).map((cell) => cell.trim());
  }

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeHeaderName(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }

  /**
   * @param {string[]} lines
   * @returns {CatalogImportBlock | null}
   */
  function parseCatalogImportBlock(lines) {
    if (!lines.length) return null;
    const header = splitTabularLine(lines[0]).map(normalizeHeaderName);
    const rows = lines
      .slice(1)
      .map(splitTabularLine)
      .filter((cells) => cells.length > 0);

    if (header.includes("name") && header.includes("resident") && header.includes("size") && header.includes("avail")) {
      const nameIndex = header.indexOf("name");
      const residentIndex = header.indexOf("resident");
      const sizeIndex = header.indexOf("size");
      const availIndex = header.indexOf("avail");
      return {
        kind: "residentials",
        rows: rows.map((cells) => ({
          name: cells[nameIndex] ?? "",
          resident: cells[residentIndex] ?? "",
          size: cells[sizeIndex] ?? "",
          avail: cells[availIndex] ?? ""
        }))
      };
    }

    if (
      header.includes("name") &&
      header.includes("bonus") &&
      header.includes("size") &&
      header.includes("effective")
    ) {
      const nameIndex = header.indexOf("name");
      const bonusIndex = header.indexOf("bonus");
      const sizeIndex = header.indexOf("size");
      const effectiveIndex = header.indexOf("effective");
      const availIndex = header.indexOf("avail");
      return {
        kind: "services",
        rows: rows.map((cells) => ({
          name: cells[nameIndex] ?? "",
          bonus: cells[bonusIndex] ?? "",
          size: cells[sizeIndex] ?? "",
          effective: cells[effectiveIndex] ?? "",
          avail: availIndex >= 0 ? (cells[availIndex] ?? "") : "1"
        }))
      };
    }

    return null;
  }

  /**
   * @param {unknown} text
   * @returns {{ services: JsonObject[] | null, residentials: JsonObject[] | null }}
   */
  function parseCatalogImportText(text) {
    const blocks = String(text ?? "")
      .split(/\r?\n\s*\r?\n+/)
      .map((block) =>
        block
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
      .filter((lines) => lines.length > 0);

    let importedServices = null;
    let importedResidentials = null;

    for (const block of blocks) {
      const parsed = parseCatalogImportBlock(block);
      if (!parsed) continue;
      if (parsed.kind === "services") importedServices = parsed.rows;
      if (parsed.kind === "residentials") importedResidentials = parsed.rows;
    }

    if (!importedServices && !importedResidentials) {
      throw new Error("No supported table headers were found. Paste a service table, a residential table, or both.");
    }

    return {
      services: importedServices,
      residentials: importedResidentials
    };
  }

  /**
   * @param {unknown} optimizer
   * @returns {"auto" | "greedy" | "cp-sat" | "lns"}
   */
  function normalizeOptimizer(optimizer) {
    return optimizer === "auto" || optimizer === "greedy" || optimizer === "cp-sat" || optimizer === "lns"
      ? optimizer
      : "auto";
  }

  /**
   * @param {unknown} value
   * @param {string} separator
   * @param {string} label
   * @returns {[number, number]}
   */
  function parsePair(value, separator, label) {
    const text = String(value ?? "")
      .trim()
      .toLowerCase();
    const parts = text.split(separator).map((part) => Number.parseInt(part.trim(), 10));
    if (parts.length !== 2 || parts.some((part) => !Number.isInteger(part) || part <= 0)) {
      throw new Error(`${label} must be in the format A${separator}B using positive integers.`);
    }
    return /** @type {[number, number]} */ (parts);
  }

  /**
   * @param {unknown} value
   * @param {string} label
   * @param {number} [min]
   * @returns {number}
   */
  function parseIntegerField(value, label, min = 0) {
    const number = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isInteger(number) || number < min) {
      throw new Error(`${label} must be an integer greater than or equal to ${min}.`);
    }
    return number;
  }

  /**
   * @param {JsonObject} entry
   * @param {number} index
   * @returns {JsonObject}
   */
  function parseServiceCatalogEntry(entry, index) {
    const name = String(entry.name ?? "").trim();
    const [rows, cols] = parsePair(entry.size, "x", `Service ${index + 1} size`);
    const [effectiveRows, effectiveCols] = parsePair(entry.effective, "x", `Service ${index + 1} effective area`);
    const rangeByRows = (effectiveRows - rows) / 2;
    const rangeByCols = (effectiveCols - cols) / 2;
    const rawAvail = String(entry.avail ?? "").trim();
    if (
      !Number.isInteger(rangeByRows) ||
      !Number.isInteger(rangeByCols) ||
      rangeByRows !== rangeByCols ||
      rangeByRows < 0
    ) {
      throw new Error(
        `Service ${index + 1}${name ? ` (${name})` : ""} needs an Effective value that matches Size with the same outward range.`
      );
    }
    return {
      name: name || `Service ${index + 1}`,
      rows,
      cols,
      bonus: parseIntegerField(entry.bonus, `Service ${index + 1} bonus`, 0),
      range: rangeByRows,
      avail: rawAvail ? parseIntegerField(rawAvail, `Service ${index + 1} avail`, 0) : 1,
      allowRotation: true
    };
  }

  /**
   * @param {JsonObject} entry
   * @param {number} index
   * @returns {JsonObject}
   */
  function parseResidentialCatalogEntry(entry, index) {
    const name = String(entry.name ?? "").trim();
    const [w, h] = parsePair(entry.size, "x", `Residential ${index + 1} size`);
    const [min, max] = parsePair(
      String(entry.resident ?? "").replaceAll(" ", ""),
      "/",
      `Residential ${index + 1} resident`
    );
    return {
      name: name || `Residential ${index + 1}`,
      w,
      h,
      min: Math.min(min, max),
      max: Math.max(min, max),
      avail: parseIntegerField(entry.avail, `Residential ${index + 1} avail`, 0)
    };
  }

  /**
   * @param {unknown} grid
   * @returns {grid is PlannerGrid}
   */
  function isGridLike(grid) {
    return (
      Array.isArray(grid) &&
      grid.length > 0 &&
      grid.every(
        (row) => Array.isArray(row) && row.length === grid[0].length && row.every((cell) => cell === 0 || cell === 1)
      )
    );
  }

  const sharedGlobal = /** @type {Window & { CityBuilderShared?: unknown }} */ (globalObject);

  sharedGlobal.CityBuilderShared = Object.freeze({
    CP_SAT_PORTFOLIO_CAPABILITY_LIMITS,
    buildCpSatContinuationModelInput,
    buildCpSatWarmStartCheckpoint,
    buildResidentialCandidateKey,
    buildServiceCandidateKey,
    clampInteger,
    cloneGrid,
    cloneJson,
    computeCpSatModelFingerprint,
    createGrid,
    createSavedEntryId,
    createSolveRequestId,
    delay,
    escapeHtml,
    formatElapsedTime,
    formatSavedTimestamp,
    getSavedLayoutElapsedMs,
    getSavedLayoutPopulation,
    hashString,
    isGridLike,
    normalizeElapsedMs,
    normalizeHeaderName,
    normalizeOptimizer,
    parseCatalogImportText,
    parseIntegerField,
    parsePair,
    parseResidentialCatalogEntry,
    parseServiceCatalogEntry,
    readOptionalInteger,
    serializeResidentialTypeForCatalog,
    serializeServiceTypeForCatalog,
    sortedUnique,
    splitTabularLine,
    stableStringify
  });
})(window);
