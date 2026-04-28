import { reportJsonSolverWorkerError, runJsonSolverWorker } from "../runtime/background/worker.js";
import { solveLns } from "./solver.js";

void runJsonSolverWorker(solveLns).catch((error: unknown) => {
  reportJsonSolverWorkerError("LNS", error);
});
