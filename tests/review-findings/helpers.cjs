const assert = require("node:assert/strict");

const { CP_SAT_PORTFOLIO_CAPABILITY_LIMITS, solve } = require("city-builder/solver");
const { evaluateLayout } = require("../../dist/packages/core/evaluator.js");
const { buildManualLayoutResponse, buildSolveResponse } = require("../../dist/apps/planner-server/http/contracts.js");
const {
  createFakeDomElement,
  loadPlannerExpansionModule,
  loadPlannerManualLayoutModule,
  loadPlannerPersistenceModule,
  loadPlannerResultRenderingModule,
  loadPlannerRequestBuilderModule,
  loadPlannerResultsModule,
  loadPlannerSharedModule,
  loadPlannerShellModule,
  loadPlannerWorkbenchModule
} = require("../helpers/plannerBrowserModules.cjs");

module.exports = {
  assert,
  CP_SAT_PORTFOLIO_CAPABILITY_LIMITS,
  solve,
  evaluateLayout,
  buildManualLayoutResponse,
  buildSolveResponse,
  createFakeDomElement,
  loadPlannerExpansionModule,
  loadPlannerManualLayoutModule,
  loadPlannerPersistenceModule,
  loadPlannerResultRenderingModule,
  loadPlannerRequestBuilderModule,
  loadPlannerResultsModule,
  loadPlannerSharedModule,
  loadPlannerShellModule,
  loadPlannerWorkbenchModule
};
