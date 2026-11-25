import { lstat, mkdir, open, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const artifactNames = ["main.js", "styles.css", "manifest.json"];

async function inspect(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export async function directoryExists(path) {
  const stat = await inspect(path);
  if (stat && !stat.isDirectory()) throw new Error(`Expected a directory without links: ${path}`);
  return stat !== null;
}

export async function ensureDirectory(path, mode) {
  if (!await directoryExists(path)) {
    try {
      await mkdir(path, { mode });
    } catch (error) {
      if (error.code !== "EEXIST" || !await directoryExists(path)) throw error;
    }
  }
}

async function regularFile(path) {
  const stat = await inspect(path);
  if (stat && (!stat.isFile() || stat.nlink !== 1)) {
    throw new Error(`Expected a regular file without links: ${path}`);
  }
  return stat;
}

export async function readRegular(path) {
  const stat = await regularFile(path);
  return stat && { bytes: await readFile(path), mode: stat.mode & 0o777 };
}

export async function writeNew(path, bytes, mode) {
  const file = await open(path, "wx", mode);
  try {
    await file.writeFile(bytes);
    await file.chmod(mode);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function readArtifacts(path) {
  const entries = await Promise.all(artifactNames.map(async name => [name, await readRegular(join(path, name))]));
  return Object.fromEntries(entries);
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function selectVault(repo, vaultArgument) {
  const input = resolve(vaultArgument);
  if (!await directoryExists(input)) throw new Error(`Vault directory does not exist: ${input}`);
  const vault = await realpath(input);
  if (contains(repo, vault) || contains(vault, repo)) {
    throw new Error("The source checkout and the Vault must be in separate directory trees.");
  }

  const config = join(vault, ".obsidian");
  const plugins = join(config, "plugins");
  const identity = await lstat(vault, { bigint: true });
  const target = { vault, identity, config, plugins, directory: join(plugins, "knowledge-ui") };
  await readTarget(target);
  return target;
}

export async function readTarget(target) {
  const identity = await lstat(target.vault, { bigint: true });
  if (!identity.isDirectory() || identity.dev !== target.identity.dev || identity.ino !== target.identity.ino) {
    throw new Error("The Vault directory changed during this operation.");
  }
  if (!await directoryExists(target.config)) {
    throw new Error(`Expected an existing Obsidian configuration directory: ${target.config}`);
  }
  const plugins = await directoryExists(target.plugins);
  const plugin = plugins && await directoryExists(target.directory);
  return { plugins, plugin, files: await readArtifacts(target.directory) };
}

async function removeEmptyDirectory(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}

export function sameArtifact(before, after) {
  if (!before || !after) return before === after;
  return before.mode === after.mode && before.bytes.equals(after.bytes);
}

export async function applyTarget(target, desired, signal) {
  const current = await readTarget(target);
  if (desired.plugins) await ensureDirectory(target.plugins);
  if (desired.plugin) await ensureDirectory(target.directory);

  for (const name of artifactNames) {
    signal?.throwIfAborted();
    const path = join(target.directory, name);
    const before = current.files[name];
    const after = desired.files[name];
    if (sameArtifact(before, after)) continue;
    if (before && await regularFile(path)) await unlink(path);
    if (after) await writeNew(path, after.bytes, after.mode);
  }

  if (!desired.plugin && current.plugin) await removeEmptyDirectory(target.directory);
  if (!desired.plugins && current.plugins) await removeEmptyDirectory(target.plugins);
}
