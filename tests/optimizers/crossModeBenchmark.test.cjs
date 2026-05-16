const { testCrossModeBenchmarkBudgetAblationAssertions } = require("./crossModeBenchmarkBudgetAblationAssertions.cjs");
const { testCrossModeBenchmarkCliAssertions } = require("./crossModeBenchmarkCliAssertions.cjs");
const { testCrossModeBenchmarkParamsAssertions } = require("./crossModeBenchmarkParamsAssertions.cjs");
const { testCrossModeBenchmarkSuiteAssertions } = require("./crossModeBenchmarkSuiteAssertions.cjs");

async function runCrossModeBenchmarkTests() {
  await testCrossModeBenchmarkParamsAssertions();
  await testCrossModeBenchmarkSuiteAssertions();
  await testCrossModeBenchmarkCliAssertions();
  await testCrossModeBenchmarkBudgetAblationAssertions();
}

runCrossModeBenchmarkTests()
  .then(() => {
    console.log("Cross-mode benchmark tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
