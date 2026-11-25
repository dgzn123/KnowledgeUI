import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  applyTarget, artifactNames, directoryExists, ensureDirectory, readRegular, readTarget, sameArtifact, writeNew,
} from "./files.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function readJson(path) {
  const file = await readRegular(path);
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.bytes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`Invalid JSON record: ${path}`);
  }
}

async function saveJson(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeNew(temp, JSON.stringify(data, null, 2) + "\n", 0o600);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function isSnapshotId(value) {
  return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
}

async function saveSnapshot(store, snapshot, previous) {
  const id = randomUUID();
  const directory = join(store, id);
  await mkdir(directory, { mode: 0o700 });

  const files = {};
  for (const name of artifactNames) {
    const file = snapshot.files[name];
    files[name] = file && { mode: file.mode, sha256: digest(file.bytes) };
    if (file) await writeNew(join(directory, name), file.bytes, 0o600);
  }
  await saveJson(join(directory, "snapshot.json"), {
    previous, plugins: snapshot.plugins, plugin: snapshot.plugin, files,
  });
  return id;
}

async function readSnapshot(store, id) {
  const directory = join(store, id);
  if (!await directoryExists(directory)) throw new Error(`Missing plugin backup: ${directory}`);
  const record = await readJson(join(directory, "snapshot.json"));
  if (!record || typeof record.plugins !== "boolean" || typeof record.plugin !== "boolean"
      || (record.plugin && !record.plugins)
      || (record.previous !== null && !isSnapshotId(record.previous))
      || !record.files || typeof record.files !== "object") {
    throw new Error(`Invalid plugin backup metadata: ${directory}`);
  }

  const files = {};
  for (const name of artifactNames) {
    const entry = record.files[name];
    const file = await readRegular(join(directory, name));
    if (entry === null && file === null) {
      files[name] = null;
    } else if (record.plugin && file && entry && Number.isInteger(entry.mode)
        && entry.mode >= 0 && entry.mode <= 0o777 && entry.sha256 === digest(file.bytes)) {
      files[name] = { bytes: file.bytes, mode: entry.mode };
    } else {
      throw new Error(`Plugin backup failed verification: ${join(directory, name)}`);
    }
  }
  return { plugins: record.plugins, plugin: record.plugin, files, previous: record.previous };
}

export async function withBackupStore(repo, target, operation) {
  const root = join(repo, "backups");
  await ensureDirectory(root, 0o700);
  // Builds write to a shared dist directory, so serialize operations across this checkout.
  const lock = join(root, "knowledge-ui.lock");
  const owner = join(lock, "pid");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Deployment lock exists: ${lock}. See the interruption recovery instructions.`);
  }

  try {
    await writeNew(owner, `${process.pid}\n`, 0o600);
    const store = join(root, "knowledge-ui", digest(target.vault));
    await ensureDirectory(join(root, "knowledge-ui"), 0o700);
    await ensureDirectory(store, 0o700);
    await operation(store);
  } finally {
    await unlink(owner).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(lock);
  }
}

export async function readState(store, target) {
  const state = await readJson(join(store, "state.json")) ?? {
    vault: target.vault, latest: null, pending: null,
  };
  if (state.vault !== target.vault || [state.latest, state.pending].some(id => id !== null && !isSnapshotId(id))) {
    throw new Error(`Invalid transaction state: ${store}`);
  }
  return state;
}

export async function recover(store, target, state) {
  if (state.pending === null) return false;
  const snapshot = await readSnapshot(store, state.pending);
  await applyTarget(target, snapshot);
  await saveJson(join(store, "state.json"), { ...state, pending: null });
  return true;
}

export async function replaceArtifacts(store, target, state, desired, signal) {
  signal.throwIfAborted();
  const before = await readTarget(target);
  const deploying = desired.previous === undefined;
  if (deploying && artifactNames.every(name => sameArtifact(before.files[name], desired.files[name]))) {
    return null;
  }
  const id = await saveSnapshot(store, before, state.latest);
  const transaction = { ...state, pending: id };
  const statePath = join(store, "state.json");
  await saveJson(statePath, transaction);

  try {
    signal.throwIfAborted();
    await applyTarget(target, desired, signal);
    signal.throwIfAborted();
    // The rename commits the new history pointer and clears the recovery marker together.
    const latest = deploying ? id : desired.previous;
    await saveJson(statePath, { ...state, latest, pending: null });
  } catch (error) {
    await restoreAfterFailure(store, target, transaction, error);
  }
  return join(store, id);
}

async function restoreAfterFailure(store, target, transaction, error) {
  try {
    await recover(store, target, transaction);
  } catch (restoreError) {
    throw new Error(`Write failed (${error.message}). Recovery pending in ${store} (${restoreError.message}). Run rollback --recover.`);
  }
  throw new Error(`Write failed; previous plugin artifacts restored (${error.message}).`);
}

export async function rollbackTarget(store, state) {
  if (state.latest === null) throw new Error("No deployment backup for this Vault.");
  return readSnapshot(store, state.latest);
}
