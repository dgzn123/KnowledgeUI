import type { StateStore } from "#contracts";

// The public store interface has no status flag. Bindings use this to drop queued work.
export const disposedStores = new WeakSet<StateStore>();
