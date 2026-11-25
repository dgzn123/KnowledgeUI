import { runValidate } from "../../cli/validate/index.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { protocol } from "./fixtures/runtime.mjs";

const paths = process.argv.slice(2);
process.exitCode = await runValidate(paths.length ? paths : ["examples/gallery/diagrams.md"], {
  protocol, scanner: markdownBlockScanner,
});
