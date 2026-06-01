#!/usr/bin/env node

import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultRunDate = "2026-06-01";
const stagingRoot = path.join(repoRoot, "release-assets", "artifact-hygiene", defaultRunDate, "unindexed-raw");
const recoveryPlanPath = "docs/roadmaps/ARTIFACT_HYGIENE_RECOVERY_PLAN.md";
const trackedArtifactFileCountSoftMax = 1500;
const trackedArtifactFileCountHardMax = 1600;

const candidateClasses = [
  {
    id: "online-ablation",
    archiveName: "artifact-hygiene-unindexed-raw-online-ablation.tar.gz",
    pathListName: "online-ablation-paths.txt",
    role: "online ablation matrices",
    pattern: /lns-window-ranker-online-ablation\.json$/
  },
  {
    id: "labels",
    archiveName: "artifact-hygiene-unindexed-raw-labels.tar.gz",
    pathListName: "labels-paths.txt",
    role: "label bundles",
    pattern: /(?:^|\/)(?:labels|lns-window-replay-labels)\.json$/
  },
  {
    id: "budget-trace",
    archiveName: "artifact-hygiene-unindexed-raw-budget-trace.tar.gz",
    pathListName: "budget-trace-paths.txt",
    role: "budget ablation and decision trace raw files",
    pattern: /(?:budget-ablation\.json|decision-trace\.jsonl)$/
  },
  {
    id: "scorecards",
    archiveName: "artifact-hygiene-unindexed-raw-scorecards.tar.gz",
    pathListName: "scorecard-paths.txt",
    role: "raw scorecards",
    pattern: /scorecard\.json$/
  },
  {
    id: "feature-gate-discovery",
    archiveName: "artifact-hygiene-unindexed-raw-feature-gate-discovery.tar.gz",
    pathListName: "feature-gate-discovery-paths.txt",
    role: "feature-gate discovery raw matrices",
    pattern: /online-selected-feature-gate-discovery\.json$/
  }
];

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    force: args.has("--force"),
    inventory: args.has("--inventory") || (!args.has("--stage-unindexed-raw") && !args.has("--help")),
    stageUnindexedRaw: args.has("--stage-unindexed-raw"),
    help: args.has("--help")
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/prepare-artifact-hygiene-recovery.mjs --inventory
  node scripts/prepare-artifact-hygiene-recovery.mjs --stage-unindexed-raw [--force]

