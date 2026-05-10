const {
  maybeTestCpSatBorderAccessCapacityHelpers,
  maybeTestCpSatAllowsMultipleAnchoredRoadComponents,
  maybeTestCpSatCandidateReductionHelpers,
  maybeTestCpSatConnectivityHelperConstraints,
  maybeTestCpSatDisallowsBidirectionalRoadFlow,
  maybeTestCpSatGateRegionalCapacityHelpers,
  maybeTestCpSatGateRequirementHelpers,
  maybeTestCpSatPopulationUpperBoundHelpers,
  maybeTestCpSatPrunesObjectivelyUselessServices,
  maybeTestCpSatReachabilityReductionHelpers,
  maybeTestCpSatResidentialPopulationUpperBoundHelpers,
  maybeTestCpSatRoadEligibilityReductionHelpers
} = require("./optimizerHarnessDeps.cjs");

const {
  testAutoKeepsEqualPopulationOptimalCpSatResult,
  testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns,
  testAutoAsyncRecoveredCpSatSnapshotKeepsCompletedMetadata,
  testAutoSyncReservesCpSatBudgetBeforeLnsStage
} = require("./optimizerAutoAssertions.cjs");

const {
  maybeTestCpSatOptimizer,
  maybeTestCpSatUsesColumnZeroRoadAnchor,
  maybeTestCpSatAllowsMultiAnchorComponentsInOptimization,
  maybeTestCpSatSyncCompatibility,
  testCpSatRejectsSemanticallyInvalidRawSolution,
  testCpSatNormalizesUnderReportedRawPopulation,
  maybeTestCpSatSupportsShapedServices,
  maybeTestCpSatBackendJsonContractSmoke,
  maybeTestCpSatBackendStreamingProtocol,
  maybeTestCpSatObjectivePolicyHelpers,
  maybeTestCpSatRuntimeOptionHelpers,
  maybeTestCpSatWarmStartHelpers,
  maybeTestCpSatSnapshotResponseHelpers,
  maybeTestCpSatNoImprovementTimeoutHelpers,
  maybeTestCpSatSnapshotWritesTelemetry
} = require("./optimizerCpSatRuntimeAssertions.cjs");

const {
  maybeTestCpSatWarmStartContinuation,
  maybeTestCpSatPortfolioOptionHelpers,
  testCpSatPortfolioExecutorFallbackHelpers,
  testCpSatAsyncRejectsMalformedStreamedProgress,
  testCpSatAsyncRejectsStreamedProgressWithoutFinalResult,
  testCpSatAsyncRejectsChildProcessFailureWithDiagnostics,
  testCpSatBackgroundCancelReturnsPortfolioSnapshot,
  testCpSatAsyncRejectsMalformedPortfolioProgressAndStopsBackend,
  maybeTestCpSatPortfolioSolve,
  maybeTestCpSatAsyncOptimizer
} = require("./optimizerCpSatAsyncAssertions.cjs");

const {
  testCpSatRejectsDuplicatePortfolioWorkerIndices,
  testCpSatRejectsDanglingSelectedPortfolioWorkerIndex,
  maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie,
  maybeTestCpSatObjectiveAvoidsUselessServices
} = require("./optimizerCpSatPolicyAssertions.cjs");

async function runCpSatOptimizerTests() {
  maybeTestCpSatBackendJsonContractSmoke();
  maybeTestCpSatBackendStreamingProtocol();
  maybeTestCpSatObjectivePolicyHelpers();
  maybeTestCpSatRuntimeOptionHelpers();
  maybeTestCpSatWarmStartHelpers();
  maybeTestCpSatSnapshotResponseHelpers();
  maybeTestCpSatNoImprovementTimeoutHelpers();
  maybeTestCpSatSnapshotWritesTelemetry();
  maybeTestCpSatPortfolioOptionHelpers();
  testCpSatPortfolioExecutorFallbackHelpers();
  await testCpSatAsyncRejectsMalformedStreamedProgress();
  await testCpSatAsyncRejectsStreamedProgressWithoutFinalResult();
  await testCpSatAsyncRejectsChildProcessFailureWithDiagnostics();
  await testCpSatAsyncRejectsMalformedPortfolioProgressAndStopsBackend();
  await testCpSatBackgroundCancelReturnsPortfolioSnapshot();
  maybeTestCpSatPopulationUpperBoundHelpers();
  maybeTestCpSatResidentialPopulationUpperBoundHelpers();
  await maybeTestCpSatOptimizer();
  await maybeTestCpSatUsesColumnZeroRoadAnchor();
  await maybeTestCpSatAllowsMultiAnchorComponentsInOptimization();
  maybeTestCpSatSyncCompatibility();
  testCpSatRejectsSemanticallyInvalidRawSolution();
  testCpSatNormalizesUnderReportedRawPopulation();
  await maybeTestCpSatAsyncOptimizer();
  testAutoKeepsEqualPopulationOptimalCpSatResult();
  await testAutoAsyncPreservesCancelledStopReasonAfterCpSatReturns();
  await testAutoAsyncRecoveredCpSatSnapshotKeepsCompletedMetadata();
  testAutoSyncReservesCpSatBudgetBeforeLnsStage();
  await maybeTestCpSatWarmStartContinuation();
  await maybeTestCpSatPortfolioSolve();
  await maybeTestCpSatObjectivePrefersFewerRoadsOnPopulationTie();
  await maybeTestCpSatObjectiveAvoidsUselessServices();
  maybeTestCpSatPrunesObjectivelyUselessServices();
  maybeTestCpSatBorderAccessCapacityHelpers();
  maybeTestCpSatGateRequirementHelpers();
  maybeTestCpSatGateRegionalCapacityHelpers();
  await maybeTestCpSatSupportsShapedServices();
  maybeTestCpSatCandidateReductionHelpers();
  maybeTestCpSatReachabilityReductionHelpers();
  maybeTestCpSatConnectivityHelperConstraints();
  maybeTestCpSatAllowsMultipleAnchoredRoadComponents();
  maybeTestCpSatRoadEligibilityReductionHelpers();
  maybeTestCpSatDisallowsBidirectionalRoadFlow();
  testCpSatRejectsDuplicatePortfolioWorkerIndices();
  testCpSatRejectsDanglingSelectedPortfolioWorkerIndex();
}

module.exports = {
  runCpSatOptimizerTests
};
