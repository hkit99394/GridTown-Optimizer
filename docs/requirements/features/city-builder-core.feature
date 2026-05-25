Feature: City builder core feasibility and scoring

  The planner should return layouts that obey the formal city-builder rules and
  compute population in a way users can understand from the input catalog.

  Rule: Service effects increase residential population within caps

    @CB-BDD-001
    Scenario: A service effect reaches a residential footprint
      Given an allowed grid with one service and one residential
      And the service effect zone intersects the residential footprint
      And the residential maximum is lower than base population plus service bonus
      When the layout is evaluated
      Then the residential receives the service bonus
      And the reported residential population is capped at its maximum
      And the total population matches the capped residential population

  Rule: Road components must be anchored

    @CB-BDD-002
    Scenario: A road component does not touch the anchor boundary
      Given a road component that is away from row 0 and column 0
      And a building is adjacent to that road component
      When the solution is validated
      Then the solution is rejected
      And the validation explains that road components must touch the anchor boundary

    @CB-BDD-008
    Scenario: Two independent road components both touch the anchor boundary
      Given two road components that are not connected to each other
      And each road component contains at least one cell in row 0 or column 0
      And each non-boundary building is adjacent to one of those components
      When the solution is validated
      Then the solution is accepted

    @CB-BDD-009
    Scenario: Boundary-touching buildings do not require adjacency to explicit roads
      Given every building footprint touches row 0 or column 0
      And the solution contains an anchored explicit road component
      And the building footprints are not adjacent to that road component
      When the solution is validated
      Then the solution is accepted

  Rule: Building footprints are disjoint

    @CB-BDD-003
    Scenario: A service and residential claim the same cell
      Given a service footprint and a residential footprint overlap
      When the solution is validated
      Then the solution is rejected
      And the validation explains that building footprints cannot overlap

  Rule: Roads and buildings must use allowed cells

    @CB-BDD-004
    Scenario: A road and residential claim blocked cells
      Given a grid with blocked cells
      And a road is placed on a blocked cell
      And a residential footprint includes a blocked cell
      When the solution is validated
      Then the solution is rejected
      And the validation explains that roads and buildings must use allowed cells

  Rule: Buildings must be connected to the road anchor

    @CB-BDD-005
    Scenario: Building road connectivity follows the anchor-boundary exception
      Given an interior residential that is not adjacent to any road
      And a boundary residential whose footprint touches row 0
      When the solutions are validated
      Then the interior residential solution is rejected
      And the boundary residential solution is accepted without adjacent road
