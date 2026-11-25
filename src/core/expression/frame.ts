import type { Disposable } from "#contracts";

interface FrameTask extends Disposable {
  schedule(): void;
}

const queued = new Set<() => void>();
let frame: number | undefined;

function flush(): void {
  frame = undefined;
  // Work queued during a flush belongs to the next frame.
  const pending = [...queued];
  queued.clear();
  for (const apply of pending) {
    try {
      apply();
    } catch (error) {
      globalThis.reportError?.(error);
    }
  }
}

/** Initial writes remain synchronous. Subsequent writes use the latest values per frame. */
export function frameTask(apply: () => void): FrameTask {
  let active = true;
  const run = () => { if (active) apply(); };
  return {
    schedule() {
      if (!active) return;
      if (typeof globalThis.requestAnimationFrame !== "function") {
        run();
        return;
      }
      queued.add(run);
      frame ??= globalThis.requestAnimationFrame(flush);
    },
    dispose() {
      active = false;
      if (queued.delete(run) && queued.size === 0 && frame !== undefined) {
        globalThis.cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
  };
}
