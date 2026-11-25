import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod, copyFile, cp, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const names = ["main.js", "manifest.json", "styles.css"];

async function setup(t) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), "knowledge-ui-deployment-"));
  t.after(() => rm(temp, { recursive: true, force: true }));

  const repo = join(temp, "source checkout");
  const vault = join(temp, "sample Vault");
  const obsidian = join(vault, ".obsidian");
  const plugins = join(obsidian, "plugins");
  const target = join(plugins, "knowledge-ui");
  const backups = join(repo, "backups");

  await mkdir(join(repo, "scripts"), { recursive: true });
  await mkdir(obsidian, { recursive: true });
  for (const name of ["deploy", "rollback"]) {
    await cp(join(source, "scripts", name), join(repo, "scripts", name), { recursive: true });
  }
  await copyFile(join(fixtures, "build.mjs"), join(repo, "fixture.mjs"));
  await writeFile(join(repo, "package.json"), JSON.stringify({
    name: "kui-deployment-fixture",
    scripts: { build: "node fixture.mjs build", test: "node fixture.mjs test" },
  }));
  await writeFile(join(vault, "Note.md"), "note fixture");
  await writeFile(join(obsidian, "community-plugins.json"), "[]");

  function run(action, args = ["--vault", vault], vars = {}) {
    const extra = vars.KUI_TEST_INTERRUPTION ? ["--import", join(fixtures, "partial-write.mjs")] : [];
    const result = spawnSync(process.execPath, [...extra, join(repo, "scripts", action, "index.mjs"), ...args], {
      cwd: temp,
      encoding: "utf8",
      env: { ...process.env, ...vars, KUI_TEST_PLUGIN_DIR: target },
      timeout: 30_000,
    });
    assert.ifError(result.error);
    return result;
  }

  return { temp, repo, vault, obsidian, plugins, target, backups, run };
}

function succeeded(result, message) {
  assert.equal(result.status, 0, result.stderr);
  if (message) assert.match(result.stdout, message);
}

function failed(result, message) {
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
}

async function artifacts(directory) {
  return Promise.all(names.map(name => readFile(join(directory, name), "utf8")));
}

async function storePath(fixture) {
  const root = join(fixture.backups, "knowledge-ui");
  const [vaultHash] = await readdir(root);
  return join(root, vaultHash);
}

async function history(fixture) {
  return JSON.parse(await readFile(join(await storePath(fixture), "state.json"), "utf8"));
}

test("first install, explicit override, update, no-op retry and successive rollback", async t => {
  const f = await setup(t);
  await writeFile(join(f.repo, "knowledge-ui.local.json"), "{ malformed and bypassed");
  succeeded(f.run("deploy", ["--vault", "sample Vault"]), /Deployed/);
  assert.deepEqual((await readdir(f.target)).sort(), names);
  const first = await artifacts(f.target);
  const initial = await history(f);

  await mkdir(join(f.plugins, "another-plugin"));
  await writeFile(join(f.plugins, "another-plugin", "data.json"), "other plugin fixture");
  await writeFile(join(f.target, "data.json"), "local plugin fixture");
  const style = join(f.target, "styles.css");
  if (process.platform !== "win32") await chmod(style, 0o640);
  const originalMode = (await stat(style)).mode & 0o777;

  await writeFile(join(f.repo, "knowledge-ui.local.json"), JSON.stringify({ vault: "../sample Vault" }));
  succeeded(f.run("deploy", [], { KUI_TEST_VERSION: "2.0.0" }));
  assert.notDeepEqual(await artifacts(f.target), first);
  const updated = await history(f);
  assert.notEqual(updated.latest, initial.latest);
  assert.deepEqual(await artifacts(join(await storePath(f), updated.latest)), first);
  succeeded(f.run("deploy", [], { KUI_TEST_VERSION: "2.0.0" }), /already match/);
  assert.deepEqual(await history(f), updated);

  succeeded(f.run("rollback", []), /Rolled back/);
  assert.deepEqual(await artifacts(f.target), first);
  assert.equal((await stat(style)).mode & 0o777, originalMode);
  succeeded(f.run("rollback", []), /Rolled back/);
  assert.deepEqual(await readdir(f.target), ["data.json"]);
  assert.equal(await readFile(join(f.target, "data.json"), "utf8"), "local plugin fixture");
  assert.equal(await readFile(join(f.plugins, "another-plugin", "data.json"), "utf8"), "other plugin fixture");
  assert.equal(await readFile(join(f.obsidian, "community-plugins.json"), "utf8"), "[]");
  assert.equal(await readFile(join(f.vault, "Note.md"), "utf8"), "note fixture");
  failed(f.run("rollback", []), /No deployment backup/);
});

