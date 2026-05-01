const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("auto")
  .then(() => {
    console.log("Optimizer auto tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
