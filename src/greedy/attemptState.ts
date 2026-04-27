import { cellKey } from "../core/types.js";
import type {
  Grid,
  GreedyProfileCounters,
  ResidentialPlacement,
  ServicePlacement,
} from "../core/types.js";
import {
  applyRoadConnectionProbe,
  computeRow0ReachableEmptyFrontier,
  createRoadProbeScratch,
  materializeDeferredRoadNetwork,
  measureBuildingConnectivityShadow,
  measureBuildingConnectivityShadowFromFrontier,
  probeBuildingConnectedToRoads,
  probeBuildingConnectedToRow0ReachableEmptyFrontier,
} from "../core/roads.js";
import type { BuildingConnectivityShadow } from "../core/roads.js";
import type { RoadConnectionProbe } from "../core/roads.js";
import { normalizeServicePlacement } from "../core/buildings.js";
import { forEachRectangleCell } from "../core/grid.js";

export type { RoadConnectionProbe } from "../core/roads.js";

export type PlacementRect = { r: number; c: number; rows: number; cols: number };
export type DeferredRoadFrontierProbe = NonNullable<ReturnType<typeof probeBuildingConnectedToRow0ReachableEmptyFrontier>>;
export type ConnectivityProbe =
  | { kind: "explicit"; roadCost: number; roadProbe: RoadConnectionProbe }
  | { kind: "deferred"; roadCost: number; frontierProbe: DeferredRoadFrontierProbe };

function forEachPlacementCell(
  placement: PlacementRect,
  visit: (key: string) => void
): void {
  forEachRectangleCell(placement.r, placement.c, placement.rows, placement.cols, (r, c) => visit(cellKey(r, c)));
}

function addPlacementCellsToSet(
  target: Set<string>,
  placement: PlacementRect
): void {
  forEachPlacementCell(placement, (key) => target.add(key));
}

function forEachCachedPlacementCell(
  footprintKeys: readonly string[],
  visit: (key: string) => void
): void {
  for (const key of footprintKeys) visit(key);
}

export function probeExplicitRoadConnection(
  grid: Grid,
  roads: Set<string>,
  occupied: Set<string>,
  placement: PlacementRect,
  scratch: ReturnType<typeof createRoadProbeScratch>,
  profileCounters?: GreedyProfileCounters
): RoadConnectionProbe | null {
  if (profileCounters) profileCounters.roads.canConnectChecks++;
  if (profileCounters) profileCounters.roads.probeCalls++;
  if (profileCounters) profileCounters.roads.scratchProbeCalls++;
  return probeBuildingConnectedToRoads(
    grid,
    roads,
    occupied,
    placement.r,
    placement.c,
    placement.rows,
    placement.cols,
    scratch
  );
}

export function collectNewlyOccupiedKeysForPlacement(
  occupied: Set<string>,
  probe: RoadConnectionProbe | null,
  placement: PlacementRect,
  footprintKeys?: readonly string[]
): string[] {
  const newlyOccupied = new Set<string>();
  if (probe?.path) {
    for (const [r, c] of probe.path) {
      const key = cellKey(r, c);
      if (!occupied.has(key)) newlyOccupied.add(key);
    }
  }
  const visitFootprintKey = footprintKeys
    ? (visit: (key: string) => void) => forEachCachedPlacementCell(footprintKeys, visit)
    : (visit: (key: string) => void) => forEachPlacementCell(placement, visit);
  visitFootprintKey((key) => {
    if (!occupied.has(key)) newlyOccupied.add(key);
  });
  return [...newlyOccupied];
}

export function commitExplicitRoadConnectedPlacement(options: {
  roads: Set<string>;
  occupied: Set<string>;
  probe: RoadConnectionProbe;
  placement: PlacementRect;
  footprintKeys?: readonly string[];
  newlyOccupiedKeys?: readonly string[];
  profileCounters?: GreedyProfileCounters;
  countProbeReuse?: boolean;
}): string[] {
  const {
    roads,
    occupied,
    probe,
    placement,
    footprintKeys,
    newlyOccupiedKeys,
    profileCounters,
    countProbeReuse = true,
  } = options;
  const occupiedKeys = newlyOccupiedKeys
    ? [...newlyOccupiedKeys]
    : collectNewlyOccupiedKeysForPlacement(occupied, probe, placement, footprintKeys);
  if (profileCounters) {
    profileCounters.roads.ensureConnectedCalls++;
    if (countProbeReuse) profileCounters.roads.probeReuses++;
  }
  applyRoadConnectionProbe(roads, probe);
  for (const key of occupiedKeys) occupied.add(key);
  return occupiedKeys;
}

