# City Builder — Formal Specification

## 1. Problem Type

Maximization problem: choose a feasible placement of roads and buildings so that total city population is maximized.

---

## 2. Input

| Symbol | Type | Description |
|--------|------|-------------|
| `G` | `int[H][W]` | 2D grid. `G[r][c] = 1` ⇒ cell `(r, c)` is **allowed**; `G[r][c] = 0` ⇒ **not allowed**. |
| `H` | `int` | Number of rows (height). |
| `W` | `int` | Number of columns (width). |

**Assumptions:**

- Row index `r ∈ [0, H)` and column index `c ∈ [0, W)`.
- Every road component must **touch the road-anchor boundary**: each connected component of road cells must contain at least one road cell in row `0` or column `0`.
- All coordinates in this spec use `(row, col)` or `(r, c)`.

---

## 3. Entities

### 3.1 Cells and grid

- **Cell** `(r, c)` is **allowed** iff `0 ≤ r < H`, `0 ≤ c < W`, and `G[r][c] = 1`.
- A **region** is a set of cells. A **rectangle** is a set of cells `[r0, r1) × [c0, c1)` (top-left `(r0, c0)`, exclusive end).

### 3.2 Roads

- A **road** occupies a single allowed cell. Roads are placed on the grid.
- **Connected component**: Road cells may form multiple orthogonally connected components; each component must be connected to the road-anchor boundary.
- **Road-anchor boundary**: Every connected road component must include **at least one cell in row index 0 or column index 0** (i.e. some road cell in that component has `r = 0` or `c = 0`). The whole row or column need not be road.

### 3.3 Service building

- **Footprint**: a rectangular footprint of size **`rows_s × cols_s`** cells.
  - Common examples include **2×2**, **2×3**, **2×4**, **3×3**.
  - More generally, any rectangular **`n × m`** service footprint is allowed if it fits in bounds and all footprint cells are allowed.
- **Placement**: any `rows_s × cols_s` rectangle of **allowed** cells; all footprint cells must be in bounds and allowed.
- **Population increase**: each service building has its **own** population-increase value (e.g. 108, 204, 189). When a residential is in this service’s effect zone, that value is added to the residential’s population (before capping at max).
- **Effect range**: each service building has its **own** outward effect range `range_s` (non-negative integer).
- **Effect**: increases the population of **residential** buildings in the **effect zone** of this service building by that service’s population-increase amount.
- **Effect zone (extended range)**: all allowed cells within the service building’s own outward range `range_s` of the footprint, excluding the footprint itself.
  - For service top-left `(r, c)` with footprint rows `[r, r + rows_s)` and cols `[c, c + cols_s)`, the effect zone includes cells in the expanded rectangle:
    - rows `[r - range_s, r + rows_s - 1 + range_s]`
    - cols `[c - range_s, c + cols_s - 1 + range_s]`
    - excluding footprint cells `[r, r + rows_s) × [c, c + cols_s)`
  - Clip to grid bounds and allowed cells only.
  - A residential is **boosted** by this service if **any** cell of the residential footprint lies in this effect zone.
  - Example: service at `(5, 6)` can boost cell `(1, 5)` if that cell lies inside the service building’s configured effect range.

### 3.4 Residential building

- **Footprint**: a rectangular footprint of size **`rows_r × cols_r`** cells.
  - Common examples include **2×2**, **2×3**, **3×3**, **3×4**.
  - More generally, any rectangular **`n × m`** residential footprint is allowed if it fits in bounds and all footprint cells are allowed.
- **Placement**: any such rectangle of **allowed** cells; all cells must be in bounds and allowed.
- **Min/max per size or type**: each residential size or residential type has its own min (base) and max population, e.g. 2×2 min 260 max 780, 2×3 min 480 max 1440.
- **Actual population**: base (min for that size) + sum(boosting services’ population increases), clamped to [min, max] for that size.
- **Service boost**: for each service whose effect zone intersects this residential’s footprint, add **that service’s** population-increase value. Total = base + sum(boosts), capped at max for that size.

---

## 4. Constraints (feasibility)

A solution is **feasible** iff all of the following hold.

1. **Allowed cells**  
   Every road and every cell of every building footprint lies on an allowed cell (`G[r][c] = 1`).

2. **Disjoint placement**  
   No two buildings overlap (no cell belongs to more than one building). Roads may share cells with each other but **not** with building footprints (buildings and roads are disjoint).

3. **Road connectivity**  
   - Road cells may form multiple connected components (orthogonal moves only).
   - Every road component has at least one road cell with row index `r = 0` or column index `c = 0`.

4. **Building–road connectivity**  
   Every building must be **connected to a road-anchor-connected road component**: for each building, at least one cell of its footprint is **orthogonally adjacent** to some road cell.
   Buildings whose footprint covers row index `r = 0` or column index `c = 0` are treated as connected to the road anchor automatically.

5. **No overlap with buildings**  
   Roads may be placed on allowed cells that are not part of any building; building footprints do not overlap with each other or with roads.

---

## 5. Objective

- **Input (conceptual):** Grid `G`, and (if needed) parameters: base population per residential, max population per residential, service bonus per service, and optionally counts or limits on number of service vs residential buildings.
- **Output:** A feasible placement of:
  - a set of **road** cells,
  - a set of **service** buildings (each with its own rectangle size, population increase, and effect range),
  - a set of **residential** buildings (each with its own rectangular footprint and population bounds),  
  such that **total city population** is **maximized**.

- **Total city population** = sum over all residential buildings of (min(base + sum of service bonuses from services that boost it, max population)).

---

## 6. Output (formal)

A solution is a tuple:

- `R` ⊆ `{0,…,H-1} × {0,…,W-1}` — set of road cells.
- `S` — set of service buildings; each element includes:
  - a rectangular footprint `(r, c, rows_s, cols_s)`
  - a population increase value
  - an effect range value
- `Z` — set of residential buildings; each element is a rectangle (e.g. top-left `(r, c)` and size `(rows_r, cols_r)`).

Plus:

- **Population** `P_b` for each residential building `b` (base + boosts, capped by max).
- **Total population** `P = Σ_b P_b`.

The solver returns a feasible `(R, S, Z)` and the corresponding `P`; goal is to maximize `P`.

---

## 7. Parameters (to be fixed per instance)

- Grid `G` (required).
- Optional: `base_pop`, `max_pop`, service-building footprint sizes, service bonus per service, service effect range per service, `max_services`, `max_residentials`, etc., depending on the desired variant.

---

## 8. Summary

- **In:** Grid `G[H][W]` of 0/1 (allowed/not).
- **Out:** Roads `R`, service buildings `S`, residential buildings `Z`, and total population `P`.
- **Constraints:** All on allowed cells; buildings disjoint; every road component touches row `0` or column `0`; every building is adjacent to some road or touches the road-anchor boundary.
- **Goal:** Maximize `P`.
