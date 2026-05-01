const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("greedy")
  .then(() => {
    console.log("Optimizer greedy tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
