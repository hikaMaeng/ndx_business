import type { EventEnvelope } from "agent/common";
import { parseVibeProgressEvent, type VibeTurnOutcome } from "../../common/index.js";
import { Emitter } from "./Emitter.js";
import { SliceModel } from "./SliceModel.js";
import { TurnModel } from "./TurnModel.js";
import { REDUCERS } from "./reducers/index.js";
import type { TurnBlock } from "./state.js";

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

/**
 * One session, decomposed into the slices a screen actually reads separately.
 *
 * The whole point of the split is that a streamed token must not be able to
 * re-render the project list. Each field below is its own Emitter, and a
 * component subscribes to the ones it reads and no others:
 *
 * | slice | changes when |
 * | --- | --- |
 * | `identity` | a session is opened or switched |
 * | `workspace` | the folder is confirmed |
 * | `sessionError` | an open is refused |
 * | `turns` | a turn is added, or a session is hydrated |
 * | each `TurnModel` | that turn streams — thousands of times |
 *
 * The last row is the one that matters. `turns` holds the list; the contents of
 * a turn live behind that turn's own trigger, so the list does not change while
 * a turn is streaming and nothing subscribed to the list re-renders.
 */
export class VibeSessionModel extends Emitter {
  readonly identity = new SliceModel<{ sessionId: string; userEmail: string }>({ sessionId: "", userEmail: "" });
  readonly workspace = new SliceModel<string>("");
  /**
   * A failure that belongs to the session rather than to any turn — most often
   * a refused folder. Without somewhere to put it, a rejected open would be
   * swallowed and the session would just never become usable.
   */
  readonly sessionError = new SliceModel<string>("");
  readonly turns = new SliceModel<TurnModel[]>([]);

  /**
   * Delivery is at-least-once, so the same event can arrive twice; `eventId`
   * dedupe is the client's half of that contract. Without it a retried delivery
   * would double every stdout chunk on screen.
   */
  private readonly seenEventIds = new Set<string>();

  /**
   * Stands in for `seq` on events recorded before emitters numbered them.
   * Arrival order is the best guess available for those, and only for those.
   */
  private legacySeq = 0;

  turn(turnKey: string): TurnModel | undefined {
    return this.turns.value.find((turn) => turn.turnKey === turnKey);
  }

  /**
   * Upserts, because a turn can appear two ways.
   *
   * Submitting one creates it locally first. Replaying a past session does not:
   * events arrive for turns this model has never seen, and nothing promises
   * `turn.started` comes first. Dropping events whose turn is absent would make
   * history invisible, which is exactly what reopening a session is for.
   */
  ensureTurn(turnKey: string, prompt = ""): TurnModel {
    const existing = this.turn(turnKey);
    if (existing) return existing;
    const created = new TurnModel(turnKey, prompt);
    this.turns.mutate((list) => { list.push(created); });
    return created;
  }

  setIdentity(sessionId: string, userEmail: string): void {
    this.identity.set({ sessionId, userEmail });
  }

  setWorkspace(workspace: string): void {
    this.workspace.set(workspace);
    this.sessionError.set("");
  }

  reset(): void {
    this.seenEventIds.clear();
    this.legacySeq = 0;
    this.turns.set([]);
    this.workspace.set("");
    this.sessionError.set("");
  }

  /**
   * Shows a submitted turn immediately, before its first event comes back.
   *
   * The prompt is optional because a turn also appears from the other
   * direction: replayed events arrive for turns this model never saw, and the
   * prompt reaches it later on `turn.started`.
   */
  startTurn(turnKey: string, prompt = ""): void {
    this.ensureTurn(turnKey, prompt).change((turn) => { turn.prompt = prompt; });
  }

  /**
   * Seeds the transcript from the read model.
   *
   * Not a second kind of truth: the projection folded the same facts this class
   * folds, once, on the way in. What arrives is a list of turns with no bodies —
   * those are fetched one at a time, if anyone opens them.
   *
   * A turn already on screen is left alone. Reopening a session while its last
   * turn is still streaming must not replace the live one with a stale digest.
   */
  hydrate(digests: readonly TurnDigest[]): void {
    const live = new Map(this.turns.value.map((turn) => [turn.turnKey, turn]));
    const next: TurnModel[] = [];
    for (const digest of digests) {
      const existing = live.get(digest.turnKey);
      if (existing) { next.push(existing); continue; }
      const turn = new TurnModel(digest.turnKey, digest.prompt);
      turn.phase = PHASES.has(digest.phase) ? digest.phase as TurnModel["phase"] : "done";
      turn.answer = digest.answer;
      turn.error = digest.error;
      turn.iterations = digest.iterations;
      turn.toolCalls = digest.toolCalls;
      turn.bodiesLoaded = false;
      next.push(turn);
    }
    // A turn submitted in this session but not yet projected still belongs on
    // screen; the projection is behind, not authoritative about what exists.
    for (const turn of this.turns.value) if (!digests.some((digest) => digest.turnKey === turn.turnKey)) next.push(turn);
    this.turns.set(next);
  }

  loadBlocks(turnKey: string, blocks: readonly TurnBlock[]): void {
    this.turn(turnKey)?.loadBlocks(blocks);
  }

  dropBlocks(turnKey: string): void {
    this.turn(turnKey)?.dropBlocks();
  }

  /** Applies one envelope by looking up its reducer. */
  apply(envelope: EventEnvelope): void {
    if (this.seenEventIds.has(envelope.eventId)) return;
    this.seenEventIds.add(envelope.eventId);

    if (envelope.kind === "result" || envelope.kind === "failure") { this.applyTerminal(envelope); return; }
    const event = parseVibeProgressEvent(envelope.action, envelope.payload);
    if (!event) return;
    const positioned = typeof (event as { seq?: unknown }).seq === "number" ? event : { ...event, seq: this.legacySeq };
    this.legacySeq += 1;
    const reduce = REDUCERS[event.action] as (model: VibeSessionModel, payload: unknown) => void;
    reduce(this, positioned);
  }

  /**
   * One reaction's terminal result.
   *
   * A turn is a chain of reactions, so a terminal here means one reaction
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
    if (ok) return;

    const belongsToTurn = Boolean(envelope.turnId)
      || Boolean(outcome?.turnKey)
      || this.turns.value.some((turn) => turn.turnKey === envelope.transactionKey);

    // A session-open result belongs to no turn. Success is already carried by
    // the `session.opened` fact, so only a refusal needs surfacing here — and it
    // has to be, or a rejected folder would look like nothing happening at all.
    if (!belongsToTurn) {
      this.sessionError.set(error || "세션을 열지 못했습니다.");
      return;
    }
    const turnKey = envelope.turnId ?? outcome?.turnKey ?? envelope.transactionKey;
    this.ensureTurn(turnKey).change((turn) => { turn.phase = "failed"; turn.error = error; });
  }
}
