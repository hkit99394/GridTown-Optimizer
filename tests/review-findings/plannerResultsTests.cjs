const { runPlannerResultsExplainabilityTests } = require("./plannerResultsExplainabilityTests.cjs");
const { runPlannerResultsHeatmapTests } = require("./plannerResultsHeatmapTests.cjs");
const { runPlannerResultsLayoutEditorTests } = require("./plannerResultsLayoutEditorTests.cjs");
const { runPlannerResultsStatusDiagnosticsTests } = require("./plannerResultsStatusDiagnosticsTests.cjs");

async function runPlannerResultsTests() {
  runPlannerResultsLayoutEditorTests();
  runPlannerResultsStatusDiagnosticsTests();
  runPlannerResultsHeatmapTests();
  runPlannerResultsExplainabilityTests();
}

module.exports = {
  runPlannerResultsTests
};
