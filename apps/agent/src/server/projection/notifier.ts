import { projectionNames, type ProjectionName } from "./store.js";

/** In-process acceleration only; each projection retains its own durable checkpoint fallback. */
export class ProjectionNotifier {
  private readonly permits = new Set<ProjectionName>();
  private readonly waiters = new Map<ProjectionName, Array<() => void>>();

  notify(): void {
    for (const projection of projectionNames) {
      const waiter = this.waiters.get(projection)?.shift();
      if (waiter) waiter(); else this.permits.add(projection);
    }
  }

  wait(projection: ProjectionName, timeoutMs: number): Promise<void> {
    if (this.permits.delete(projection)) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = (): void => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { const waiters = this.waiters.get(projection); const index = waiters?.indexOf(wake) ?? -1; if (index >= 0) waiters?.splice(index, 1); resolve(); }, timeoutMs);
      const waiters = this.waiters.get(projection) ?? []; waiters.push(wake); this.waiters.set(projection, waiters);
    });
  }
}
