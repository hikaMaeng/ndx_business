import type { EventEnvelope } from "agent_domain/common";

export class ConnectionMailbox {
  private readonly events: EventEnvelope[] = [];
  private readonly idleCallbacks: Array<() => void> = [];
  private flushing = false;

  constructor(private readonly capacity: number, private readonly send: (event: EventEnvelope, done: () => void) => void, private readonly close: () => void) {}

  enqueue(event: EventEnvelope): void {
    if (this.events.length + (this.flushing ? 1 : 0) >= this.capacity) {
      if (event.kind === "progress" || event.kind === "control") return;
      this.close();
      return;
    }
    this.events.push(event);
    this.flush();
  }

  onIdle(callback: () => void): void {
    if (!this.flushing && this.events.length === 0) { callback(); return; }
    this.idleCallbacks.push(callback);
  }

  isIdle(): boolean { return !this.flushing && this.events.length === 0; }

  private flush(): void {
    if (this.flushing) return;
    const event = this.events.shift();
    if (!event) return;
    this.flushing = true;
    this.send(event, () => {
      this.flushing = false;
      this.flush();
      if (!this.flushing && this.events.length === 0) this.idleCallbacks.splice(0).forEach((callback) => callback());
    });
  }
}