export class GreedyAttemptState {
  readonly roads: Set<string>;
  readonly occupied: Set<string>;
  readonly explicitRoadProbeScratch: ReturnType<typeof createRoadProbeScratch>;
  private readonly occupiedBuildings: Set<string>;
  private deferredFrontier: ReturnType<typeof computeRow0ReachableEmptyFrontier> | null;

  constructor(
    private readonly grid: Grid,
    private readonly initialRoadSeed: Set<string> | undefined,
    readonly useDeferredRoadCommitment: boolean,
    private readonly profileCounters?: GreedyProfileCounters
  ) {
    this.roads = useDeferredRoadCommitment ? new Set<string>() : new Set<string>(initialRoadSeed ?? []);
    this.occupied = new Set<string>();
    this.occupiedBuildings = new Set<string>();
    for (const key of this.roads) this.occupied.add(key);
    this.deferredFrontier = useDeferredRoadCommitment
      ? computeRow0ReachableEmptyFrontier(grid, this.occupied)
      : null;
    this.explicitRoadProbeScratch = createRoadProbeScratch(grid);
    if (useDeferredRoadCommitment && profileCounters) {
      profileCounters.roads.deferredFrontierRecomputes++;
    }
  }

  probeRoadConnection(snapshotOccupied: Set<string>, placement: PlacementRect): ConnectivityProbe | null {
    if (this.useDeferredRoadCommitment) {
      const frontierProbe = this.deferredFrontier
        ? probeBuildingConnectedToRow0ReachableEmptyFrontier(
            this.grid,
            this.deferredFrontier,
            placement.r,
            placement.c,
            placement.rows,
            placement.cols
          )
        : null;
      if (!frontierProbe) return null;
      return { kind: "deferred", roadCost: frontierProbe.distance, frontierProbe };
    }

    const roadProbe = probeExplicitRoadConnection(
      this.grid,
      this.roads,
      snapshotOccupied,
      placement,
      this.explicitRoadProbeScratch,
      this.profileCounters
    );
    if (!roadProbe) return null;
    return { kind: "explicit", roadCost: roadProbe.path?.length ?? 0, roadProbe };
  }

  collectNewlyOccupiedKeys(
    probe: RoadConnectionProbe | null,
    placement: PlacementRect,
    footprintKeys?: readonly string[]
  ): string[] {
    return collectNewlyOccupiedKeysForPlacement(this.occupied, probe, placement, footprintKeys);
  }

  measureConnectivityShadow(placement: PlacementRect, footprintKeys?: readonly string[]): BuildingConnectivityShadow {
    return this.useDeferredRoadCommitment && this.deferredFrontier
      ? measureBuildingConnectivityShadowFromFrontier(
          this.grid,
          this.occupiedBuildings,
          this.deferredFrontier,
          placement,
          footprintKeys
        )
      : measureBuildingConnectivityShadow(this.grid, this.occupiedBuildings, placement, footprintKeys);
  }

  commitExplicitPlacement(options: {
    probe: RoadConnectionProbe;
    placement: PlacementRect;
    footprintKeys?: readonly string[];
    newlyOccupiedKeys?: readonly string[];
    countProbeReuse?: boolean;
    recordConnectivityShadow?: boolean;
  }): string[] {
    const { recordConnectivityShadow = true, ...commitOptions } = options;
    if (recordConnectivityShadow) {
      this.recordConnectivityShadow(commitOptions.placement, commitOptions.footprintKeys);
    }
    const committedKeys = commitExplicitRoadConnectedPlacement({
      roads: this.roads,
      occupied: this.occupied,
      profileCounters: this.profileCounters,
      ...commitOptions,
    });
    this.addPlacementToOccupiedBuildings(commitOptions.placement, commitOptions.footprintKeys);
    return committedKeys;
  }

