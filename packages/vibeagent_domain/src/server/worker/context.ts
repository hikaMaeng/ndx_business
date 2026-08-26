import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS, normaliseWorkspacePath } from "../../common/index.js";
import type { LoopConfig } from "../loop/index.js";

/**
 * The worker server's memory.
 *
 * The worker is not stateless. What it does not have is state hidden inside a
 * control structure — no loop variable, no closure only one call stack can see.
 * Its memory is an explicit object, kept in a repository, and handed to a
 * handler as an argument.
 *
 * That is the rule that makes the whole thing controllable: **a handler causes
 * side effects only on the context it was given.** It does not reach for a
 * module-level map, and it cannot touch another session. Everything a handler
 * is allowed to change arrives through its parameters, so what it can affect is
 * readable from its signature.
 *
 * There are two. `WorkerGlobals` is what every session shares — a database pool
 * and configuration. `SessionContext` is one session's memory, and the
 * repository keeps exactly one per session id **within this process**.
 *
 * That last qualifier is the whole difficulty. A singleton in one process is
 * not a singleton in a deployment: worker threads are separate isolates and
 * replicas are separate machines, and no in-memory lock spans either. Anything
 * that must hold across workers has to be fenced by the database — the
 * execution claim — or derived from the log, which is why the folder is read
 * back from the `session.opened` fact rather than trusted from whichever copy
 * of this object happens to be warm. See `nextSeq` for exactly what the
 * sequence does and does not promise.
 */
export interface WorkerGlobals {
  pool: Pool;
  config: LoopConfig;
}

/**
 * One session's memory, and the only thing a handler for that session may change.
 */
export class SessionContext {
  private workspacePath: string | null;
  private seq: number;

  constructor(readonly sessionKey: string, workspace: string | null, seqStart: number) {
    this.workspacePath = workspace;
    this.seq = seqStart;
  }

  /** The folder this session works in, or null while it has not been opened. */
  get workspace(): string | null { return this.workspacePath; }

  /**
   * Fixes the folder. Only the session-open handler calls this, and only after
   * refusing a change — the folder is immutable once recorded.
   */
  openWorkspace(workspace: string): void { this.workspacePath = workspace; }

  /**
   * The position of the next fact this session emits.
   *
   * Nothing downstream trusts arrival order, so this number is what places a
   * delta that overtook another one.
   *
   * What is actually guaranteed, and by what. This is memory, and memory cannot
   * be shared across V8 isolates or processes — there is no critical section
   * available here, and pretending otherwise is how a counter silently starts
   * issuing duplicates. So the guarantee is deliberately narrow:
   *
   * - A turn's positions are unique, because one turn is owned by exactly one
   *   worker, fenced by the execution claim. Only one counter ever numbers a
   *   given turn's facts, and comparing positions inside one turn is the only
   *   thing the client does with them.
   * - A position is NOT a session-wide total order. Two turns of one session
   *   running on two workers would each number from their own copy of this
   *   object and their ranges could overlap. Nothing reads it that way, and
   *   nothing should start to.
   *
   * Within a single process the increment is safe without a lock for a reason
   * worth stating: it is synchronous, and JavaScript does not interleave
   * synchronous statements. There is no await in here, and there must not be.
   *
   * Hydration starts from the highest position already in the log, which keeps
   * a session resumed by another worker from restarting at zero on top of its
   * own history.
   */
  nextSeq(): number { return this.seq++; }
}

/** The session id an event belongs to, from the envelope first and the payload only as a fallback. */
export function sessionKeyOf(event: EventEnvelope): string {
  const payload = event.payload as Record<string, unknown>;
  const fromPayload = typeof payload.sessionKey === "string" ? payload.sessionKey : "";
  return event.sessionId ?? fromPayload;
}

/**
 * The repository that owns those memories.
 *
 * A context is hydrated once from the log — the folder from the session's
 * opened fact, the position from the highest one already recorded — and then
 * kept. Hydrating from the log rather than from a table is what lets any worker
 * pick up any session: a process that has never seen this session reconstructs
 * the same memory from the same events.
 */
export class SessionContexts {
  private readonly live = new Map<string, SessionContext>();
  private readonly loading = new Map<string, Promise<SessionContext>>();

  constructor(private readonly pool: Pool) {}

  /**
   * The one context for this session in this process.
   *
   * Concurrent callers must get the *same object*. Two events for a session can
   * be picked up in the same tick, and if each awaited its own hydration they
   * would end up with two contexts, two counters and two answers about the
   * folder. Sharing the in-flight promise is the closest thing to a critical
   * section available here, and it works only because the check and the insert
   * on either side of it are synchronous.
   */
  async load(sessionKey: string): Promise<SessionContext> {
    if (!sessionKey) return new SessionContext(sessionKey, null, 0);
    const existing = this.live.get(sessionKey);
    if (existing) return existing;
    const pending = this.loading.get(sessionKey);
    if (pending) return pending;

    const hydration = this.hydrate(sessionKey).then((context) => {
      this.live.set(sessionKey, context);
      this.loading.delete(sessionKey);
      return context;
    }).catch((error) => { this.loading.delete(sessionKey); throw error; });
    this.loading.set(sessionKey, hydration);
    return hydration;
  }

  private async hydrate(sessionKey: string): Promise<SessionContext> {
    const result = await this.pool.query<{ workspace: string | null; max_seq: string | null }>(
      // The earliest opened fact wins. If a session were somehow opened twice,
      // every reader converges on the same folder rather than on whichever row
      // it happened to see.
      `SELECT (ARRAY_AGG(payload->>'workspace' ORDER BY sequence) FILTER (WHERE action = $2))[1] AS workspace,
              max((payload->>'seq')::bigint)::text AS max_seq
         FROM event_store
        WHERE session_id = $1`,
      [sessionKey, VIBE_ACTIONS.sessionOpened],
    );
    const row = result.rows[0];
    const workspace = normaliseWorkspacePath(row?.workspace ?? null);
    const seqStart = row?.max_seq ? Number(row.max_seq) + 1 : 0;
    return new SessionContext(sessionKey, workspace, Number.isFinite(seqStart) ? seqStart : 0);
  }

  /** Drops a session's memory. Only for shutdown and tests; the log can always rebuild it. */
  forget(sessionKey: string): void { this.live.delete(sessionKey); }
}
