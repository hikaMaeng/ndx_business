export interface SchedulerNotifier {
  notify(): void;
  wait(timeoutMs: number): Promise<void>;
}

/** In-process wakeup only: durable jobs remain the scheduler source of truth. */
export function createSchedulerNotifier(): SchedulerNotifier {
  let permits = 0; const waiters: Array<() => void> = [];
  return {
    notify(): void { const waiter = waiters.shift(); if (waiter) waiter(); else permits = 1; },
    wait(timeoutMs: number): Promise<void> {
      if (permits > 0) { permits -= 1; return Promise.resolve(); }
      return new Promise((resolve) => {
        const timer = setTimeout(() => { const index = waiters.indexOf(wake); if (index >= 0) waiters.splice(index, 1); resolve(); }, timeoutMs);
        const wake = (): void => { clearTimeout(timer); resolve(); };
        waiters.push(wake);
      });
    },
  };
}
