import fs from "node:fs";
import path from "node:path";

import { createLnsWindowReplaySnapshot, formatLnsWindowReplayLabels } from "../../benchmarkApi.js";
import { defaultCliReplayCommand, normalizeRepoRelativePath, writeJsonArtifact } from "./artifactBundleHelpers.js";

import type { LnsWindowReplaySuiteResult } from "../../benchmarkApi.js";

export interface LnsWindowReplayArtifactManifest {
  artifactDir: string;
  artifactPaths: {
    replayJson: string;
    replayText: string;
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
  const manifest: LnsWindowReplayArtifactManifest = {
    artifactDir,
    artifactPaths: {
      replayJson: artifactPath("lns-window-replay-labels.json"),
      replayText: artifactPath("lns-window-replay-labels.txt"),
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
    pressureFamilies: [...result.pressureFamilies]
  };

  writeJsonArtifact(absoluteArtifactPath("lns-window-replay-labels.json"), createLnsWindowReplaySnapshot(result));
  fs.writeFileSync(absoluteArtifactPath("lns-window-replay-labels.txt"), `${formatLnsWindowReplayLabels(result)}\n`);
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
    `replay-json=${manifest.artifactPaths.replayJson}`,
    `replay-text=${manifest.artifactPaths.replayText}`,
    `manifest=${manifest.artifactPaths.manifestJson}`
  ].join("\n");
}
