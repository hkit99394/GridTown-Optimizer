import type { CrossModeBenchmarkMode } from "./crossMode.js";

export const MODE_LABELS: Record<CrossModeBenchmarkMode, string> = {
  auto: "Auto",
  greedy: "Greedy",
  lns: "LNS",
  "cp-sat": "CP-SAT",
  "cp-sat-portfolio": "CP-SAT portfolio",
};

