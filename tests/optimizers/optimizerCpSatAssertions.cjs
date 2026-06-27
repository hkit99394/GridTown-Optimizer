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
  maybeTestCpSatUsesOnlyConfiguredRoadAnchors,
  maybeTestCpSatAllowsMultiAnchorComponentsInOptimization,
  maybeTestCpSatNoOverlap2dEncodingProducesValidSolution,
  maybeTestCpSatSyncCompatibility,
  testCpSatRejectsSemanticallyInvalidRawSolution,
  testCpSatNormalizesUnderReportedRawPopulation,
  maybeTestCpSatSupportsShapedServices,
  maybeTestCpSatBackendJsonContractSmoke,
  maybeTestCpSatBackendStreamingProtocol,
  maybeTestCpSatObjectivePolicyHelpers,
  maybeTestCpSatNoOverlap2dModelEncodingHelpers,
  maybeTestCpSatRuntimeOptionHelpers,
  testCpSatSyncEnforcesBackendTimeout,
  testCpSatDirectReturnsZeroForExplicitEmptyRoadAnchors,
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
  testCpSatBackgroundHonorsBackendTimeout,
  testCpSatBackgroundReturnsZeroForExplicitEmptyRoadAnchors,
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
  maybeTestCpSatNoOverlap2dModelEncodingHelpers();
  maybeTestCpSatRuntimeOptionHelpers();
  testCpSatSyncEnforcesBackendTimeout();
  await testCpSatDirectReturnsZeroForExplicitEmptyRoadAnchors();
  maybeTestCpSatWarmStartHelpers();
  maybeTestCpSatSnapshotResponseHelpers();
  maybeTestCpSatNoImprovementTimeoutHelpers();
  maybeTestCpSatSnapshotWritesTelemetry();
  maybeTestCpSatPortfolioOptionHelpers();
  testCpSatPortfolioExecutorFallbackHelpers();
  await testCpSatAsyncRejectsMalformedStreamedProgress();
  await testCpSatAsyncRejectsStreamedProgressWithoutFinalResult();
  await testCpSatAsyncRejectsChildProcessFailureWithDiagnostics();
  await testCpSatBackgroundHonorsBackendTimeout();
  await testCpSatBackgroundReturnsZeroForExplicitEmptyRoadAnchors();
  await testCpSatAsyncRejectsMalformedPortfolioProgressAndStopsBackend();
  await testCpSatBackgroundCancelReturnsPortfolioSnapshot();
  maybeTestCpSatPopulationUpperBoundHelpers();
  maybeTestCpSatResidentialPopulationUpperBoundHelpers();
  await maybeTestCpSatOptimizer();
  await maybeTestCpSatUsesColumnZeroRoadAnchor();
  await maybeTestCpSatUsesOnlyConfiguredRoadAnchors();
  await maybeTestCpSatAllowsMultiAnchorComponentsInOptimization();
  await maybeTestCpSatNoOverlap2dEncodingProducesValidSolution();
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
