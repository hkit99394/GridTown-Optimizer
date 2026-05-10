const { runLnsWindowRankerCliAssertions } = require("./lnsWindowRankerCliAssertions.cjs");
const { runLnsWindowRankerExperimentAssertions } = require("./lnsWindowRankerExperimentAssertions.cjs");
const { runLnsWindowRankerGapDiagnosticsAssertions } = require("./lnsWindowRankerGapDiagnosticsAssertions.cjs");

runLnsWindowRankerExperimentAssertions();
runLnsWindowRankerGapDiagnosticsAssertions();
runLnsWindowRankerCliAssertions();
