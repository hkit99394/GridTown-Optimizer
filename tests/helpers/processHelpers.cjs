const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @param {string} [repoRoot]
 * @returns {string | null}
 */
function resolveCpSatPython(repoRoot = path.resolve(__dirname, "../..")) {
  const venvPython = path.resolve(repoRoot, ".venv-cp-sat/bin/python");
  const candidates = [
    fs.existsSync(venvPython) ? venvPython : null,
    process.env.CITY_BUILDER_CP_SAT_PYTHON || null,
    "python3"
  ].flatMap((candidate) => (typeof candidate === "string" && candidate.length > 0 ? [candidate] : []));

  for (const pythonExecutable of candidates) {
    const importCheck = childProcess.spawnSync(pythonExecutable, ["-c", "import ortools"], {
      encoding: "utf8"
    });
    if (importCheck.status === 0) {
      return pythonExecutable;
    }
  }

  console.log("Skipping CP-SAT optimizer test because no Python runtime with OR-Tools is configured.");
  return null;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} filePath
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitForFile(filePath, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${filePath}.`);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function readFileIfPresent(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} heartbeatPath
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
async function waitForHeartbeatToStop(heartbeatPath, timeoutMs = 1500) {
  const startedAt = Date.now();
  let previousHeartbeat = readFileIfPresent(heartbeatPath);
  let stableSince = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await delay(30);
    const currentHeartbeat = readFileIfPresent(heartbeatPath);
    if (currentHeartbeat === previousHeartbeat) {
      if (Date.now() - stableSince >= 150) return;
      continue;
    }
    previousHeartbeat = currentHeartbeat;
    stableSince = Date.now();
  }

  assert.fail("Background child process kept writing heartbeats after cancellation.");
}

module.exports = {
  delay,
  resolveCpSatPython,
  waitForFile,
  waitForHeartbeatToStop
};