test("first-install rollback removes empty directories it created", async t => {
  const f = await setup(t);
  succeeded(f.run("deploy"));
  succeeded(f.run("rollback"));
  await assert.rejects(stat(f.plugins), { code: "ENOENT" });
});

test("rollback preserves a preexisting incomplete installation", async t => {
  const f = await setup(t);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, "main.js"), "old main without other artifacts");
  succeeded(f.run("deploy"));
  assert.deepEqual((await readdir(f.target)).sort(), names);
  succeeded(f.run("rollback"));
  assert.deepEqual(await readdir(f.target), ["main.js"]);
  assert.equal(await readFile(join(f.target, "main.js"), "utf8"), "old main without other artifacts");
});

test("build and test failures preserve all installed artifacts and the rollback pointer", async t => {
  const f = await setup(t);
  succeeded(f.run("deploy"));
  const before = await artifacts(f.target);
  const state = await history(f);

  for (const gate of ["build", "test"]) {
    await writeFile(join(f.repo, "gates.txt"), "");
    failed(f.run("deploy", undefined, { KUI_TEST_GATE_FAILURE: gate, KUI_TEST_VERSION: "2.0.0" }),
      new RegExp(`npm run ${gate} failed \\(23\\)`));
    assert.equal(await readFile(join(f.repo, "gates.txt"), "utf8"), gate === "build" ? "build\n" : "build\ntest\n");
    assert.deepEqual(await artifacts(f.target), before);
    assert.deepEqual(await history(f), state);
  }
  failed(f.run("deploy", undefined, { KUI_TEST_PLUGIN_ID: "another-plugin" }), /built manifest/);
  assert.deepEqual(await artifacts(f.target), before);
  assert.deepEqual(await history(f), state);
});

test("a partial update or rollback write restores the complete prior set", async t => {
  const f = await setup(t);
  succeeded(f.run("deploy"));
  const first = await artifacts(f.target);
  const initial = await history(f);
  const update = { KUI_TEST_VERSION: "2.0.0" };

  failed(f.run("deploy", undefined, { ...update, KUI_TEST_INTERRUPTION: "error" }), /previous plugin artifacts restored/);
  assert.deepEqual(await artifacts(f.target), first);
  assert.deepEqual(await history(f), initial);

  succeeded(f.run("deploy", undefined, update));
  const second = await artifacts(f.target);
  const updated = await history(f);
  failed(f.run("rollback", undefined, { KUI_TEST_INTERRUPTION: "error" }), /previous plugin artifacts restored/);
  assert.deepEqual(await artifacts(f.target), second);
  assert.deepEqual(await history(f), updated);
});

