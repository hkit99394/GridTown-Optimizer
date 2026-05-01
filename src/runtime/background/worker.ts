/**
 * Shared JSON stdin/stdout worker harness for synchronous solver entry points.
 */

import { serializeSolution } from "../../packages/core/index.js";

import type { Grid, Solution, SolverParams } from "../../packages/core/index.js";

interface SolveRequest {
  grid: Grid;
  params: SolverParams;
}

type SyncSolver = (grid: Grid, params: SolverParams) => Solution;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runJsonSolverWorker(solve: SyncSolver): Promise<void> {
  const body = await readStdin();
  const payload = JSON.parse(body) as SolveRequest;
  const solution = solve(payload.grid, payload.params);
  process.stdout.write(JSON.stringify(serializeSolution(solution)));
}

export function reportJsonSolverWorkerError(solverLabel: string, error: unknown): void {
  console.error(error instanceof Error ? error.message : `Unknown ${solverLabel} worker error.`);
  process.exitCode = 1;
}

export function runJsonSolverWorkerCli(solverLabel: string, solve: SyncSolver): void {
  void runJsonSolverWorker(solve).catch((error: unknown) => {
    reportJsonSolverWorkerError(solverLabel, error);
  });
}
