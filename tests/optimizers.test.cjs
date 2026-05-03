const {
  OPTIMIZER_TEST_GROUP_NAMES,
  runOptimizerTestGroup,
  runRequestedOptimizerTestGroups
} = require("./optimizers/optimizerGroups.cjs");

async function main() {
  await runRequestedOptimizerTestGroups();
  console.log("Optimizer backend tests passed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  OPTIMIZER_TEST_GROUP_NAMES,
  runOptimizerTestGroup
};
