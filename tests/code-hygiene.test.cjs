const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkedRoots = ["src", "apps", "tests", "python"];
const checkedExtensions = new Set([".ts", ".js", ".cjs", ".mjs", ".py"]);
const skippedDirectories = new Set(["dist", "node_modules"]);

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

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() && checkedExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
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

testCodeHygieneMarkersStayOutOfSource();
