import { createActiveProtocol } from "../src/composition/protocol.ts";
import { markdownBlockScanner } from "../src/core/protocol/index.ts";
import { runValidate } from "./validate/index.ts";

const defaultTargets = [
  "preview/sample.md", "examples/Component Gallery.md", "examples/gallery",
  "examples/extensions", "examples/notes", "skills/knowledge-ui/examples",
];
const args = process.argv.slice(2);
process.exitCode = await runValidate(
  args.length === 0 ? defaultTargets : args,
  { protocol: createActiveProtocol(), scanner: markdownBlockScanner },
);
