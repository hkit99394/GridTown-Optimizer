# City Builder — Algorithm Design

## 1. Overview

The problem decomposes into:

1. **Road network**: Ensure every placed building can be connected to the anchored road network (row 0).
2. **Building placement**: Place service and residential buildings on allowed cells without overlap, each adjacent to the road network, so that total population is maximized.

We design a **two-phase approach**: first decide (or assume) a road network that supports connectivity; then place buildings subject to that network and optimize population.

---

## 2. Notation

- `G[r][c]`: 1 = allowed, 0 = blocked.
- **Road anchor**: row `r = 0` (allowed cells only).
- **Service**: rectangular block `(rows_s × cols_s)` with its own population bonus and its own outward effect range `range_s`.
- **Residential**: rectangular block `(rows_r × cols_r)` with its own population bounds; population = min(base + service bonuses, max_pop).

---

## 3. Phase 1: Road Network

**Goal:** A set of road cells `R` such that:
- All cells in `R` are allowed and connected to the road anchor (row 0) via orthogonal moves on `R`.
- Every cell that might host a building can be made adjacent to some road (we can build roads as needed when placing buildings).

**Strategy A — Skeleton first (recommended for clarity):**

1. Let `R` initially be all allowed cells in row 0 (the anchored road set).
2. For each allowed cell `(r, c)` with `r > 0`, we need a path of road cells from `(r, c)` to the anchored road network. This is equivalent to ensuring the **allowed cells** form a graph and we mark a **spanning tree** (or forest) of “road” edges so that every allowed cell is either on the road or adjacent to a road.
3. Simpler option: **road = row-0 anchor only**. Then we require every building to be placed so that at least one cell of its footprint is adjacent to row 0. That severely restricts placement.
4. Better option: **extend roads** from row 0. Use BFS/DFS from the anchored road network: from each road cell, consider adjacent allowed cells; add them as road if needed to “reach” building sites. We can defer exact road placement to Phase 2 and only ensure **connectivity** of the allowed region to row 0.
5. Buildings that touch row 0 may be treated as already connected to the road anchor, even if no explicit adjacent road cell is placed next to them.

**Strategy B — Roads as needed (integrated with placement):**

- Start with `R = { (0,c) : G[0][c] = 1 }`.
- When placing a building, require that the building’s footprint is orthogonally adjacent to at least one cell that is either (a) in `R`, or (b) can be added to `R` while keeping `R` connected to the road anchor. When we add such a cell, add it to `R` (and optionally add a shortest path of cells from that cell to current `R` so `R` stays connected).

**Recommended for implementation:** Strategy B. Maintain `R` and a “road connectivity” structure (e.g. union-find or BFS from row 0). When placing a building at a rectangle `B`, check that some cell in `B` is adjacent to a cell that is either already in `R` or is allowed and, when added to `R`, keeps connectivity to row 0 (e.g. the cell is reachable from row 0 using only allowed cells). If we add a new road segment, add a minimal path from the building’s adjacent cell to current `R`.

**Algorithm — Ensure road connectivity when adding a building at rectangle B:**

1. For each cell `u` in `B`, for each neighbor `v` (orthogonal): if `v` is allowed and in `R`, building is connected; return true.
2. If none: for each cell `u` in `B`, for each neighbor `v` allowed: compute shortest path from `v` to any cell in `R` (BFS on allowed cells). If a path exists, add that path to `R` and return true.
3. If no such path exists, placement at `B` is invalid.

This keeps Phase 2 “placement” and “road extension” in one place.

---

## 4. Phase 2: Building Placement (Maximize Population)

**Goal:** Choose disjoint sets of rectangular service buildings and rectangular residential buildings on allowed cells, each building adjacent to road network, so that total population is maximized.

**Difficulty:** Packing + optimization; NP-hard in general. We use **heuristics** and optionally **search**.

### 4.1 Greedy placement (fast heuristic)

**Idea:** Place services first to create “high value” zones, then pack residentials where population (base + service boost) is large.

**Order:**

1. **Enumerate candidate placements**
   - All valid service rectangles from the configured service-building catalog, and all valid residential rectangles from the configured residential catalog that lie entirely on allowed cells. Reject any that overlap an existing road if we treat roads as fixed; or allow roads to be adjusted as in Phase 1 Strategy B.
   - For each candidate, precompute whether it can be connected to the road network (using the rule above).

