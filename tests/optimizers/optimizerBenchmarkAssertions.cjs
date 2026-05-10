const {
  runGreedyBenchmarkSetupAssertions,
  runGreedyBenchmarkRegressionAssertions
} = require("./optimizerHarnessDeps.cjs");

const { runOptimizerLabelBenchmarkAssertions } = require("./optimizerLabelBenchmarkAssertions.cjs");

const { runOptimizerBenchmarkSuiteAssertions } = require("./optimizerBenchmarkSuiteAssertions.cjs");

async function runBenchmarksOptimizerTests() {
  runOptimizerLabelBenchmarkAssertions();
  runGreedyBenchmarkSetupAssertions();
  runGreedyBenchmarkRegressionAssertions();
  await runOptimizerBenchmarkSuiteAssertions();
}

module.exports = {
  runBenchmarksOptimizerTests
};