Inventory reports unindexed raw artifact candidates.
Staging writes ignored release-assets packages, path lists, checksums, and a local-staging manifest.
`);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function readTrackedArtifacts() {
  return run("git", ["ls-files", "--", "artifacts"])
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

function readIndexedArtifactPaths() {
  const registryPath = path.join(repoRoot, "artifacts", "experiments", "index.jsonl");
  const content = fs.readFileSync(registryPath, "utf8").trim();
  if (!content) {
    return new Set();
  }

  const indexedPaths = new Set();
  for (const line of content.split(/\r?\n/)) {
    const entry = JSON.parse(line);
    for (const artifactPath of entry.artifactPaths ?? []) {
      indexedPaths.add(artifactPath);
    }
  }
  return indexedPaths;
}

function classifyCandidate(filePath) {
  return candidateClasses.find((candidateClass) => candidateClass.pattern.test(filePath)) ?? null;
}

function bytesFor(filePath) {
  return fs.statSync(path.join(repoRoot, filePath)).size;
}

function buildInventory() {
  const trackedArtifacts = readTrackedArtifacts();
  const indexedArtifactPaths = readIndexedArtifactPaths();
  const trackedBytes = trackedArtifacts.reduce((total, filePath) => total + bytesFor(filePath), 0);

  const candidates = [];
  for (const filePath of trackedArtifacts) {
    const candidateClass = classifyCandidate(filePath);
    if (!candidateClass || indexedArtifactPaths.has(filePath)) {
      continue;
    }
    candidates.push({
      classId: candidateClass.id,
      filePath,
      bytes: bytesFor(filePath)
    });
  }

  candidates.sort((left, right) => left.filePath.localeCompare(right.filePath));

  const byClass = candidateClasses.map((candidateClass) => {
    const classCandidates = candidates.filter((candidate) => candidate.classId === candidateClass.id);
    const classBytes = classCandidates.reduce((total, candidate) => total + candidate.bytes, 0);
    return {
      id: candidateClass.id,
      role: candidateClass.role,
      count: classCandidates.length,
      bytes: classBytes,
      mib: Number((classBytes / 1024 / 1024).toFixed(2)),
      archiveName: candidateClass.archiveName,
      pathListName: candidateClass.pathListName
    };
  });

  const candidateBytes = candidates.reduce((total, candidate) => total + candidate.bytes, 0);
  const trackedArtifactCountOverSoftLimit = Math.max(0, trackedArtifacts.length - trackedArtifactFileCountSoftMax);
  const trackedArtifactHardLimitRemaining = trackedArtifactFileCountHardMax - trackedArtifacts.length;
  const softLimitExceeded = trackedArtifacts.length > trackedArtifactFileCountSoftMax;
  const hardLimitExceeded = trackedArtifacts.length > trackedArtifactFileCountHardMax;
  const warnings = [];
  if (softLimitExceeded) {
    warnings.push({
      code: "tracked-artifact-soft-cap",
      message:
        `Tracked artifact count ${trackedArtifacts.length} exceeds soft target ` +
        `${trackedArtifactFileCountSoftMax}; keep broad evidence runs paired with an externalization plan.`
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    recoveryPlanPath,
    trackedArtifactCount: trackedArtifacts.length,
    trackedArtifactFileCountSoftMax,
    trackedArtifactFileCountHardMax,
    trackedArtifactCountOverSoftLimit,
    trackedArtifactHardLimitRemaining,
    softLimitExceeded,
    hardLimitExceeded,
    artifactHygieneStatus: hardLimitExceeded ? "fail" : softLimitExceeded ? "soft-warning" : "pass",
    trackedArtifactBytes: trackedBytes,
    candidateCount: candidates.length,
    candidateBytes,
    candidateMiB: Number((candidateBytes / 1024 / 1024).toFixed(2)),
    projectedTrackedArtifactCountAfterUntracking: trackedArtifacts.length - candidates.length,
    projectedTrackedArtifactBytesAfterUntracking: trackedBytes - candidateBytes,
    warnings,
    byClass,
    candidates
  };
}

function formatSummary(inventory) {
  const lines = [
    "Artifact hygiene unindexed raw recovery inventory",
    `generatedAt=${inventory.generatedAt}`,
    `recoveryPlan=${inventory.recoveryPlanPath}`,
    `trackedArtifactCount=${inventory.trackedArtifactCount}`,
    `trackedArtifactFileCountSoftMax=${inventory.trackedArtifactFileCountSoftMax}`,
    `trackedArtifactFileCountHardMax=${inventory.trackedArtifactFileCountHardMax}`,
    `trackedArtifactCountOverSoftLimit=${inventory.trackedArtifactCountOverSoftLimit}`,
    `trackedArtifactHardLimitRemaining=${inventory.trackedArtifactHardLimitRemaining}`,
    `artifactHygieneStatus=${inventory.artifactHygieneStatus}`,
    `trackedArtifactBytes=${inventory.trackedArtifactBytes}`,
    `candidateCount=${inventory.candidateCount}`,
    `candidateBytes=${inventory.candidateBytes}`,
    `candidateMiB=${inventory.candidateMiB}`,
    `projectedTrackedArtifactCountAfterUntracking=${inventory.projectedTrackedArtifactCountAfterUntracking}`,
    `projectedTrackedArtifactBytesAfterUntracking=${inventory.projectedTrackedArtifactBytesAfterUntracking}`,
    "",
    "Classes:"
  ];

  for (const candidateClass of inventory.byClass) {
    lines.push(
      `- ${candidateClass.id}: count=${candidateClass.count}, bytes=${candidateClass.bytes}, mib=${candidateClass.mib}, archive=${candidateClass.archiveName}`
    );
  }

  lines.push("");
  lines.push("This staging output is not durable storage. Upload packages and checksums before untracking raw files.");
  return `${lines.join("\n")}\n`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function assertCanWrite(filePath, force) {
  if (!force && fs.existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite ${path.relative(repoRoot, filePath)}; pass --force to refresh staging output.`
    );
  }
}

