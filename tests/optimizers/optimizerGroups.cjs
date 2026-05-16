const {
  runAutoOptimizerTests,
  runBenchmarksOptimizerTests,
  runCoreOptimizerTests,
  runCpSatOptimizerTests,
  runGreedyOptimizerTests,
  runLnsOptimizerTests
} = require("./optimizerHarness.cjs");

const OPTIMIZER_TEST_GROUPS = {
  core: runCoreOptimizerTests,
  greedy: runGreedyOptimizerTests,
  cpSat: runCpSatOptimizerTests,
  auto: runAutoOptimizerTests,
  lns: runLnsOptimizerTests,
  benchmarks: runBenchmarksOptimizerTests
};

const OPTIMIZER_TEST_GROUP_NAMES = Object.freeze(Object.keys(OPTIMIZER_TEST_GROUPS));

async function runOptimizerTestGroup(groupName) {
  const runner = OPTIMIZER_TEST_GROUPS[groupName];
  if (!runner) {
    throw new Error(
      `Unknown optimizer test group: ${groupName}. Expected one of: ${OPTIMIZER_TEST_GROUP_NAMES.join(", ")}.`
    );
  }
  await runner();
}

async function runOptimizerTestGroups(groupNames) {
  for (const groupName of groupNames) {
    await runOptimizerTestGroup(groupName);
  }
}

async function runRequestedOptimizerTestGroups(requestedGroups = process.argv.slice(2)) {
  const groupsToRun = requestedGroups.length > 0 ? requestedGroups : OPTIMIZER_TEST_GROUP_NAMES;
  await runOptimizerTestGroups(groupsToRun);
}

module.exports = {
  OPTIMIZER_TEST_GROUP_NAMES,
  runOptimizerTestGroup,
  runOptimizerTestGroups,
  runRequestedOptimizerTestGroups
};
