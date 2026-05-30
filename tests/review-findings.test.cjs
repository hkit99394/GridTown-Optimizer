const { runSolverRegressionTests } = require("./review-findings/solverRegressionTests.cjs");
const { runPlannerRequestBasicsTests } = require("./review-findings/plannerRequestBasicsTests.cjs");
const { runPlannerSavedLayoutTests } = require("./review-findings/plannerSavedLayoutTests.cjs");
const { runPlannerResultsTests } = require("./review-findings/plannerResultsTests.cjs");
const { runPlannerResponseTests } = require("./review-findings/plannerResponseTests.cjs");
const { runPlannerContinuationTests } = require("./review-findings/plannerContinuationTests.cjs");
const { runPlannerContinuationPayloadTests } = require("./review-findings/plannerContinuationPayloadTests.cjs");

async function main() {
  await runSolverRegressionTests();
  await runPlannerRequestBasicsTests();
  await runPlannerSavedLayoutTests();
  await runPlannerResultsTests();
  await runPlannerResponseTests();
  await runPlannerContinuationTests();
  await runPlannerContinuationPayloadTests();
  console.log("All review finding regression tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
