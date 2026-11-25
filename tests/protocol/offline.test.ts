import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("the bundled browser parser works offline with string code generation disabled", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      sourcefile: "protocol-offline-test.ts",
      resolveDir: root,
      contents: `
        import { createProtocolCatalog, createProtocolReader, yamlReader } from "./src/core/protocol/index.ts";
        import { phase1ComponentTypes, v1ComponentSchema } from "#protocol-schema";
        const catalog = createProtocolCatalog(phase1ComponentTypes.map(v1ComponentSchema));
        if (!catalog.ok) throw new Error("Invalid catalog");
        const protocol = createProtocolReader({ catalog: catalog.value, yaml: yamlReader });
        const good = protocol.read({ yaml: "version: 1\\ntype: text\\nbody: Offline" });
        const bad = protocol.read({ yaml: "type: text\\nbody: [1]" });
        globalThis.result = good.ok && good.value.root.props.body === "Offline" && !bad.ok;
      `,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(bundle.metafile.inputs);
  assert.ok(inputs.some(path => path.startsWith("node_modules/yaml/browser/")));
  assert.ok(inputs.every(path => !path.includes("obsidian") && !path.includes("ajv") && !path.startsWith("cli/")));
  for (const output of Object.values(bundle.metafile.outputs)) assert.deepEqual(output.imports, []);
  const environment = { TextEncoder, result: undefined };
  runInNewContext(bundle.outputFiles[0]!.text, environment, {
    timeout: 1000, contextCodeGeneration: { strings: false, wasm: false },
  });
  assert.equal(environment.result, true);
});
