import type { EventEnvelope } from "agent_domain/common";

export type ReplayBufferOutcome = "queued" | "dropped" | "overflow";

/** Bounded handoff between the high-water replay query and live channel routing. */
export class ReplayBuffer {
  private readonly events: EventEnvelope[] = [];
  private overflowed = false;

  constructor(private readonly capacity: number) {}

  push(event: EventEnvelope): ReplayBufferOutcome {
    if (this.overflowed) return "overflow";
    if (this.events.length >= this.capacity) {
      if (event.kind === "progress" || event.kind === "control") return "dropped";
      this.overflowed = true;
      return "overflow";
    }
    this.events.push(event);
    return "queued";
  }

  drain(): EventEnvelope[] {
    return this.events.splice(0);
  }
}