2. **Greedy service placement**
   - Sort candidate service positions by a score, e.g. “number or value of residential candidates that would be covered by this service’s own effect zone” (potential demand).
   - Place services one by one: pick the highest-score position that does not overlap already placed buildings (and if roads are being built, that is connectable). Add minimal roads if needed. Mark effect zones.

3. **Greedy residential placement**
   - Sort candidate residential positions by **effective population**: base population plus the sum of the bonuses from services whose own effect zones cover this position, capped at max_pop. Larger or higher-yield residential footprints may naturally win if they fit well.
   - Place residentials one by one: pick highest effective-population position that does not overlap buildings and is connectable to road (extend roads if needed). Recompute “effective population” after each placement if service boosts are shared (already accounted in the sort).

**Tie-breaking:** Prefer positions that need less extra road length, or positions that are already adjacent to existing roads.

### 4.2 Refinement: local search

After greedy placement:

- **Swap:** Try moving one building to another valid position; accept if total population increases.
- **Add:** Try adding one more service or residential if there is space.
- **Remove-and-replace:** Remove one building and place a different building (or same type elsewhere) if it improves population.

Run for a fixed number of iterations or until no improvement.

### 4.3 Exact / bounded search (optional)

If grid is small:

- **Backtracking:** Enumerate placements in order (e.g. by row then column). For each building type, try all valid positions; recurse and prune when remaining population upper bound is below best solution so far.
- **Upper bound:** For each remaining cell, optimistic population if we put a max-pop residential there and assume all services boost it; sum and cap by geometry to get a bound.

---

## 5. End-to-end algorithm (recommended)

```
1. R ← anchored road set (all allowed cells with r = 0).

2. Build list of all valid building placements:
   - Services: every configured service footprint `(rows_s × cols_s)` on allowed cells, with that service's own bonus and effect range.
   - Residentials: every configured residential rectangle on allowed cells.
   For each, mark “connectable” if it can be connected to R (possibly after adding a path to R).

3. Greedy services:
   For each candidate service s (e.g. sorted by number of residential candidates in its effect zone):
     If s does not overlap any placed building and is connectable:
       Place s; extend R with minimal path if needed; add s to placed set.

4. Greedy residentials:
   For each candidate residential r (sorted by effective population, with optional tie-breaks based on footprint efficiency or road cost):
     If r does not overlap any placed building and is connectable:
       Place r; extend R if needed; add r to placed set; add its population to total.

5. (Optional) Local search: swap/add/remove-replace to improve total population.

6. Return R, set of services, set of residentials, total population.
```

---

## 6. Data structures

- **Grid:** `G[r][c]`; keep `H`, `W`.
- **Road set:** `R` as set of `(r, c)`. Connectivity: either union-find over `R`, or “reachable from row 0” via BFS when adding new roads.
- **Buildings:** List of rectangles (top-left `(r,c)` + size). For service: `(rows_s, cols_s, bonus_s, range_s)`. For residential: `(rows_r, cols_r, base_r, max_r)` or a typed residential record.
- **Effect zones:** For each placed service, compute the expanded rectangle using that service’s own range `range_s`, excluding the footprint itself. For population computation, for each residential check if its footprint intersects any service effect zone.

---

## 7. Complexity (greedy)

- Valid placements: O(H·W) candidate rectangles.
- Connectivity check per placement: O(H·W) BFS.
- Greedy: O((H·W)²) in the worst case if we re-check all candidates after each placement. Can be reduced by maintaining “occupied” bitmap and “connectable” list and updating incrementally.

---

## 8. Summary

| Step | Action |
|------|--------|
| 1 | Start with the anchored road set (row 0). |
| 2 | Enumerate all valid service and residential placements; mark connectable. |
| 3 | Greedy place services (by coverage of residential potential). |
| 4 | Greedy place residentials (by effective population); extend roads as needed. |
| 5 | Optional: local search to improve total population. |
| 6 | Return roads, buildings, total population. |

This gives a clear, implementable procedure that respects the formal spec (allowed cells, connectivity to row 0, building–road adjacency, disjoint buildings) and aims to maximize total city population.
