import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { directoryExists, readArtifacts, readRegular, selectVault } from "./files.mjs";
import { readState, recover, replaceArtifacts, rollbackTarget, withBackupStore } from "./transaction.mjs";

const configName = "knowledge-ui.local.json";

async function vaultPath(repo, override) {
  if (override !== undefined) {
    if (!override.trim() || override.startsWith("--")) throw new Error("--vault requires a Vault directory path.");
    return override;
  }

  const file = await readRegular(join(repo, configName));
  if (!file) throw new Error(`Specify --vault <path> or set vault in ${configName}.`);
  let config;
  try {
    config = JSON.parse(file.bytes);
  } catch {
    throw new Error(`Invalid JSON in ${configName}.`);
  }
  if (typeof config?.vault !== "string" || !config.vault.trim()) {
    throw new Error(`${configName} must provide a nonempty vault path.`);
  }
  return resolve(repo, config.vault);
}

function runGate(repo, script) {
  // Windows npm is a cmd shim. Only the fixed gate names are passed to cmd.
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/c", "npm", "run", script] : ["run", script];
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error(`npm run ${script} failed (${result.error?.message ?? result.signal ?? result.status}).`);
  }
}

async function buildArtifacts(repo, signal) {
  const dist = join(repo, "dist");
  const directory = join(dist, "obsidian");
  if (await directoryExists(dist) && await directoryExists(directory)) {
    await readArtifacts(directory);
  }

  runGate(repo, "build");
  signal.throwIfAborted();
  runGate(repo, "test");
  signal.throwIfAborted();

  if (!await directoryExists(dist) || !await directoryExists(directory)) {
    throw new Error(`Build did not produce ${directory}.`);
  }
  const files = await readArtifacts(directory);
  for (const [name, file] of Object.entries(files)) {
    if (!file?.bytes.length) throw new Error(`Missing or empty build artifact: ${join(directory, name)}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(files["manifest.json"].bytes);
  } catch {
    throw new Error("Invalid JSON in the built manifest.json.");
  }
  if (manifest?.id !== "knowledge-ui" || manifest.isDesktopOnly !== false) {
    throw new Error("The built manifest must identify the mobile-compatible knowledge-ui plugin.");
  }
  return { plugins: true, plugin: true, files };
}

export async function runCli(action) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Interrupted by signal."));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    const rollback = action === "rollback";
    const { values } = parseArgs({
      options: {
        vault: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
        ...(rollback && { recover: { type: "boolean" } }),
      },
    });
    if (values.help) {
      console.log(`Usage: node scripts/${action}/index.mjs [--vault <path>]${rollback ? " [--recover]" : ""}`);
      console.log(`If --vault is omitted, read the vault path from ${configName} at the checkout root.`);
      return;
    }
    if (values.vault?.length > 1) throw new Error("Specify --vault only once.");

    const repo = await realpath(fileURLToPath(new URL("../../", import.meta.url)));
    const target = await selectVault(repo, await vaultPath(repo, values.vault?.[0]));
    await withBackupStore(repo, target, async store => {
      const state = await readState(store, target);
      if (values.recover) {
        const restored = await recover(store, target, state);
        console.log(restored ? `Recovered plugin artifacts at ${target.directory}` : "No interrupted transaction.");
        return;
      }
      if (state.pending !== null) throw new Error("An interrupted transaction is pending. Run rollback --recover.");

      const desired = rollback ? await rollbackTarget(store, state) : await buildArtifacts(repo, controller.signal);
      const backup = await replaceArtifacts(store, target, state, desired, controller.signal);
      if (backup === null) {
        console.log(`Plugin artifacts already match at ${target.directory}`);
        return;
      }
      console.log(`${rollback ? "Rolled back" : "Deployed"} ${target.directory}`);
      console.log(`Backup of the prior artifacts: ${backup}`);
    });
  } catch (error) {
    console.error(`Knowledge UI ${action}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
