const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultSourceFileBudget = 900;

const sourceRoots = ["src", "apps", "python", "scripts"];
const sourceExtensions = new Set([".ts", ".js", ".mjs", ".css", ".html", ".py"]);

function listFiles(dir, predicate) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, predicate);
    return entry.isFile() && predicate(entryPath) ? [entryPath] : [];
  });
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content) return 0;
  return content.endsWith("\n") ? content.split(/\r\n|\r|\n/).length - 1 : content.split(/\r\n|\r|\n/).length;
}

function testSourceFilesStayWithinLineBudgets() {
  const oversizedFiles = sourceRoots
    .flatMap((sourceRoot) =>
      listFiles(path.join(repoRoot, sourceRoot), (filePath) => sourceExtensions.has(path.extname(filePath)))
    )
    .map((filePath) => {
      const relativePath = path.relative(repoRoot, filePath);
      return {
        relativePath,
        lineCount: countLines(filePath),
        maxLines: defaultSourceFileBudget
      };
    })
    .filter(({ lineCount, maxLines }) => lineCount > maxLines);

  assert.deepEqual(oversizedFiles, []);
}

testSourceFilesStayWithinLineBudgets();
