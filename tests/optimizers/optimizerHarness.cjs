const { runAutoOptimizerTests } = require("./optimizerAutoAssertions.cjs");
const { runBenchmarksOptimizerTests } = require("./optimizerBenchmarkAssertions.cjs");
const { runCoreOptimizerTests } = require("./optimizerCoreAssertions.cjs");
const { runCpSatOptimizerTests } = require("./optimizerCpSatAssertions.cjs");
const { runGreedyOptimizerTests } = require("./optimizerGreedyAssertions.cjs");
const { runLnsOptimizerTests } = require("./optimizerLnsAssertions.cjs");

module.exports = {
  runAutoOptimizerTests,
  runBenchmarksOptimizerTests,
  runCoreOptimizerTests,
  runCpSatOptimizerTests,
  runGreedyOptimizerTests,
  runLnsOptimizerTests
};
