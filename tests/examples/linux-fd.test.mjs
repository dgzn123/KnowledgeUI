import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const compiler = process.env.CC || "cc";
const skip = process.platform !== "linux" ? "Linux-only system call example"
  : spawnSync(compiler, ["--version"]).status !== 0 && "C compiler unavailable";

test("Linux fork shares the offset and successful exec closes only the flagged child FD", { skip }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "kui-example-fd-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const program = join(dir, "fd-demo");
  const data = join(dir, "input");
  const fixture = fileURLToPath(new URL("./linux-fd.c", import.meta.url));
  await writeFile(data, "abcdefgh", "utf8");
  await exec(compiler, ["-std=c11", "-Wall", "-Wextra", "-Werror", fixture, "-o", program], { timeout: 10_000 });
  const { stdout } = await exec(program, [data], { timeout: 5_000 });
  const note = await readFile(new URL("../../examples/notes/linux-fork-exec-fd.md", import.meta.url), "utf8");
  const record = note.split("\n```text\n")[1]?.split("\n```")[0];
  assert.equal(stdout.trim(), record);
});
