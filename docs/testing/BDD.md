# Behavior-Driven Development

This project should use lightweight BDD for behavior that matters at the product or domain boundary: solver feasibility, scoring rules, optimizer/API contracts, and planner workflows. Keep algorithm internals, micro-helpers, and benchmark tuning in focused unit or benchmark tests.

The goal is not to add a new framework yet. The current `node:assert` test harness is enough. BDD here means scenario language, traceable examples, and executable acceptance tests.

## Where Scenarios Live

- `docs/requirements/features/*.feature` contains stakeholder-readable Gherkin drafts.
- `tests/acceptance/*.test.cjs` contains executable acceptance scenarios.
- Existing `tests/*.test.cjs` files remain the right home for unit, regression, and benchmark-adjacent coverage.

## Scenario Shape

Use this structure in `.feature` files:

```gherkin
Feature: Short domain capability

  Rule: One business or domain rule

    Scenario: Short observable behavior
      Given a meaningful starting state
      When the user or solver performs an action
      Then the observable outcome is true
```

Use the same language in executable tests:

```js
scenario("Given ..., when ..., then ...", () => {
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
5. Run `npm test`.

## Initial Scenario Backlog

- Service effect range boosts residential population and caps it at the residential max.
- Road components must touch row `0` or column `0`.
- Multiple independent road components are valid when every component touches row `0` or column `0`.
- Layouts can be valid with no explicit roads when every building footprint touches the road anchor boundary.
- Buildings and roads must be on allowed cells.
- Buildings must not overlap.
- Buildings must be road-connected unless their footprint touches the road anchor boundary.
- Oversized planner HTTP inputs are rejected before a solver starts.
- The default interactive optimizer remains `auto`.
- The solve API returns validation and stats that match the solved layout.
