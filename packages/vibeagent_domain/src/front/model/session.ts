import type { EventEnvelope } from "agent/common";
import { parseVibeProgressEvent, type VibeTurnOutcome } from "../../common/index.js";
import { REDUCERS, patchTurn } from "./reducers/index.js";
import { EMPTY_SNAPSHOT, emptyTurn, type VibeSnapshot } from "./state.js";

type Listener = () => void;

/**
 * The impure half of the client.
 *
 * It owns the things a reducer must never touch — the current snapshot, the
 * listeners to notify, and the set of events already seen — and does one thing
 * with an arriving envelope: look up its reducer and apply it.
 *
 * Interpretation lives in `reducers/`, one pure function per event. This class
 * is the context they run in.
 */
export class VibeSessionModel {
  private snapshot: VibeSnapshot = EMPTY_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly seenEventIds = new Set<string>();
  /**
   * Stands in for `seq` on events recorded before emitters numbered them.
   * Arrival order is the best guess available for those, and only for those.
   */
  private legacySeq = 0;

  getSnapshot(): VibeSnapshot { return this.snapshot; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private commit(next: VibeSnapshot): void {
    if (next === this.snapshot) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  setIdentity(sessionId: string, userEmail: string): void { this.commit({ ...this.snapshot, sessionId, userEmail }); }
  setWorkspace(workspace: string): void { this.commit({ ...this.snapshot, workspace, sessionError: "" }); }

  reset(): void {
    this.seenEventIds.clear();
    this.legacySeq = 0;
    this.commit(EMPTY_SNAPSHOT);
  }

  /** Shows a submitted turn immediately, before its first event comes back. */
  startTurn(turnKey: string, prompt: string): void {
    this.commit({ ...this.snapshot, turns: [...this.snapshot.turns, emptyTurn(turnKey, prompt)] });
  }

  /**
   * Applies one envelope.
   *
   * Delivery is at-least-once, so the same event can arrive twice; `eventId`
   * dedupe is the client's half of that contract. Without it a retried delivery
   * would double every stdout chunk on screen.
   */
  apply(envelope: EventEnvelope): void {
    if (this.seenEventIds.has(envelope.eventId)) return;
    this.seenEventIds.add(envelope.eventId);

    if (envelope.kind === "result" || envelope.kind === "failure") { this.applyTerminal(envelope); return; }
    const event = parseVibeProgressEvent(envelope.action, envelope.payload);
    if (!event) return;
    const positioned = typeof (event as { seq?: unknown }).seq === "number" ? event : { ...event, seq: this.legacySeq };
    this.legacySeq += 1;
    const reduce = REDUCERS[event.action] as (snapshot: VibeSnapshot, payload: unknown) => VibeSnapshot;
    this.commit(reduce(this.snapshot, positioned));
  }

  /**
   * A step's terminal result.
   *
   * Only the broker's terminal closes a turn; a final-answer fact does not.
   * A failed `vibe.session.open` also lands here, which is how a client learns
   * its folder was refused.
   */
  private applyTerminal(envelope: EventEnvelope): void {
    const payload = envelope.payload as { ok?: unknown; value?: unknown; error?: { message?: unknown } };
    const ok = payload.ok === true;
    const outcome = ok ? payload.value as Partial<VibeTurnOutcome> | undefined : undefined;
    const error = typeof payload.error?.message === "string" ? payload.error.message : "";
    if (outcome?.workspace) this.setWorkspace(outcome.workspace);

    // Which turn does this close? The envelope says so when it can, the outcome
    // names one when it has one, and otherwise a turn already on screen under
    // this transaction is the answer — that is the live case, where the client
    // created the turn when it submitted it.
    const belongsToTurn = Boolean(envelope.turnId)
      || Boolean(outcome?.turnKey)
      || this.snapshot.turns.some((turn) => turn.turnKey === envelope.transactionKey);

    // A session-open result belongs to no turn. Success is already carried by
    // the `session.opened` fact, so only a refusal needs surfacing here — and
    // it has to be surfaced, or a rejected folder would look like nothing
    // happening at all.
    if (!belongsToTurn) {
      if (!ok) this.commit({ ...this.snapshot, sessionError: error || "세션을 열지 못했습니다." });
      return;
    }
    this.commit(patchTurn(this.snapshot, envelope.transactionKey, (turn) => ({
      ...turn,
      phase: ok ? "done" : "failed",
      error: ok ? "" : error,
      answer: turn.answer || outcome?.answer || "",
    })));
  }
}

