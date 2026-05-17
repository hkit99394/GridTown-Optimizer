Feature: City builder core feasibility and scoring

  The planner should return layouts that obey the formal city-builder rules and
  compute population in a way users can understand from the input catalog.

  Rule: Service effects increase residential population within caps

    Scenario: A service effect reaches a residential footprint
      Given an allowed grid with one service and one residential
      And the service effect zone intersects the residential footprint
      And the residential maximum is lower than base population plus service bonus
      When the layout is evaluated
      Then the residential receives the service bonus
      And the reported residential population is capped at its maximum
      And the total population matches the capped residential population

  Rule: Road components must be anchored

    Scenario: A road component does not touch the anchor boundary
      Given a road component that is away from row 0 and column 0
      And a building is adjacent to that road component
      When the solution is validated
      Then the solution is rejected
      And the validation explains that road components must touch the anchor boundary

    Scenario: Two independent road components both touch the anchor boundary
      Given two road components that are not connected to each other
      And each road component contains at least one cell in row 0 or column 0
      And each non-boundary building is adjacent to one of those components
      When the solution is validated
      Then the solution is accepted

    Scenario: Boundary-touching buildings do not require explicit roads
      Given every building footprint touches row 0 or column 0
      And the solution contains no explicit road cells
      When the solution is validated
      Then the solution is accepted

  Rule: Building footprints are disjoint

    Scenario: A service and residential claim the same cell
      Given a service footprint and a residential footprint overlap
      When the solution is validated
      Then the solution is rejected
      And the validation explains that building footprints cannot overlap

  Rule: Planner HTTP inputs are bounded before solving

    Scenario: A planner request exceeds the HTTP complexity budget
      Given a solve request whose grid, catalog, footprint, availability, or estimated candidate count exceeds the planner limit
      When the solve API receives the request
      Then the request is rejected before an optimizer starts
      And the response names the exceeded planner limit
