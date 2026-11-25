import { runValidate } from "../../cli/validate/index.ts";
import { markdownBlockScanner } from "../../src/core/protocol/index.ts";
import { extensionFixture } from "./fixtures/protocol.mjs";

if (import.meta.main) {
  const args = process.argv.slice(2);
  process.exitCode = await runValidate(args.length ? args : ["examples/extensions"],
    { protocol: extensionFixture().protocol, scanner: markdownBlockScanner });
}
