import { solveLns } from "../../solvers/lns/solver.js";
import { runJsonSolverWorkerCli } from "./worker.js";

runJsonSolverWorkerCli("LNS", solveLns);
