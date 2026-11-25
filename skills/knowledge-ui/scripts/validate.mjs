import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = new URL("../../../cli/main.ts", import.meta.url);
const examples = new URL("../examples/", import.meta.url);
const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [
  fileURLToPath(cli), ...(args.length ? args : [fileURLToPath(examples)]),
], { stdio: "inherit" });

if (result.error) console.error(result.error.message);
if (result.signal) console.error("Validation stopped by " + result.signal);
process.exitCode = result.status ?? 2;
