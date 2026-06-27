def is_allowed(grid, r: int, c: int) -> bool:
    return 0 <= r < len(grid) and 0 <= c < len(grid[0]) and grid[r][c] == 1


def orthogonal_neighbors(grid, r: int, c: int):
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        r2 = r + dr
        c2 = c + dc
        if 0 <= r2 < len(grid) and 0 <= c2 < len(grid[0]):
            yield (r2, c2)


def road_anchor_cells(grid, fixed_road_cells=None, use_fixed_road_anchors_only=False):
    anchors = []
    if not use_fixed_road_anchors_only:
        anchors = [(0, c) for c in range(len(grid[0])) if is_allowed(grid, 0, c)]
        anchors.extend((r, 0) for r in range(1, len(grid)) if is_allowed(grid, r, 0))
    for cell in fixed_road_cells or []:
        if is_allowed(grid, cell[0], cell[1]) and cell not in anchors:
            anchors.append(cell)
    return anchors


def reachable_allowed_from_road_anchors(grid, fixed_road_cells=None, use_fixed_road_anchors_only=False):
    anchor_cells = road_anchor_cells(grid, fixed_road_cells, use_fixed_road_anchors_only)
    if not anchor_cells:
        return set()

    visited = set(anchor_cells)
    queue = list(anchor_cells)
    index = 0
    while index < len(queue):
        r, c = queue[index]
        index += 1
        for r2, c2 in orthogonal_neighbors(grid, r, c):
            if not is_allowed(grid, r2, c2):
                continue
            if (r2, c2) in visited:
                continue
            visited.add((r2, c2))
            queue.append((r2, c2))
    return visited


def rectangle_cells(r: int, c: int, rows: int, cols: int):
    return [(r + dr, c + dc) for dr in range(rows) for dc in range(cols)]


def build_blocked_prefix_sum(grid):
    h = len(grid)
    w = len(grid[0])
    prefix = [[0] * (w + 1) for _ in range(h + 1)]
    for r in range(h):
        row_blocked = 0
        for c in range(w):
            if grid[r][c] != 1:
                row_blocked += 1
            prefix[r + 1][c + 1] = prefix[r][c + 1] + row_blocked
    return prefix


def rectangle_blocked_count(prefix, r: int, c: int, rows: int, cols: int):
    r2 = r + rows
    c2 = c + cols
    return prefix[r2][c2] - prefix[r][c2] - prefix[r2][c] + prefix[r][c]


def enumerate_valid_placements(grid, blocked_prefix_sum, dimensions):
    h = len(grid)
    w = len(grid[0])
    placement_map = {}
    seen = set()
    for rows, cols in dimensions:
        key = f"{rows}x{cols}"
        if key in seen:
            continue
        seen.add(key)
        placements = []
        if rows <= h and cols <= w:
            for r in range(h - rows + 1):
                for c in range(w - cols + 1):
                    if rectangle_blocked_count(blocked_prefix_sum, r, c, rows, cols) != 0:
                        continue
                    placements.append({"r": r, "c": c, "rows": rows, "cols": cols})
        placement_map[key] = placements
    return placement_map


def rectangle_border_cells(grid, r: int, c: int, rows: int, cols: int):
    cells = set()
    for r0, c0 in rectangle_cells(r, c, rows, cols):
        for r1, c1 in orthogonal_neighbors(grid, r0, c0):
            if not (r <= r1 < r + rows and c <= c1 < c + cols):
                cells.add((r1, c1))
    return sorted(cells)


def service_effect_zone(grid, r: int, c: int, rows: int, cols: int, effect_range: int):
    h = len(grid)
    w = len(grid[0])
    r_min = max(0, r - effect_range)
    r_max = min(h - 1, r + rows - 1 + effect_range)
    c_min = max(0, c - effect_range)
    c_max = min(w - 1, c + cols - 1 + effect_range)
    zone = []
    for rr in range(r_min, r_max + 1):
        for cc in range(c_min, c_max + 1):
            in_footprint = r <= rr < r + rows and c <= cc < c + cols
            if in_footprint:
                continue
            if is_allowed(grid, rr, cc):
                zone.append((rr, cc))
    return zone


def build_reachable_neighbor_map(grid, reachable_allowed):
    return {
        cell: [neighbor for neighbor in orthogonal_neighbors(grid, cell[0], cell[1]) if neighbor in reachable_allowed]
        for cell in reachable_allowed
    }


def is_prunable_road_cell(cell, protected_cells, degrees):
    return cell not in protected_cells and degrees[cell] <= 1


def trim_road_eligible_cells(grid, reachable_allowed, protected_cells):
    neighbors = build_reachable_neighbor_map(grid, reachable_allowed)
    degrees = {cell: len(adjacent) for cell, adjacent in neighbors.items()}
    removed = set()
    queue = [cell for cell in reachable_allowed if is_prunable_road_cell(cell, protected_cells, degrees)]
    index = 0

    while index < len(queue):
        cell = queue[index]
        index += 1
        if cell in removed or cell in protected_cells:
            continue
        if not is_prunable_road_cell(cell, protected_cells, degrees):
            continue
        removed.add(cell)
        for neighbor in neighbors[cell]:
            if neighbor in removed:
                continue
            degrees[neighbor] -= 1
            if is_prunable_road_cell(neighbor, protected_cells, degrees):
                queue.append(neighbor)

    return reachable_allowed - removed


def index_reachable_allowed_cells(grid, reachable_allowed):
    allowed_cells = []
    cell_to_id = {}
    id_to_cell = {}
    for r in range(len(grid)):
        for c in range(len(grid[0])):
            if (r, c) not in reachable_allowed:
                continue
            idx = len(allowed_cells)
            allowed_cells.append((r, c))
            cell_to_id[(r, c)] = idx
            id_to_cell[idx] = (r, c)
    return allowed_cells, cell_to_id, id_to_cell
