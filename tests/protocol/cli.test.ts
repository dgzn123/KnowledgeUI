import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./cli-fixture.ts", import.meta.url));

function validate(...args: string[]) {
  const result = spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });
  assert.ifError(result.error);
  return result;
}

test("CLI reports absolute lines and fields and continues through selected files and blocks", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "kui-validate-"));
  t.after(() => rm(temporary, { recursive: true }));
  const notes = join(temporary, "notes");
  const sub = join(notes, "sub");
  await mkdir(sub, { recursive: true });
  const first = join(notes, "sample.md");
  const second = join(sub, "later.MARKDOWN");
  const ignored = join(temporary, "outside.md");
  await writeFile(first, [
    "Intro",
    "> ```kui",
    "> version: 1",
    "> type: text",
    "> body: 9",
    "> ```",
    "",
    "~~~kui",
    "type: divider",
    "~~~",
  ].join("\n"));
  await writeFile(second, "```kui\nversion: 1\ntype: chart\n```\n");
  await writeFile(ignored, "```kui\nversion: 1\ntype: Outside\n```\n");
  await writeFile(join(notes, "ignored.txt"), "```kui\ntype: Ignored\n```\n");
  if (process.platform !== "win32") {
    await symlink(ignored, join(notes, "link.md"));
    await symlink(temporary, join(notes, "linked-directory"));
  }

  const result = validate(notes, first);
  assert.equal(result.status, 1, result.stderr);
  const diagnostics = result.stderr.trim().split("\n");
  assert.equal(diagnostics.length, 3);
  assert.ok(diagnostics.includes(`${first}:5:7 error schema.type [body] Expected string.`));
  assert.ok(diagnostics.some(line => line.startsWith(`${first}:9:1 warning schema.version-defaulted [version]`)));
  assert.ok(diagnostics.some(line => line.startsWith(`${second}:3:7 error schema.component-unavailable [type]`)));
  assert.equal(result.stderr.includes("Outside"), false);
});

test("CLI returns zero for valid notes and warnings, and two for usage or I/O errors", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "kui-validate-"));
  t.after(() => rm(temporary, { recursive: true }));
  const file = join(temporary, "valid.md");
  await writeFile(file, "```kui\ntype: divider\n```\n");

  const warning = validate("--", file);
  assert.equal(warning.status, 0, warning.stderr);
  assert.match(warning.stderr, /warning schema\.version-defaulted/);
  const help = validate("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  assert.equal(validate().status, 2);
  assert.equal(validate("--bad-option").status, 2);
  const missing = validate(join(temporary, "missing.md"), file);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /validate\.io/);
  assert.match(missing.stderr, /schema\.version-defaulted/);
});

test("CLI succeeds when all kui fences are inside HTML comments", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "kui-validate-"));
  t.after(() => rm(temporary, { recursive: true }));
  const file = join(temporary, "commented.md");
  await writeFile(file, [
    "<!--",
    "```kui",
    "type: misspelled",
    "```",
    "-->",
    "> - <!--",
    ">   ~~~kui",
    ">   invalid: [",
    ">   ~~~",
    ">   -->",
  ].join("\n"));

  const result = validate(file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});
