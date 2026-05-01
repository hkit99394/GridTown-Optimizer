import { runJsonSolverWorkerCli } from "../../runtime/background/worker.js";
import { solveGreedy } from "./solver.js";

runJsonSolverWorkerCli("greedy", solveGreedy);
