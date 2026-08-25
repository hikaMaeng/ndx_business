import type { EventEnvelope } from "../../../common/index.js";

export class ConnectionMailbox {
  private readonly events: EventEnvelope[] = [];
  private readonly idleCallbacks: Array<() => void> = [];
  private flushing = false;
  private disposed = false;
  private reportedDepth = 0;

  constructor(private readonly capacity: number, private readonly send: (event: EventEnvelope, done: () => void) => void, private readonly close: () => void, private readonly observeDepth: (depth: number) => void = () => undefined) {}

  enqueue(event: EventEnvelope): void {
    if (this.disposed) return;
    if (this.events.length + (this.flushing ? 1 : 0) >= this.capacity) {
      if (event.kind === "progress" || event.kind === "control") return;
      this.close();
      return;
    }
    this.events.push(event);
    this.flush();
    this.reportDepth();
  }

  onIdle(callback: () => void): void {
    if (!this.flushing && this.events.length === 0) { callback(); return; }
    this.idleCallbacks.push(callback);
  }

  isIdle(): boolean { return !this.flushing && this.events.length === 0; }

  dispose(): void {
    this.disposed = true;
    this.events.splice(0);
    this.idleCallbacks.splice(0);
    this.reportDepth();
  }

  private flush(): void {
    if (this.disposed) return;
    if (this.flushing) return;
    const event = this.events.shift();
    if (!event) return;
    this.flushing = true;
    this.send(event, () => {
      this.flushing = false;
      if (this.disposed) { this.reportDepth(); return; }
      this.flush();
      this.reportDepth();
      if (!this.flushing && this.events.length === 0) this.idleCallbacks.splice(0).forEach((callback) => callback());
    });
  }

  private depth(): number { return this.disposed ? 0 : this.events.length + (this.flushing ? 1 : 0); }

  private reportDepth(): void {
    const depth = this.depth();
    if (depth === this.reportedDepth) return;
    this.reportedDepth = depth;
    this.observeDepth(depth);
  }
}
