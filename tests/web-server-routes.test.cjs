const childProcess = require("node:child_process");
const path = require("node:path");

const routeTestFiles = [
  "static-routes.test.cjs",
  "solve-routes.test.cjs",
  "validation-routes.test.cjs",
  "layout-evaluate-routes.test.cjs",
  "status-routes.test.cjs"
];

for (const fileName of routeTestFiles) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, "web-server", fileName)], {
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("Web server route tests passed.");
}