  commitPlacement(
    probe: ConnectivityProbe,
    placement: PlacementRect,
    options: {
      footprintKeys?: readonly string[];
      newlyOccupiedKeys?: readonly string[];
    } = {}
  ): string[] | null {
    if (this.useDeferredRoadCommitment) {
      if (probe.kind !== "deferred") return null;
      const occupiedKeys = options.newlyOccupiedKeys
        ? [...options.newlyOccupiedKeys]
        : this.collectNewlyOccupiedKeys(null, placement, options.footprintKeys);
      this.recordConnectivityShadow(placement, options.footprintKeys);
      this.commitDeferredPlacement(occupiedKeys, placement, options.footprintKeys);
      return occupiedKeys;
    }

    if (probe.kind !== "explicit") return null;
    const occupiedKeys = options.newlyOccupiedKeys
      ? [...options.newlyOccupiedKeys]
      : this.collectNewlyOccupiedKeys(probe.roadProbe, placement, options.footprintKeys);
    return this.commitExplicitPlacement({
      probe: probe.roadProbe,
      placement,
      footprintKeys: options.footprintKeys,
      newlyOccupiedKeys: occupiedKeys,
    });
  }

  materializeDeferredRoads(
    services: readonly ServicePlacement[],
    residentials: readonly ResidentialPlacement[]
  ): boolean {
    if (!this.useDeferredRoadCommitment) return true;

    const occupiedBuildings = new Set<string>();
    for (const service of services) addPlacementCellsToSet(occupiedBuildings, service);
    for (const residential of residentials) addPlacementCellsToSet(occupiedBuildings, residential);
    const materializedRoads = materializeDeferredRoadNetwork(
      this.grid,
      this.initialRoadSeed,
      occupiedBuildings,
      [
        ...services.map((service) => normalizeServicePlacement(service)),
        ...residentials,
      ],
      this.explicitRoadProbeScratch
    );
    if (!materializedRoads) {
      if (this.profileCounters) this.profileCounters.roads.deferredReconstructionFailures++;
      return false;
    }

    this.roads.clear();
    for (const key of materializedRoads) this.roads.add(key);
    this.occupied.clear();
    this.occupiedBuildings.clear();
    for (const key of occupiedBuildings) this.occupied.add(key);
    for (const key of occupiedBuildings) this.occupiedBuildings.add(key);
    for (const key of this.roads) this.occupied.add(key);
    if (this.profileCounters) {
      this.profileCounters.roads.deferredReconstructionSteps += services.length + residentials.length;
    }
    return true;
  }

  private recordConnectivityShadow(placement: PlacementRect, footprintKeys?: readonly string[]): void {
    if (!this.profileCounters) return;
    const shadow = this.measureConnectivityShadow(placement, footprintKeys);
    const counters = this.profileCounters.roads;
    counters.connectivityShadowChecks++;
    counters.connectivityShadowLostCells += shadow.lostCells;
    counters.connectivityShadowFootprintCells += shadow.footprintCells;
    counters.connectivityShadowDisconnectedCells += shadow.disconnectedCells;
    counters.connectivityShadowMaxLostCells = Math.max(counters.connectivityShadowMaxLostCells, shadow.lostCells);
    counters.connectivityShadowMaxDisconnectedCells = Math.max(
      counters.connectivityShadowMaxDisconnectedCells,
      shadow.disconnectedCells
    );
  }

  private addPlacementToOccupiedBuildings(placement: PlacementRect, footprintKeys?: readonly string[]): void {
    const visit = footprintKeys
      ? (add: (key: string) => void) => forEachCachedPlacementCell(footprintKeys, add)
      : (add: (key: string) => void) => forEachPlacementCell(placement, add);
    visit((key) => this.occupiedBuildings.add(key));
  }

  private commitDeferredPlacement(
    newlyOccupiedKeys: readonly string[],
    placement: PlacementRect,
    footprintKeys?: readonly string[]
  ): void {
    for (const key of newlyOccupiedKeys) this.occupied.add(key);
    this.addPlacementToOccupiedBuildings(placement, footprintKeys);
    this.deferredFrontier = computeRow0ReachableEmptyFrontier(this.grid, this.occupied);
    if (this.profileCounters) this.profileCounters.roads.deferredFrontierRecomputes++;
  }
}
