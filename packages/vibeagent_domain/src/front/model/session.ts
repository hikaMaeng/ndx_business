import type { EventEnvelope } from "agent/common";
import { parseVibeProgressEvent, type VibeTurnOutcome } from "../../common/index.js";
import { REDUCERS, patchTurn } from "./reducers/index.js";
import { EMPTY_SNAPSHOT, emptyTurn, type TurnBlock, type TurnPhase, type TurnView, type VibeSnapshot } from "./state.js";

/** A turn as the read model describes it: everything except what it said. */
export interface TurnDigest {
  turnKey: string;
  prompt: string;
  phase: string;
  answer: string;
  error: string;
  iterations: number;
  toolCalls: number;
}

const PHASES: ReadonlySet<string> = new Set(["idle", "running", "done", "failed"]);
const asPhase = (value: string): TurnPhase => (PHASES.has(value) ? value as TurnPhase : "done");

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
   * Seeds the transcript from the read model.
   *
   * This is not a second kind of truth. The projection folded the same facts
   * this class folds; the only difference is that it did the work once, on the
   * way in, instead of on every reader's screen. What arrives here is a list of
   * turns with no bodies — those are fetched one at a time, if anyone opens them.
   *
   * A turn already on screen is left alone. Reopening a session while its last
   * turn is still streaming must not replace the live one with a stale digest.
   */
  hydrate(digests: readonly TurnDigest[]): void {
    const live = new Map(this.snapshot.turns.map((turn) => [turn.turnKey, turn]));
    const turns: TurnView[] = digests.map((digest) => live.get(digest.turnKey) ?? {
      turnKey: digest.turnKey,
      prompt: digest.prompt,
      phase: asPhase(digest.phase),
      blocks: [],
      answer: digest.answer,
      error: digest.error,
      iterations: digest.iterations,
      toolCalls: digest.toolCalls,
      bodiesLoaded: false,
    });
    // A turn submitted in this session but not yet projected still belongs on
    // screen; the projection is behind, not authoritative about what exists.
    for (const turn of this.snapshot.turns) if (!digests.some((digest) => digest.turnKey === turn.turnKey)) turns.push(turn);
    this.commit({ ...this.snapshot, turns });
  }

  /** Fills in one turn's bodies, fetched because somebody opened it. */
  loadBlocks(turnKey: string, blocks: readonly TurnBlock[]): void {
    this.commit(patchTurn(this.snapshot, turnKey, (turn) => ({ ...turn, blocks: [...blocks], bodiesLoaded: true })));
  }

  /**
   * Throws one turn's bodies away.
   *
   * This is the point of the whole arrangement: a long session's cost is the
   * transcript it is holding, and a turn nobody is looking at should not be
   * one. The facts are still in the log and the fold is still in the read
   * model, so reopening it costs one request.
   *
   * A running turn is never dropped — its bodies are arriving, and there is
   * nothing to fetch them back from yet.
   */
  dropBlocks(turnKey: string): void {
    const turn = this.snapshot.turns.find((candidate) => candidate.turnKey === turnKey);
    if (!turn || turn.phase === "running" || !turn.bodiesLoaded) return;
    this.commit(patchTurn(this.snapshot, turnKey, (existing) => ({ ...existing, blocks: [], bodiesLoaded: false })));
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
   * One reaction's terminal result.
   *
   * A turn is a chain of reactions now, so a terminal here means one reaction
   * finished — not the turn. Success is therefore ignored: `turn.final` is what
   * closes a turn. Failure still has to surface, because a reaction that threw
   * leaves the chain with nothing to continue it, and a turn that simply stops
   * would otherwise sit at "running" for ever with no explanation.
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
    if (ok) return;

    const belongsToTurn = Boolean(envelope.turnId)
      || Boolean(outcome?.turnKey)
      || this.snapshot.turns.some((turn) => turn.turnKey === envelope.transactionKey);

    // A session-open result belongs to no turn. Success is already carried by
    // the `session.opened` fact, so only a refusal needs surfacing here — and
    // it has to be surfaced, or a rejected folder would look like nothing
    // happening at all.
    if (!belongsToTurn) {
      this.commit({ ...this.snapshot, sessionError: error || "세션을 열지 못했습니다." });
      return;
    }
    const turnKey = envelope.turnId ?? outcome?.turnKey ?? envelope.transactionKey;
    this.commit(patchTurn(this.snapshot, turnKey, (turn) => ({ ...turn, phase: "failed", error })));
  }
}

