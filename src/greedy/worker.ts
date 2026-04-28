import { reportJsonSolverWorkerError, runJsonSolverWorker } from "../runtime/background/worker.js";
import { solveGreedy } from "./solver.js";

void runJsonSolverWorker(solveGreedy).catch((error: unknown) => {
  reportJsonSolverWorkerError("greedy", error);
});
