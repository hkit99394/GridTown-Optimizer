Feature: Planner API optimizer and solve response contract

  The planner API should expose solver behavior in a stable shape that the
  interactive planner can trust for default optimizer selection, validation,
  and result summaries.

  Rule: Interactive solve requests default to auto

    @CB-BDD-006
    Scenario: A solve request omits optimizer
      Given an interactive solve request without params.optimizer
      When the solve API runs the request
      Then the selected optimizer is auto
      And the response reports auto as the optimizer

  Rule: Solve responses include validation and matching stats

    @CB-BDD-007
    Scenario: A solved layout is returned through the solve API
      Given a valid solve request
      When the solve API returns a solved layout
      Then the response validation is valid
      And the response stats match the solved layout
