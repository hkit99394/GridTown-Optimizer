const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("core")
  .then(() => {
    console.log("Optimizer core tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
