import { runValidate } from "../../../cli/validate/index.ts";
import { markdownBlockScanner } from "../../../src/core/protocol/index.ts";
import { protocol } from "./runtime.mjs";

if (import.meta.main) {
  process.exitCode = await runValidate(process.argv.slice(2), { protocol, scanner: markdownBlockScanner });
}
