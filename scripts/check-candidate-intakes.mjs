#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const roadmapDir = path.join(repoRoot, "docs", "roadmaps");
const m15EffectiveDate = "2026-06-01";

function usage() {
  return [
    "Usage: node scripts/check-candidate-intakes.mjs [options]",
    "",
    "Checks M9 solver candidate intake docs for the M15 trigger-ledger gate.",
    "",
    "Options:",
    "  --files=<csv>    Comma-separated intake doc paths. Defaults to docs/roadmaps/M9_CANDIDATE_INTAKE_*.md.",
    "  --strict-all     Apply M15 checks to every provided file, including legacy docs.",
    "  --json           Print machine-readable summary.",
    "  --help           Show this help."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    files: undefined,
    json: false,
    strictAll: false
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--strict-all") {
      args.strictAll = true;
      continue;
    }
    const separator = arg.indexOf("=");
    if (!arg.startsWith("--") || separator === -1) {
      throw new Error(`Unknown argument '${arg}'.`);
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1);
    if (name === "files") {
      args.files = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return args;
}

function defaultIntakeFiles() {
  return fs
    .readdirSync(roadmapDir)
    .filter((fileName) => /^M9_CANDIDATE_INTAKE_.*\.md$/.test(fileName))
    .map((fileName) => path.join(roadmapDir, fileName))
    .sort();
}

function resolveFile(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function displayPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function lineValue(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`^${escapedLabel}:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim() ?? "";
}

function section(content, startPattern, endPattern = /^##\s+/m) {
  const startMatch = startPattern.exec(content);
  if (!startMatch) return "";
  const bodyStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(bodyStart);
  const endMatch = endPattern.exec(rest);
  return (endMatch ? rest.slice(0, endMatch.index) : rest).trim();
}

function triggerSourceBlock(content) {
  const trigger = section(content, /^## Trigger\s*$/m);
  if (!trigger) return "";
  const sourceMatch = /^Trigger source:\s*$/im.exec(trigger);
  if (!sourceMatch) return "";
  const afterSource = trigger.slice(sourceMatch.index + sourceMatch[0].length);
  const observedMatch = /^Observed problem:\s*$/im.exec(afterSource);
  return (observedMatch ? afterSource.slice(0, observedMatch.index) : afterSource).trim();
}

function hasRealTriggerSource(content) {
  const source = triggerSourceBlock(content);
  if (!source) return false;
  const nonPlaceholderLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .filter((line) => !/\b(?:tbd|todo|none|n\/a|unknown)\b/i.test(line));
  return nonPlaceholderLines.some((line) => line.replace(/^-\s*/, "").length >= 12);
}

function dateIsOnOrAfter(dateValue, threshold) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateValue) && dateValue >= threshold;
}

function requiresM15(content, { strictAll }) {
  if (strictAll) return true;
  const date = lineValue(content, "Date");
  const status = lineValue(content, "Status");
  if (dateIsOnOrAfter(date, m15EffectiveDate)) return true;
  if (/\b(?:proposed|ready-to-implement|intake-ready)\b/i.test(status)) return true;
  return /MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER\.md/.test(content);
}

function checkBasicShape(content, issues) {
  if (!/^# Solver Candidate Intake:\s+\S+/m.test(content)) {
    issues.push("missing '# Solver Candidate Intake: <candidate-id>' heading");
  }
  if (!lineValue(content, "Date")) {
    issues.push("missing Date field");
  }
  if (!lineValue(content, "Status")) {
    issues.push("missing Status field");
  }
  if (!/^## Trigger\s*$/m.test(content)) {
    issues.push("missing Trigger section");
  }
  if (!/^Trigger source:\s*$/im.test(content)) {
    issues.push("missing Trigger source block");
  }
  if (!/^Runtime default change proposed now:\s*(?:yes|no)\s*$/im.test(content)) {
    issues.push("missing explicit runtime-default change line");
  }
}

function checkM15Gate(content, issues) {
  if (!hasRealTriggerSource(content)) {
    issues.push("M15 gate requires a real trigger source, not a placeholder");
  }
  if (!/MIDDLE_RUN_CANDIDATE_TRIGGER_LEDGER\.md/.test(content)) {
    issues.push("M15 gate requires a link to the admitted trigger-ledger record");
  }
  if (!/artifact-hygiene:status/.test(content) || !/Artifact hygiene preflight/i.test(content)) {
    issues.push("M15 gate requires an artifact hygiene preflight using npm run artifact-hygiene:status");
  }
  if (!/Baseline controls:/i.test(content) || !/baseline-repeat/i.test(content)) {
    issues.push("M15 gate requires a same-slice baseline-repeat control shape");
  }
  if (
    !/Evaluator and replay gates:/i.test(content) ||
    !/(candidate-evaluator-validity|Final-layout evaluator-validity plan)/i.test(content)
  ) {
    issues.push("M15 gate requires candidate-specific evaluator-validity and replay gates");
  }
  if (!/^## Artifact Policy\s*$/m.test(content)) {
    issues.push("M15 gate requires an Artifact Policy section");
  }
  if (!/Expected files to keep in git when small:/i.test(content)) {
    issues.push("M15 gate requires tracked summary/artifact expectations");
  }
  if (!/Expected files to move to release\/external storage if large:/i.test(content)) {
    issues.push("M15 gate requires release/external storage expectations for large raw evidence");
  }
  if (!/Registry plan:/i.test(content)) {
    issues.push("M15 gate requires a registry plan");
  }
}

function checkFile(filePath, options) {
  const content = fs.readFileSync(filePath, "utf8");
  const issues = [];
  checkBasicShape(content, issues);
  const m15Required = requiresM15(content, options);
  if (m15Required) checkM15Gate(content, issues);
  return {
    filePath,
    m15Required,
    issueCount: issues.length,
    issues
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = (args.files ?? defaultIntakeFiles()).map(resolveFile);
  const checks = files.map((filePath) => checkFile(filePath, args));
  const issueCount = checks.reduce((sum, check) => sum + check.issueCount, 0);
  const summary = {
    checkedCount: checks.length,
    m15EnforcedCount: checks.filter((check) => check.m15Required).length,
    legacyAcceptedCount: checks.filter((check) => !check.m15Required).length,
    issueCount,
    checks: checks.map((check) => ({
      filePath: displayPath(check.filePath),
      m15Required: check.m15Required,
      issues: check.issues
    }))
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (issueCount === 0) {
    process.stdout.write(
      `Candidate intake check passed: ${summary.checkedCount} docs checked, ` +
        `${summary.m15EnforcedCount} M15-enforced, ${summary.legacyAcceptedCount} legacy accepted.\n`
    );
  } else {
    for (const check of checks) {
      for (const issue of check.issues) {
        process.stderr.write(`[candidate-intake] ${displayPath(check.filePath)}: ${issue}\n`);
      }
    }
  }

  if (issueCount > 0) {
    process.exitCode = 1;
  }
}

main();
