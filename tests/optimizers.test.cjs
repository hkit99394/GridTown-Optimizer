const { OPTIMIZER_TEST_GROUP_NAMES, runOptimizerTestGroup } = require("./optimizers/optimizerHarness.cjs");

async function main() {
  const requestedGroups = process.argv.slice(2);
  const groupsToRun = requestedGroups.length > 0 ? requestedGroups : OPTIMIZER_TEST_GROUP_NAMES;
  for (const groupName of groupsToRun) {
    await runOptimizerTestGroup(groupName);
  }
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
  runOptimizerTestGroup,
};