test("recovery can be retried after persistent write failure", async t => {
  const f = await setup(t);
  succeeded(f.run("deploy"));
  const before = await artifacts(f.target);
  const state = await history(f);

  failed(f.run("deploy", undefined, {
    KUI_TEST_VERSION: "2.0.0", KUI_TEST_INTERRUPTION: "persistent",
  }), /Recovery pending/);
  assert.equal(await readFile(join(f.target, "styles.css"), "utf8"), "partial");
  assert.ok((await history(f)).pending);
  failed(f.run("deploy"), /interrupted transaction is pending/);
  succeeded(f.run("rollback", ["--vault", f.vault, "--recover"]), /Recovered/);
  succeeded(f.run("rollback", ["--vault", f.vault, "--recover"]), /No interrupted transaction/);
  assert.deepEqual(await artifacts(f.target), before);
  assert.deepEqual(await history(f), state);
});

test("abrupt process termination leaves a recoverable journal and blocks other writers", async t => {
  const f = await setup(t);
  const stopped = f.run("deploy", undefined, { KUI_TEST_INTERRUPTION: "kill" });
  assert.equal(stopped.signal, "SIGKILL");
  assert.equal(await readFile(join(f.target, "styles.css"), "utf8"), "partial");
  assert.ok((await history(f)).pending);
  failed(f.run("rollback", ["--vault", f.vault, "--recover"]), /Deployment lock exists/);

  // spawnSync has already waited for the killed command to exit.
  await rm(join(f.backups, "knowledge-ui.lock"), { recursive: true });
  succeeded(f.run("rollback", ["--vault", f.vault, "--recover"]), /Recovered/);
  await assert.rejects(stat(f.plugins), { code: "ENOENT" });
  assert.equal((await history(f)).latest, null);
  assert.equal((await history(f)).pending, null);
});

test("requires an explicit Vault and rejects invalid paths and link aliases", async t => {
  const f = await setup(t);
  failed(f.run("deploy", []), /Specify --vault/);
  failed(f.run("rollback", ["--vault"]), /--vault/);
  failed(f.run("deploy", ["--vault", f.vault, "--vault", f.vault]), /only once/);
  failed(f.run("deploy", ["--vault", resolve(f.temp, "missing")]), /does not exist/);
  failed(f.run("deploy", ["--vault", f.repo]), /separate directory trees/);
  failed(f.run("deploy", ["--vault", f.temp]), /separate directory trees/);
  failed(f.run("deploy", ["--vault", f.obsidian]), /existing Obsidian/);

  const elsewhere = join(f.temp, "outside plugin");
  await mkdir(elsewhere);
  await mkdir(f.plugins);
  await symlink(elsewhere, f.target, "junction");
  failed(f.run("deploy"), /directory without links/);
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(f.target);
  await mkdir(f.target);
  await link(join(f.vault, "Note.md"), join(f.target, "main.js"));
  failed(f.run("deploy"), /regular file without links/);
  assert.equal(await readFile(join(f.vault, "Note.md"), "utf8"), "note fixture");

  await rm(join(f.target, "main.js"));
  await symlink(elsewhere, f.backups, "junction");
  failed(f.run("deploy"), /directory without links/);
  assert.deepEqual(await readdir(elsewhere), []);
  await assert.rejects(stat(join(f.repo, "gates.txt")), { code: "ENOENT" });
});

test("a different Vault cannot use this backup and corrupt backups are rejected before writes", async t => {
  const f = await setup(t);
  succeeded(f.run("deploy"));
  succeeded(f.run("deploy", undefined, { KUI_TEST_VERSION: "2.0.0" }));
  const before = await artifacts(f.target);
  const state = await history(f);
  const store = await storePath(f);

  const another = join(f.temp, "separate Vault");
  await mkdir(join(another, ".obsidian"), { recursive: true });
  failed(f.run("rollback", ["--vault", another]), /No deployment backup/);
  await assert.rejects(stat(join(another, ".obsidian", "plugins")), { code: "ENOENT" });
  await writeFile(join(store, state.latest, "main.js"), "corrupt snapshot");
  failed(f.run("rollback"), /backup failed verification/);
  assert.deepEqual(await artifacts(f.target), before);
  assert.deepEqual(JSON.parse(await readFile(join(store, "state.json"), "utf8")), state);
});
