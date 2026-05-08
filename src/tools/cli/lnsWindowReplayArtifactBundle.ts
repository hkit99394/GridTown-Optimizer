import fs from "node:fs";
import path from "node:path";

import {
  createLnsWindowReplaySnapshot,
  formatLnsWindowReplayLabels,
  summarizeLnsWindowReplayRepeatability
} from "../../benchmarkApi.js";
import { defaultCliReplayCommand, normalizeRepoRelativePath, writeJsonArtifact } from "./artifactBundleHelpers.js";

import type { LnsWindowReplayRepeatabilitySummary, LnsWindowReplaySuiteResult } from "../../benchmarkApi.js";

export interface LnsWindowReplayArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    replayJson: string;
    replayText: string;
    repeatabilitySummaryJson: string;
    manifestJson: string;
  };
  command: string;
  generatedAt: string;
  caseCount: number;
  seedCount: number;
  stateCount: number;
  labelCount: number;
  rollForwardLabelCount: number;
  selectedCaseNames: string[];
  pressureFamilies: string[];
  repeatabilitySummary: LnsWindowReplayRepeatabilitySummary;
}

export function writeLnsWindowReplayArtifactBundle(
  result: LnsWindowReplaySuiteResult,
  artifactDirInput: string,
  argv: readonly string[]
): LnsWindowReplayArtifactManifest {
  const artifactDir = normalizeRepoRelativePath(artifactDirInput, "--window-replay-artifact-dir");
  const absoluteArtifactDir = path.resolve(process.cwd(), artifactDir);
  fs.mkdirSync(absoluteArtifactDir, { recursive: true });
  const artifactPath = (fileName: string) => path.posix.join(artifactDir, fileName);
  const absoluteArtifactPath = (fileName: string) => path.join(absoluteArtifactDir, fileName);
  const repeatabilitySummary = summarizeLnsWindowReplayRepeatability(result);
  const manifest: LnsWindowReplayArtifactManifest = {
    artifactDir,
    artifactPaths: {
      replayJson: artifactPath("lns-window-replay-labels.json"),
      replayText: artifactPath("lns-window-replay-labels.txt"),
      repeatabilitySummaryJson: artifactPath("repeatability-summary.json"),
      manifestJson: artifactPath("manifest.json")
    },
    command: defaultCliReplayCommand("dist/lnsBenchmarkCli.js", argv),
    generatedAt: result.generatedAt,
    caseCount: result.caseCount,
    seedCount: result.seedCount,
    stateCount: result.stateCount,
    labelCount: result.labelCount,
    rollForwardLabelCount: result.rollForwardLabelCount,
    selectedCaseNames: [...result.selectedCaseNames],
    pressureFamilies: [...result.pressureFamilies],
    repeatabilitySummary
  };

  writeJsonArtifact(absoluteArtifactPath("lns-window-replay-labels.json"), createLnsWindowReplaySnapshot(result));
  fs.writeFileSync(absoluteArtifactPath("lns-window-replay-labels.txt"), `${formatLnsWindowReplayLabels(result)}\n`);
  writeJsonArtifact(absoluteArtifactPath("repeatability-summary.json"), repeatabilitySummary);
  writeJsonArtifact(absoluteArtifactPath("manifest.json"), manifest);
  return manifest;
}

export function formatLnsWindowReplayArtifactManifest(manifest: LnsWindowReplayArtifactManifest): string {
  return [
    `LNS window replay label artifacts written to ${manifest.artifactDir}`,
    `cases=${manifest.caseCount}`,
    `seeds=${manifest.seedCount}`,
    `states=${manifest.stateCount}`,
    `labels=${manifest.labelCount}`,
    `roll-forward-labels=${manifest.rollForwardLabelCount}`,
    `repeatability-conflicts=${manifest.repeatabilitySummary.conflictingFinalStatusBucketCount}`,
    `repeatability-feature-identical-conflicts=${manifest.repeatabilitySummary.featureIdenticalConflictBucketCount}`,
    `replay-json=${manifest.artifactPaths.replayJson}`,
    `replay-text=${manifest.artifactPaths.replayText}`,
    `repeatability-summary=${manifest.artifactPaths.repeatabilitySummaryJson}`,
    `manifest=${manifest.artifactPaths.manifestJson}`
  ].join("\n");
}
