import { runValidate } from "../../../cli/validate/index.ts";
import { markdownBlockScanner, protocol } from "./runtime.mjs";

process.exitCode = await runValidate(process.argv.slice(2), { protocol, scanner: markdownBlockScanner });
