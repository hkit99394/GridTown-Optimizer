const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("benchmarks")
  .then(() => {
    console.log("Optimizer benchmarks tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
