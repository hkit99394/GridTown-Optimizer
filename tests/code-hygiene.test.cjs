const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkedRoots = ["src", "apps", "tests", "python"];
const checkedExtensions = new Set([".ts", ".js", ".cjs", ".mjs", ".py"]);
const skippedDirectories = new Set(["dist", "node_modules"]);
const docsConsistencyRoots = [path.join(repoRoot, "docs", "decisions"), path.join(repoRoot, "docs", "roadmaps")];
const learnedGuidanceRoadmap = path.join(repoRoot, "docs", "roadmaps", "LEARNED_GUIDANCE_ROADMAP.md");

const blockedPatterns = [
  {
    label: "TypeScript suppression comment",
    pattern: new RegExp("@ts-" + "(?:ignore|expect-error)")
  },
  {
    label: "ESLint suppression comment",
    pattern: new RegExp("eslint-" + "disable")
  },
  {
    label: "debug statement",
    pattern: new RegExp("\\b" + "debug" + "ger\\b")
  },
  {
    label: "pending-work marker",
    pattern: new RegExp("\\b(?:" + "TO" + "DO|FIX" + "ME)\\b")
  }
];

const broadlyBlockedDocsPhrases = [
  "next CP-SAT priority is using the exact backend as a label and replay engine",
  "next CP-SAT priority is label and replay engine work",
  "Remaining benchmark, distributed-execution, and label/replay work stays",
  "No learned runtime scorer has been integrated, feature-flagged, or benchmarked online",
  "remains diagnostics-only with no runtime hook or solver default change",
  "LNS model promotion still needs a strict generated artifact",
  "strict generated artifact proving the scaled corpus passes readiness thresholds",
  "The next learned-LNS priority is",
  "the next learned-LNS work needs",
  "points the next work toward transition/family-aware gating or improved features",
  "This finishes the current next target as positive diagnostics:",
  "the next evidence target is to pair the product-nomination model with a protected-neutral suppressor and rerun product/protected online scorecards before any promotion-gate recheck",
  "the next step still needs either a better suppressor objective or a nomination gate that removes the remaining protected neutral override families without erasing product expansion wins",
  "This closes the current promotion recheck target:",
  "the two active investigation rows",
  "Learned guidance is not ready until traces show repeated ranking mistakes and enough counterfactual labels exist.",
  "Keep LNS replay pressure cases as label-generation infrastructure until strict artifacts pass readiness, offline baselines, and online gates.",
  "Learned ranking remains blocked until label collection and held-out evaluation exist.",
  "Next work should move to low-risk learned guidance preparation:"
];

const learnedGuidanceRoadmapBlockedPhrases = [
  "The current recommended order inside the learned-guidance track is:",
  "The recommended sequence is:",
  "add deterministic feature extraction for:",
  "include deterministic features such as headroom, service marginal value, and connectivity shadow for each replayed window",
  "Status: Scale-up infrastructure delivered; strict label artifact still required before learned `LNS` window re-ranking",
  "Exit criteria:\n\n- at least 5 pressure families\n- at least 3 seeds per family\n- at least 200 usable labels in each of development and holdout",
  "If the consolidated solver roadmap reopens learned-guidance work because new protected/fresh value coverage appears or a materially different model class is proposed",
  "If the consolidated solver roadmap reopen trigger is met, reuse this historical gated sequence:",
  "future work needs new protected/fresh value coverage or a materially different model class",
  "Reopen promotion work only for new protected/fresh value coverage or a materially different model class.",
  "add a feature-flagged `rerankNeighborhoodWindows(...)` stage",
  "durable experiment registry with commit, params, data, hardware, model, and decision fingerprints",
  "add a separate re-ranking step after window generation and before selection",
  "Exit criteria:\n\n- learned re-ranking improves `best population at fixed repair budget`\n- learned re-ranking improves `time-to-strong-incumbent`\n- deterministic fallback remains unchanged and existing baseline tests remain valid\n- holdout data includes enough non-neutral replay signal to evaluate ranking skill\n- online A/B uses paired seeds, exact validation, and bounded inference overhead"
];

const docsPhraseChecks = [
  {
    roots: docsConsistencyRoots,
    phrases: broadlyBlockedDocsPhrases
  },
  {
    files: [learnedGuidanceRoadmap],
    phrases: learnedGuidanceRoadmapBlockedPhrases
  }
];

function listFiles(dir, extensions = checkedExtensions) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, extensions);
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function collectBlockedMatches() {
  return checkedRoots.flatMap((root) =>
    listFiles(path.join(repoRoot, root)).flatMap((filePath) => {
      const relativePath = path.relative(repoRoot, filePath);
      const lines = fs.readFileSync(filePath, "utf8").split(/\r\n|\r|\n/);
      return lines.flatMap((line, index) =>
        blockedPatterns
          .filter(({ pattern }) => pattern.test(line))
          .map(({ label }) => ({
            relativePath,
            line: index + 1,
            label
          }))
      );
    })
  );
}

function testCodeHygieneMarkersStayOutOfSource() {
  assert.deepEqual(collectBlockedMatches(), []);
}

function collectBlockedDocsPhrases() {
  return docsPhraseChecks.flatMap(({ files, roots = [], phrases }) => {
    const paths = files ?? roots.flatMap((root) => listFiles(root, new Set([".md"])));
    return paths.flatMap((filePath) => {
      const relativePath = path.relative(repoRoot, filePath);
      const content = fs.readFileSync(filePath, "utf8");
      return phrases.filter((phrase) => content.includes(phrase)).map((phrase) => ({ relativePath, phrase }));
    });
  });
}

function testDocsStayOnConsolidatedStatus() {
  assert.deepEqual(collectBlockedDocsPhrases(), []);
}

testCodeHygieneMarkersStayOutOfSource();
testDocsStayOnConsolidatedStatus();
