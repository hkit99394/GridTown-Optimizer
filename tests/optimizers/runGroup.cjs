const { runOptimizerTestGroup } = require("./optimizerHarness.cjs");

function runOptimizerGroupCli(groupName, successMessage) {
  runOptimizerTestGroup(groupName)
    .then(() => {
      console.log(successMessage);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runOptimizerGroupCli
};
