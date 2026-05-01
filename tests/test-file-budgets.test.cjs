const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultTestFileBudget = 1500;

const temporaryOversizedBudgets = new Map([
  ["tests/optimizers/optimizerHarness.cjs", 9689],
  ["tests/review-findings.test.cjs", 4350],
  ["tests/web-server-routes.test.cjs", 1902],
]);

function listFiles(dir, predicate) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, predicate);
    return entry.isFile() && predicate(entry.name) ? [entryPath] : [];
  });
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content) return 0;
  return content.endsWith("\n")
    ? content.split(/\r\n|\r|\n/).length - 1
    : content.split(/\r\n|\r|\n/).length;
}

function testTestFilesStayWithinLineBudgets() {
  const oversizedFiles = listFiles(path.join(repoRoot, "tests"), (fileName) => fileName.endsWith(".cjs"))
    .map((filePath) => {
      const relativePath = path.relative(repoRoot, filePath);
      const maxLines = temporaryOversizedBudgets.get(relativePath) ?? defaultTestFileBudget;
      return {
        relativePath,
        lineCount: countLines(filePath),
        maxLines,
      };
    })
    .filter(({ lineCount, maxLines }) => lineCount > maxLines);

  assert.deepEqual(oversizedFiles, []);
}

testTestFilesStayWithinLineBudgets();