async function stageUnindexedRaw({ force }) {
  const inventory = buildInventory();
  fs.mkdirSync(stagingRoot, { recursive: true });

  const candidatePathList = path.join(stagingRoot, "candidate-paths.txt");
  const summaryPath = path.join(stagingRoot, "candidate-summary.txt");
  const inventoryPath = path.join(stagingRoot, "candidate-summary.json");
  const manifestPath = path.join(stagingRoot, "package-manifest.local-staging.json");

  for (const outputPath of [candidatePathList, summaryPath, inventoryPath, manifestPath]) {
    assertCanWrite(outputPath, force);
  }

  fs.writeFileSync(candidatePathList, `${inventory.candidates.map((candidate) => candidate.filePath).join("\n")}\n`);
  fs.writeFileSync(summaryPath, formatSummary(inventory));
  fs.writeFileSync(inventoryPath, `${JSON.stringify({ ...inventory, candidates: undefined }, null, 2)}\n`);

  const packages = [];
  for (const candidateClass of candidateClasses) {
    const classCandidates = inventory.candidates.filter((candidate) => candidate.classId === candidateClass.id);
    if (classCandidates.length === 0) {
      continue;
    }

    const pathListPath = path.join(stagingRoot, candidateClass.pathListName);
    const archivePath = path.join(stagingRoot, candidateClass.archiveName);
    assertCanWrite(pathListPath, force);
    assertCanWrite(archivePath, force);
    fs.writeFileSync(pathListPath, `${classCandidates.map((candidate) => candidate.filePath).join("\n")}\n`);

    run("tar", ["-czf", archivePath, "-T", pathListPath], { stdio: "inherit" });
    const archiveBytes = fs.statSync(archivePath).size;
    const sha256 = await sha256File(archivePath);
    fs.writeFileSync(`${archivePath}.sha256`, `${sha256}  ${candidateClass.archiveName}\n`);

    packages.push({
      classId: candidateClass.id,
      role: candidateClass.role,
      archivePath: path.relative(repoRoot, archivePath),
      checksumPath: path.relative(repoRoot, `${archivePath}.sha256`),
      pathListPath: path.relative(repoRoot, pathListPath),
      rawFileCount: classCandidates.length,
      rawBytes: classCandidates.reduce((total, candidate) => total + candidate.bytes, 0),
      archiveBytes,
      sha256
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "local-staging-only",
    durableUploadRequired: true,
    recoveryPlanPath,
    storage: {
      kind: "local-staging",
      uri: path.relative(repoRoot, stagingRoot)
    },
    source: {
      trackedArtifactCount: inventory.trackedArtifactCount,
      trackedArtifactBytes: inventory.trackedArtifactBytes,
      candidateCount: inventory.candidateCount,
      candidateBytes: inventory.candidateBytes,
      projectedTrackedArtifactCountAfterUntracking: inventory.projectedTrackedArtifactCountAfterUntracking,
      projectedTrackedArtifactBytesAfterUntracking: inventory.projectedTrackedArtifactBytesAfterUntracking
    },
    packages,
    notes: [
      "This manifest is local staging metadata only.",
      "Upload the archives and checksum files to durable release or object storage before untracking raw files.",
      "Do not commit release-assets output."
    ]
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    stagingRoot: path.relative(repoRoot, stagingRoot),
    candidateCount: inventory.candidateCount,
    candidateMiB: inventory.candidateMiB,
    packageCount: packages.length,
    projectedTrackedArtifactCountAfterUntracking: inventory.projectedTrackedArtifactCountAfterUntracking
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.inventory) {
  const inventory = buildInventory();
  console.log(JSON.stringify({ ...inventory, candidates: undefined }, null, 2));
}

if (args.stageUnindexedRaw) {
  const result = await stageUnindexedRaw({ force: args.force });
  console.log(JSON.stringify(result, null, 2));
}
