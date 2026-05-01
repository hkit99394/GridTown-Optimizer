const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("cpSat")
  .then(() => {
    console.log("Optimizer cpSat tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
