const { runOptimizerTestGroup } = require("../optimizerHarness.cjs");

runOptimizerTestGroup("lns")
  .then(() => {
    console.log("Optimizer lns tests passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
