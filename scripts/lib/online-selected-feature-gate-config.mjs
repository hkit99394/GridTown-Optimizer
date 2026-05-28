export const SCRIPT_PATH = "scripts/discover-lns-online-selected-feature-gates.mjs";
export const SCORECARD_FILE = "lns-window-ranker-online-ablation.json";
export const DISCOVERY_TARGETS = new Set(["selection-improved", "final-improved"]);
export const DISCOVERY_ARTIFACT_SCHEMA_VERSION = 2;
export const DISCOVERY_IDENTITY_SCHEMA_VERSION = 3;
export const TELEMETRY_MANIFEST_SCHEMA_VERSION = 2;
export const REPORT_IDENTITY_SCHEMA_VERSION = 1;
export const METRIC_SEMANTICS_VERSION = 2;
export const ATOM_CAP_SUMMARY_SEMANTICS_VERSION = 2;
export const METRIC_SEMANTICS = {
  targetImproved:
    "Counts rows that match the selected discovery target. final-improved is attributed only to the terminal override trace with selectedFeatures in each variant.",
  terminalFinalImproved:
    "Counts selected terminal override traces with selectedFeatures whose whole variant final outcome improved versus baseline.",
  terminalFinalRegressed:
    "Counts selected terminal override traces with selectedFeatures whose whole variant final outcome regressed versus baseline.",
  safetyRegressed:
    "Counts selected traces with either a regressed immediate selection outcome or a regressed whole-variant final outcome. Whole-variant final regression is applied to every selected trace in that variant."
};
export const V2_DEPRECATED_METRIC_ALIASES = {
  schemaVersion: 2,
  note: "Schema-v2 compatibility aliases only. Do not use these aliases to reinterpret schema-v1 artifacts, where finalRegressed represented combined safety regression.",
  aliases: {
    finalImproved: "terminalFinalImproved",
    finalRegressed: "terminalFinalRegressed"
  }
};

export function usage() {
  return [
    "Usage: node scripts/discover-lns-online-selected-feature-gates.mjs --source-artifact=<dir> --artifact-dir=<dir> [options]",
    "",
    "Discovers diagnostics-only selected-feature gate groups from online LNS window-ranker override traces.",
    "",
    "Options:",
    "  --source-artifact=<dir>       Online ablation artifact dir containing lns-window-ranker-online-ablation.json. Repeatable.",
    "  --source-scorecard=<path>     Direct path to an online ablation JSON file. Repeatable.",
    "  --validation-source-artifact=<dir>",
    "                                  Optional validation artifact dir containing lns-window-ranker-online-ablation.json. Repeatable.",
    "  --validation-source-scorecard=<path>",
    "                                  Optional direct validation online ablation JSON path. Repeatable.",
    "  --artifact-dir=<dir>          Artifact bundle output directory under artifacts/.",
    "  --feature-allowlist=<csv>     Restrict candidate features to these selectedFeatures names.",
    "  --target=<name>               Gate objective: selection-improved or final-improved. Default: selection-improved.",
    "  --max-group-size=<n>          Maximum conjunction size in atoms. Default: 2.",
    "  --max-atoms-per-feature=<n>   Candidate atom cap per feature. Default: 12.",
    "  --max-total-atoms=<n>         Global atom cap after per-feature ranking. Default: 120.",
    "  --top=<n>                     Number of ranked groups to keep. Default: 25.",
    "  --force-artifact-dir          Replace an existing artifact directory."
  ].join("\n");
}
