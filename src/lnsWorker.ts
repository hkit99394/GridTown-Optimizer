/**
 * Background worker for LNS solves used by the local web planner.
 */

import { solveLns } from "./lnsSolver.js";
import type { Grid, Solution, SolverParams } from "./types.js";

interface SolveRequest {
  grid: Grid;
  params: SolverParams;
}

type SerializedSolution = Omit<Solution, "roads"> & { roads: string[] };

function serializeSolution(solution: Solution): SerializedSolution {
  return {
    ...solution,
    roads: Array.from(solution.roads),
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const body = await readStdin();
  const payload = JSON.parse(body) as SolveRequest;
  const solution = solveLns(payload.grid, payload.params);
  process.stdout.write(JSON.stringify(serializeSolution(solution)));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown LNS worker error.");
  process.exitCode = 1;
});
