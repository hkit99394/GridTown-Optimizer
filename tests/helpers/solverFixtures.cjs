function buildMockSolution({
  optimizer = "greedy",
  totalPopulation = 0,
  cpSatStatus,
  stoppedByUser,
  roads,
  services,
  residentials,
  cpSatTelemetry,
} = {}) {
  const hasPopulation = totalPopulation > 0;
  const resolvedRoads = roads ?? ["0,0"];
  const resolvedServices = services ?? [];
  const resolvedResidentials = residentials ?? (hasPopulation ? [{ r: 1, c: 1, rows: 2, cols: 2 }] : []);
  return {
    optimizer,
    ...(cpSatStatus ? { cpSatStatus } : {}),
    ...(stoppedByUser !== undefined ? { stoppedByUser } : {}),
    roads: new Set(resolvedRoads),
    services: resolvedServices,
    serviceTypeIndices: resolvedServices.map(() => -1),
    servicePopulationIncreases: [],
    residentials: resolvedResidentials,
    residentialTypeIndices: resolvedResidentials.map(() => -1),
    populations: resolvedResidentials.length ? [totalPopulation, ...Array(Math.max(0, resolvedResidentials.length - 1)).fill(0)] : [],
    totalPopulation,
    ...(cpSatTelemetry ? { cpSatTelemetry } : {}),
  };
}

module.exports = {
  buildMockSolution,
};
