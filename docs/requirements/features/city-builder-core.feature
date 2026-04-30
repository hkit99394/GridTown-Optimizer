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

  Rule: Building footprints are disjoint

    Scenario: A service and residential claim the same cell
      Given a service footprint and a residential footprint overlap
      When the solution is validated
      Then the solution is rejected
      And the validation explains that building footprints cannot overlap
