import { runJsonSolverWorkerCli } from "../../runtime/background/worker.js";
import { solveLns } from "./solver.js";

runJsonSolverWorkerCli("LNS", solveLns);
