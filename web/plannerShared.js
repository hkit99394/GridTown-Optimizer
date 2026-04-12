(function attachPlannerShared(globalObject) {
  function cloneGrid(grid) {
    return grid.map((row) => [...row]);
  }

  function createGrid(rows, cols, value = 1) {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSavedEntryId() {
    return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

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

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function sortedUnique(values) {
    return Array.from(new Set(values)).sort();
  }

  function buildServiceCandidateKey(service, typeIndex) {
    return `service:${typeIndex}:${service.r}:${service.c}:${service.rows}:${service.cols}`;
  }

  function buildResidentialCandidateKey(residential, typeIndex) {
    return `residential:${typeIndex}:${residential.r}:${residential.c}:${residential.rows}:${residential.cols}`;
  }

  function serializeServiceTypeForCatalog(serviceType) {
    return {
      name: serviceType?.name ?? "",
      bonus: String(serviceType?.bonus ?? ""),
      size: `${serviceType?.rows ?? 0}x${serviceType?.cols ?? 0}`,
      effective: `${(serviceType?.rows ?? 0) + (serviceType?.range ?? 0) * 2}x${(serviceType?.cols ?? 0) + (serviceType?.range ?? 0) * 2}`,
    };
  }

  function serializeResidentialTypeForCatalog(residentialType) {
    return {
      name: residentialType?.name ?? "",
      resident: `${residentialType?.min ?? 0}/${residentialType?.max ?? 0}`,
      size: `${residentialType?.w ?? 0}x${residentialType?.h ?? 0}`,
      avail: String(residentialType?.avail ?? ""),
    };
  }

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
      ...(params.maxResidentials != null ? { maxResidentials: params.maxResidentials } : {}),
    };

    return {
      grid: cloneGrid(request.grid),
      params: modelParams,
    };
  }

  function computeCpSatModelFingerprint(modelInput) {
    return `fnv1a:${hashString(stableStringify(modelInput))}`;
  }

  function normalizeElapsedMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.round(number);
  }

  function buildCpSatWarmStartCheckpoint(result, resultContext, elapsedMs) {
    if (!result?.solution || !resultContext?.grid || !resultContext?.params) {
      throw new Error("This saved layout does not include enough data to build a CP-SAT hint.");
    }

    const solution = result.solution;
    const modelInput = buildCpSatContinuationModelInput(resultContext);
    const roadKeys = sortedUnique(Array.isArray(solution.roads) ? solution.roads : []);
    const serviceCandidateKeys = sortedUnique(
      (solution.services ?? []).map((service, index) => buildServiceCandidateKey(service, solution.serviceTypeIndices?.[index] ?? -1))
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
        residentials: residentialCandidateKeys,
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
        createdWith: {},
      },
      modelInput,
      runtimeDefaults: {
        ...(resultContext.params?.cpSat?.numWorkers != null ? { numWorkers: resultContext.params.cpSat.numWorkers } : {}),
        ...(resultContext.params?.cpSat?.randomSeed != null ? { randomSeed: resultContext.params.cpSat.randomSeed } : {}),
        ...(resultContext.params?.cpSat?.randomizeSearch != null ? { randomizeSearch: resultContext.params.cpSat.randomizeSearch } : {}),
        ...(resultContext.params?.cpSat?.logSearchProgress != null ? { logSearchProgress: resultContext.params.cpSat.logSearchProgress } : {}),
      },
      incumbent: {
        status: solution.cpSatStatus === "OPTIMAL" ? "OPTIMAL" : "FEASIBLE",
        objective: {
          name: "totalPopulation",
          sense: "maximize",
          value: Number(solution.totalPopulation ?? 0),
          bestBound: null,
        },
        elapsedMs: normalizeElapsedMs(elapsedMs),
        stoppedByUser: Boolean(solution.stoppedByUser || result.stats?.stoppedByUser),
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
            bonus: solution.servicePopulationIncreases?.[index] ?? 0,
          })),
          residentials: (solution.residentials ?? []).map((residential, index) => ({
            r: residential.r,
            c: residential.c,
            rows: residential.rows,
            cols: residential.cols,
            typeIndex: solution.residentialTypeIndices?.[index] ?? -1,
            population: solution.populations?.[index] ?? 0,
          })),
          populations: cloneJson(solution.populations ?? []),
          totalPopulation: Number(solution.totalPopulation ?? 0),
        },
      },
      resumePolicy: {
        requireExactModelMatch: true,
        applyHints: true,
        repairHint: true,
        fixVariablesToHintedValue: false,
        objectiveCutoff: {
          op: ">=",
          value: Number(solution.totalPopulation ?? 0),
          preferStrictImprove: false,
        },
      },
    };
  }

  function formatSavedTimestamp(savedAt) {
    const date = new Date(savedAt);
    return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
  }

  function clampInteger(value, fallback, min = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.floor(number));
  }

  function readOptionalInteger(value, min = 1) {
    if (value === "" || value == null) return undefined;
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    return Math.max(min, Math.floor(number));
  }

  function createSolveRequestId() {
    return `solve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function delay(ms) {
    return new Promise((resolve) => {
      globalObject.setTimeout(resolve, ms);
    });
  }

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

  function getSavedLayoutElapsedMs(entry) {
    return normalizeElapsedMs(entry?.elapsedMs ?? entry?.resultElapsedMs ?? entry?.result?.stats?.elapsedMs ?? 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function splitTabularLine(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return [];
    if (trimmed.includes("\t")) {
      return trimmed.split("\t").map((cell) => cell.trim());
    }
    return trimmed.split(/\s{2,}/).map((cell) => cell.trim());
  }

  function normalizeHeaderName(value) {
    return String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  }

  function parseCatalogImportBlock(lines) {
    if (!lines.length) return null;
    const header = splitTabularLine(lines[0]).map(normalizeHeaderName);
    const rows = lines.slice(1).map(splitTabularLine).filter((cells) => cells.length > 0);

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
          avail: cells[availIndex] ?? "",
        })),
      };
    }

    if (header.includes("name") && header.includes("bonus") && header.includes("size") && header.includes("effective")) {
      const nameIndex = header.indexOf("name");
      const bonusIndex = header.indexOf("bonus");
      const sizeIndex = header.indexOf("size");
      const effectiveIndex = header.indexOf("effective");
      return {
        kind: "services",
        rows: rows.map((cells) => ({
          name: cells[nameIndex] ?? "",
          bonus: cells[bonusIndex] ?? "",
          size: cells[sizeIndex] ?? "",
          effective: cells[effectiveIndex] ?? "",
        })),
      };
    }

    return null;
  }

  function parseCatalogImportText(text) {
    const blocks = String(text ?? "")
      .split(/\r?\n\s*\r?\n+/)
      .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
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
      residentials: importedResidentials,
    };
  }

  function normalizeOptimizer(optimizer) {
    return optimizer === "cp-sat" || optimizer === "lns" ? optimizer : "greedy";
  }

  function parsePair(value, separator, label) {
    const text = String(value ?? "").trim().toLowerCase();
    const parts = text.split(separator).map((part) => Number.parseInt(part.trim(), 10));
    if (parts.length !== 2 || parts.some((part) => !Number.isInteger(part) || part <= 0)) {
      throw new Error(`${label} must be in the format A${separator}B using positive integers.`);
    }
    return parts;
  }

  function parseIntegerField(value, label, min = 0) {
    const number = Number.parseInt(String(value ?? "").trim(), 10);
    if (!Number.isInteger(number) || number < min) {
      throw new Error(`${label} must be an integer greater than or equal to ${min}.`);
    }
    return number;
  }

  function parseServiceCatalogEntry(entry, index) {
    const name = String(entry.name ?? "").trim();
    const [rows, cols] = parsePair(entry.size, "x", `Service ${index + 1} size`);
    const [effectiveRows, effectiveCols] = parsePair(entry.effective, "x", `Service ${index + 1} effective area`);
    const rangeByRows = (effectiveRows - rows) / 2;
    const rangeByCols = (effectiveCols - cols) / 2;
    if (!Number.isInteger(rangeByRows) || !Number.isInteger(rangeByCols) || rangeByRows !== rangeByCols || rangeByRows < 0) {
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
      avail: 1,
      allowRotation: true,
    };
  }

  function parseResidentialCatalogEntry(entry, index) {
    const name = String(entry.name ?? "").trim();
    const [w, h] = parsePair(entry.size, "x", `Residential ${index + 1} size`);
    const [min, max] = parsePair(String(entry.resident ?? "").replaceAll(" ", ""), "/", `Residential ${index + 1} resident`);
    return {
      name: name || `Residential ${index + 1}`,
      w,
      h,
      min: Math.min(min, max),
      max: Math.max(min, max),
      avail: parseIntegerField(entry.avail, `Residential ${index + 1} avail`, 0),
    };
  }

  function isGridLike(grid) {
    return Array.isArray(grid)
      && grid.length > 0
      && grid.every((row) => Array.isArray(row) && row.length === grid[0].length && row.every((cell) => cell === 0 || cell === 1));
  }

  globalObject.CityBuilderShared = Object.freeze({
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
    stableStringify,
  });
})(window);
