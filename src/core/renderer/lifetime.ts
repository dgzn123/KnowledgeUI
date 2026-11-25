import type { Lifetime } from "#contracts";

/** Keep independent resources releasable even when a component cleanup fails. */
export function runCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // A failing cleanup cannot prevent disposal of subsequent resources.
  }
}

export function createLifetime(): Lifetime {
  const controller = new AbortController();
  const cleanups = new Set<() => void>();
  const lifetime: Lifetime = {
    signal: controller.signal,
    add(cleanup) {
      if (controller.signal.aborted) runCleanup(cleanup);
      else cleanups.add(cleanup);
    },
    child() {
      const child = createLifetime();
      const disposeChild = () => child.dispose();
      lifetime.add(disposeChild);
      child.add(() => cleanups.delete(disposeChild));
      return child;
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const cleanup of Array.from(cleanups).reverse()) {
        if (cleanups.delete(cleanup)) runCleanup(cleanup);
      }
    },
  };
  return lifetime;
}
