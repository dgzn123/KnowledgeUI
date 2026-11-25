import { runValidate } from "../../cli/validate/index.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { phase1Fixture } from "./fixtures.ts";

process.exitCode = await runValidate(process.argv.slice(2), { protocol: phase1Fixture(), scanner: markdownBlockScanner });
