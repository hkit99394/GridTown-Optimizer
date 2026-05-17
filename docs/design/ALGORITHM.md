# City Builder — Algorithm Design

## 1. Overview

The problem decomposes into:

1. **Road access**: Ensure every placed building either touches the road-anchor boundary itself or can connect to an explicit road component that touches row 0 or column 0.
2. **Building placement**: Place service and residential buildings on allowed cells without overlap, each with explicit or implicit road access, so that total population is maximized.

We design a support-road approach: place buildings for value, then materialize only the explicit road cells needed for non-boundary buildings. The final road set may have multiple components, and it may be empty when every building touches the road-anchor boundary.

---

## 2. Notation

- `G[r][c]`: 1 = allowed, 0 = blocked.
- **Road anchor boundary**: row `r = 0` or column `c = 0` (allowed cells only).
- **Service**: rectangular block `(rows_s × cols_s)` with its own population bonus and its own outward effect range `range_s`.
- **Residential**: rectangular block `(rows_r × cols_r)` with its own population bounds; population = min(base + service bonuses, max_pop).

---

## 3. Phase 1: Road Network

**Goal:** A set of explicit road cells `R` such that:
- All cells in `R` are allowed.
- Each connected component of `R` contains at least one cell in row `0` or column `0`.
- `R` may be empty if every placed building footprint touches row `0` or column `0`.
- Every non-boundary building is orthogonally adjacent to a cell in `R`.

**Strategy A — Connectivity oracle first:**

1. Treat cells in row `0` or column `0` as road-anchor cells.
2. For each possible building footprint, record whether it has implicit anchor access because the footprint touches row `0` or column `0`.
3. For non-boundary footprints, use BFS/DFS over allowed, unoccupied cells to find a path from an adjacent road candidate cell to either:
   - an existing explicit road component, or
   - any road-anchor cell that can start a new road component.
4. Defer exact road materialization until after the building choice when possible, then prune support roads that are no longer needed.

**Strategy B — Roads as needed (integrated with placement):**

- Start with `R = ∅` or with a small seed from an incumbent layout.
- A building that touches row `0` or column `0` is connected without adding roads.
- When placing a non-boundary building, require that its footprint is orthogonally adjacent to at least one cell that is either in `R`, or can be connected by a shortest allowed path to an existing anchored road component or directly to the road-anchor boundary.
- When adding explicit roads, add only the path needed for that building. The path may connect to an existing road component or create a new anchored component.

**Recommended for implementation:** Strategy B. Maintain `R` and validate it by reachability from all road-anchor cells rather than one global source. When placing a building at a rectangle `B`, first accept it if `B` touches row `0` or column `0`. Otherwise, check that some border-adjacent allowed cell can be connected to an anchored explicit road component or to the road-anchor boundary. If roads are needed, add a shortest support path and later prune any road cells that are no longer needed for non-boundary building access.

**Algorithm — Ensure road connectivity when adding a building at rectangle B:**

1. If `B` touches row `0` or column `0`, the building has implicit road access; return true without adding roads.
2. For each cell `u` in `B`, for each orthogonal neighbor `v`: if `v` is allowed and in `R`, the building is connected; return true.
3. If none: for each allowed neighbor `v`, compute a shortest path from `v` to either an existing anchored road component or any road-anchor cell. If a path exists, add that path to `R` and return true.
4. If no such path exists, placement at `B` is invalid.

This keeps Phase 2 “placement” and “road extension” in one place.

---

## 4. Phase 2: Building Placement (Maximize Population)

**Goal:** Choose disjoint sets of rectangular service buildings and rectangular residential buildings on allowed cells, each building having explicit or implicit road access, so that total population is maximized.

**Difficulty:** Packing + optimization; NP-hard in general. We use **heuristics** and optionally **search**.

### 4.1 Greedy placement (fast heuristic)

**Idea:** Place services first to create “high value” zones, then pack residentials where population (base + service boost) is large.

**Order:**

1. **Enumerate candidate placements**
   - All valid service rectangles from the configured service-building catalog, and all valid residential rectangles from the configured residential catalog that lie entirely on allowed cells. Reject any that overlap an existing road if we treat roads as fixed; or allow roads to be adjusted as in Phase 1 Strategy B.
   - For each candidate, precompute whether it has implicit anchor access or can receive explicit road access (using the rule above).

2. **Greedy service placement**
   - Sort candidate service positions by a score, e.g. “number or value of residential candidates that would be covered by this service’s own effect zone” (potential demand).
   - Place services one by one: pick the highest-score position that does not overlap already placed buildings (and if roads are being built, that is connectable). Add minimal roads if needed. Mark effect zones.

3. **Greedy residential placement**
   - Sort candidate residential positions by **effective population**: base population plus the sum of the bonuses from services whose own effect zones cover this position, capped at max_pop. Larger or higher-yield residential footprints may naturally win if they fit well.
   - Place residentials one by one: pick highest effective-population position that does not overlap buildings and has road access (extend roads if needed). Recompute “effective population” after each placement if service boosts are shared (already accounted in the sort).

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
1. R ← empty explicit road set, or an incumbent road seed when repairing an existing layout.

2. Build list of all valid building placements:
   - Services: every configured service footprint `(rows_s × cols_s)` on allowed cells, with that service's own bonus and effect range.
   - Residentials: every configured residential rectangle on allowed cells.
   For each, mark “connectable” if it has implicit anchor access or can be connected by explicit roads.

3. Greedy services:
   For each candidate service s (e.g. sorted by number of residential candidates in its effect zone):
     If s does not overlap any placed building and is connectable:
      Place s; extend R with minimal support roads if needed; add s to placed set.

4. Greedy residentials:
   For each candidate residential r (sorted by effective population, with optional tie-breaks based on footprint efficiency or road cost):
     If r does not overlap any placed building and is connectable:
      Place r; extend R if needed; add r to placed set; add its population to total.

5. (Optional) Local search: swap/add/remove-replace to improve total population.

6. Prune redundant explicit roads while preserving road access and per-component anchor connectivity.

7. Return R, set of services, set of residentials, total population.
```

---

## 6. Data structures

- **Grid:** `G[r][c]`; keep `H`, `W`.
- **Road set:** `R` as set of `(r, c)`. Connectivity: every connected component of `R` must be reachable from row 0 or column 0. Empty `R` is allowed when all buildings have implicit anchor access.
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
| 1 | Start with an empty explicit road set or an incumbent road seed. |
| 2 | Enumerate all valid service and residential placements; mark implicit-anchor or explicitly connectable. |
| 3 | Greedy place services (by coverage of residential potential). |
| 4 | Greedy place residentials (by effective population); extend roads as needed. |
| 5 | Optional: local search to improve total population. |
| 6 | Prune redundant support roads. |
| 7 | Return roads, buildings, total population. |

This gives a clear, implementable procedure that respects the formal spec (allowed cells, per-component road-anchor connectivity, explicit or implicit building road access, disjoint buildings) and aims to maximize total city population.
