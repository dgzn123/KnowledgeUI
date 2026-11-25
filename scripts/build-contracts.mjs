import { mkdir, writeFile } from "node:fs/promises";
import { createProtocolSchema, v1Components } from "#protocol-schema";

const output = new URL("../dist/contracts/", import.meta.url);
await mkdir(output, { recursive: true });
const schema = createProtocolSchema(v1Components);
await writeFile(new URL("protocol-v1.schema.json", output), JSON.stringify(schema, null, 2) + "\n");
console.log("Built contract declarations and Protocol v1 draft schema in dist/contracts/");
