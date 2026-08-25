/** A coalesced local wakeup: the durable log remains the source of truth. */
export class CoalescedWakeup {
  private pending = false;
  private waiter: (() => void) | undefined;

  notify(): void {
    if (this.waiter) { const resolve = this.waiter; this.waiter = undefined; resolve(); return; }
    this.pending = true;
  }

  async wait(milliseconds: number): Promise<void> {
    if (this.pending) { this.pending = false; return; }
    await new Promise<void>((resolve) => {
      const wake = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { if (this.waiter === wake) this.waiter = undefined; resolve(); }, milliseconds);
      this.waiter = wake;
    });
  }
}
