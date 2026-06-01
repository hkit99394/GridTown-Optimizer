def add_no_overlap_2d_occupancy_constraints(
    model,
    id_to_cell,
    road_vars,
    service_vars,
    service_candidates,
    residential_vars,
    residential_candidates,
):
    x_intervals = []
    y_intervals = []

    def add_optional_rectangle(name, present, r, c, rows, cols):
        x_intervals.append(model.NewOptionalFixedSizeIntervalVar(c, cols, present, f"{name}_x"))
        y_intervals.append(model.NewOptionalFixedSizeIntervalVar(r, rows, present, f"{name}_y"))

    for cell_id, road_var in enumerate(road_vars):
        r, c = id_to_cell[cell_id]
        add_optional_rectangle(f"road_{cell_id}", road_var, r, c, 1, 1)

    for candidate_index, variable in enumerate(service_vars):
        candidate = service_candidates[candidate_index]
        add_optional_rectangle(
            f"service_{candidate_index}",
            variable,
            candidate["r"],
            candidate["c"],
            candidate["rows"],
            candidate["cols"],
        )

    for candidate_index, variable in enumerate(residential_vars):
        candidate = residential_candidates[candidate_index]
        add_optional_rectangle(
            f"residential_{candidate_index}",
            variable,
            candidate["r"],
            candidate["c"],
            candidate["rows"],
            candidate["cols"],
        )

    model.AddNoOverlap2D(x_intervals, y_intervals)


def use_no_overlap_2d_encoding(params) -> bool:
    cp_sat_options = params.get("cpSat") or {}
    return bool(cp_sat_options.get("useNoOverlap2d", False))
