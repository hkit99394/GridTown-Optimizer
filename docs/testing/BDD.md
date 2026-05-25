# Behavior-Driven Development

This project should use lightweight BDD for behavior that matters at the product or domain boundary: solver feasibility, scoring rules, optimizer/API contracts, and planner workflows. Keep algorithm internals, micro-helpers, and benchmark tuning in focused unit or benchmark tests.

The goal is not to add a new framework yet. The current `node:assert` test harness is enough. BDD here means scenario language, traceable examples, and executable acceptance tests.

## Where Scenarios Live

- `docs/requirements/features/*.feature` contains stakeholder-readable Gherkin drafts.
- `tests/acceptance/*.test.cjs` contains executable acceptance scenarios.
- Existing `tests/*.test.cjs` files remain the right home for unit, regression, and benchmark-adjacent coverage.

Each accepted behavior should have a stable scenario ID:

- Use `CB-BDD-NNN` for city-builder acceptance scenarios.
- Put the ID in the `.feature` file as a Gherkin tag, for example `@CB-BDD-001`.
- Start the executable scenario name with the same ID, for example `scenario("[CB-BDD-001] Given ...", ...)`.
- Reference the same ID from backlog or coverage tables so requirements, scenario drafts, and executable tests can be traced without relying on matching prose.

## Scenario Shape

Use this structure in `.feature` files:

```gherkin
Feature: Short domain capability

  Rule: One business or domain rule

    @CB-BDD-001
    Scenario: Short observable behavior
      Given a meaningful starting state
      When the user or solver performs an action
      Then the observable outcome is true
```

Use the same language in executable tests:

```js
scenario("[CB-BDD-001] Given ..., when ..., then ...", () => {
  // Arrange
  // Act
  // Assert
});
```

## When To Add BDD Coverage

Add or update an acceptance scenario when a change affects:

- a rule in `docs/requirements/SPEC.md`
- whether a placement is feasible
- how population is computed
- optimizer selection visible to users
- HTTP request/response behavior
- planner save, manual-edit, compare, or solve lifecycle flows

Keep acceptance tests as close as possible to the behavior boundary:

- Domain and scoring behavior belongs in `tests/acceptance/*-bdd.test.cjs` with direct public API calls.
- HTTP behavior belongs in route-level acceptance tests that exercise the request/response contract and assert status, validation payloads, and result summaries.
- Planner lifecycle flows belong in browser/e2e coverage when the behavior depends on persisted UI state, manual editing, or interactions across multiple views. Use route-level acceptance tests when the same behavior is fully captured by backend contracts.

Route-level acceptance scenarios can use the same shape:

```js
scenario(
  "[CB-BDD-020] Given an invalid solve request, when POST /api/solve runs, then validation errors are returned",
  async () => {
    // Arrange request payload
    // Act through the HTTP route handler or local server
    // Assert status, response shape, and user-visible validation fields
  }
);
```

Prefer ordinary unit tests when a change affects:

- private helper functions
- heuristic ordering details
- benchmark output formatting
- performance tuning knobs
- implementation-only refactors

## Definition Of Done

For behavior changes, aim for this loop:

1. Update the formal rule in `docs/requirements/SPEC.md` if the rule changed.
2. Add or adjust a scenario in `docs/requirements/features/`.
3. Add or adjust an executable scenario in `tests/acceptance/`.
4. Implement the change.
5. Run `npm run test:acceptance` for the quick BDD loop.
6. Run `npm test` before merging.

## Scenario Coverage

| ID           | Scenario                                                                                  | Spec area                              | Feature draft                                          | Executable test                              | Status  |
| ------------ | ----------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | ------- |
| `CB-BDD-001` | Service effect range boosts residential population and caps it at the residential max.    | Service effects and population scoring | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-002` | Road components must touch row `0` or column `0`.                                         | Road connectivity                      | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-003` | Buildings must not overlap.                                                               | Disjoint placement                     | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-004` | Buildings and roads must be on allowed cells.                                             | Allowed cells                          | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-005` | Buildings must be road-connected unless their footprint touches the road-anchor boundary. | Building-road connectivity             | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-006` | The default interactive optimizer remains `auto`.                                         | Optimizer selection                    | `docs/requirements/features/planner-api.feature`       | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-007` | The solve API returns validation and stats that match the solved layout.                  | HTTP solve contract                    | `docs/requirements/features/planner-api.feature`       | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-008` | Independent road components are valid when each component touches row `0` or column `0`.  | Road connectivity                      | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
| `CB-BDD-009` | Boundary-touching buildings do not require adjacency to explicit anchored roads.          | Building-road connectivity             | `docs/requirements/features/city-builder-core.feature` | `tests/acceptance/city-builder-bdd.test.cjs` | Covered |
