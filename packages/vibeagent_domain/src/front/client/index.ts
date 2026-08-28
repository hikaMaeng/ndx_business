import { BrokerClient, type ConnectionState } from "agent/front";
import { VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION, normaliseWorkspacePath } from "../../common/index.js";
import { SliceModel, VibeSessionModel, type TurnDigest } from "../model/index.js";
import type { TurnBlock } from "../model/state.js";

/** One folded block as the read model serves it. */
interface BlockPayload {
  seq: number;
  kind: "reasoning" | "message" | "tool";
  iterationIndex: number;
  toolCallKey: string;
  command: string;
  body: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

/**
 * A folded block becomes the same shape a live one has.
 *
 * The screen must not be able to tell them apart: a turn watched as it happened
 * and the same turn reloaded an hour later are the same transcript, and any
 * difference here would show up as one rendering path for fresh turns and
 * another for old ones. A fold is a single slice at the block's own position.
 */
function toBlock(row: BlockPayload): TurnBlock {
  if (row.kind === "tool") {
    return {
      kind: "tool", seq: row.seq, toolCallKey: row.toolCallKey, command: row.command,
      stdout: row.body ? [{ seq: row.seq, text: row.body }] : [], stderr: [],
      exitCode: row.exitCode, timedOut: row.timedOut, durationMs: row.durationMs,
      done: true, failure: "",
    };
  }
  return { kind: row.kind, seq: row.seq, iterationIndex: row.iterationIndex, slices: [{ seq: row.seq, text: row.body }] };
}

export interface VibeSessionListItem {
  sessionId: string;
  title: string;
  /** The project folder this session works in. */
  workspace: string;
  turns: number;
  toolCalls: number;
  startedAt: string;
  lastActivityAt: string;
}

/** A project is a folder under the projects root, with the sessions that work in it. */
export interface VibeProject {
  workspace: string;
  sessions: VibeSessionListItem[];
  lastActivityAt: string;
}

export interface VibeClientOptions {
  token(): string;
}

/**
 * The vibe coding client.
 *
 * The library gives transport — send an event, receive an event, resume from a
 * cursor. Everything here is the part it cannot give: which action to submit,
 * what an arriving event means, and how a past session is reopened.
 *
 * One rule is enforced here as well as in the worker: a session cannot exist
 * without a project folder. The UI reaches that rule by construction — a
 * session is created under a project, so the folder is never something the user
 * types at session time — and `openNew` still refuses without one. Enforcing it
 * on both sides is deliberate: the client gives an immediate, specific error,
 * and the worker guarantees it for any client at all.
 */
export class VibeClient {
  readonly model = new VibeSessionModel();

  /**
   * Everything the screen reads, each behind its own trigger.
   *
   * These were private fields plus one `onChange` callback that fired for all
   * of them, so a reconnect re-rendered the transcript and a streamed token
   * re-rendered the project list. A component now subscribes to the slice it
   * reads and is not woken by the others.
   */
  readonly connection = new SliceModel<ConnectionState>("connecting");
  readonly sessions = new SliceModel<VibeSessionListItem[]>([]);
  readonly folders = new SliceModel<string[]>([]);
  readonly loadingHistory = new SliceModel<boolean>(false);
  /** The open session's id. Changing it swaps the whole surface. */
  readonly sessionId = new SliceModel<string>("");

  private broker: BrokerClient | undefined;
  private userId = "";
  private email = "";
  /** The folder a brand-new session must be opened with, held until the socket is up. */
  private pendingOpen: string | undefined;
  /**
   * Turns whose bodies are on their way.
   *
   * The screen repaints many times while one request is out — the paint that
   * asked for it, and every event that lands meanwhile — and each of those
   * paints would ask again. This is what makes "fetch it if it is missing" safe
   * to say on every frame.
   */
  private readonly fetching = new Set<string>();

  constructor(private readonly options: VibeClientOptions) {}

  /** A session is usable only once its folder is on record. */
  isOpen(): boolean { return Boolean(this.sessionId.value) && Boolean(this.model.workspace.value); }

  /**
   * Projects, newest activity first.
   *
   * A folder with no sessions yet is still a project — that is the whole point
   * of adding one before working in it — so the list is folders on disk joined
   * with the sessions that happen to live in them, not sessions grouped by folder.
   */
  getProjects(): VibeProject[] {
    const byFolder = new Map<string, VibeProject>();
    for (const folder of this.folders.value) byFolder.set(folder, { workspace: folder, sessions: [], lastActivityAt: "" });
    for (const session of this.sessions.value) {
      const folder = session.workspace || "(폴더 미지정)";
      const project = byFolder.get(folder) ?? { workspace: folder, sessions: [], lastActivityAt: "" };
      project.sessions.push(session);
      if (session.lastActivityAt > project.lastActivityAt) project.lastActivityAt = session.lastActivityAt;
      byFolder.set(folder, project);
    }
    return [...byFolder.values()].sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt) || left.workspace.localeCompare(right.workspace));
  }

  private async api(pathname: string, init: RequestInit = {}): Promise<Response> {
    return fetch(pathname, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.token()}`, ...(init.headers ?? {}) },
    });
  }

  setIdentity(userId: string, email: string): void { this.userId = userId; this.email = email; }

  /** Sessions are a query over event history, so the list is always the truth. */
  async refreshSessions(): Promise<void> {
    const response = await this.api("/api/vibe/sessions");
    if (!response.ok) return;
    const body = await response.json() as { sessions?: VibeSessionListItem[] };
    this.sessions.set(body.sessions ?? []);
  }

  /** The folders under the projects root. These are the projects. */
  async refreshProjects(): Promise<void> {
    const response = await this.api("/api/vibe/workspaces");
    if (!response.ok) return;
    const body = await response.json() as { workspaces?: string[] };
    this.folders.set(body.workspaces ?? []);
  }

  /**
   * Adds a project: an existing folder, or a new one created for the purpose.
   *
   * Returns the error message rather than throwing, because every failure here
   * is something the person typing needs to read.
   */
  async addProject(workspace: string): Promise<string | null> {
    const folder = normaliseWorkspacePath(workspace);
    if (!folder) return "폴더 이름은 영문·숫자로 시작하고 . _ - / 만 쓸 수 있습니다.";
    const response = await this.api("/api/vibe/workspaces", { method: "POST", body: JSON.stringify({ workspace: folder }) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      return body.error ?? "프로젝트를 추가하지 못했습니다.";
    }
    await this.refreshProjects();
    return null;
  }

  /**
   * Opens a new session in a project.
   *
   * The folder is a required argument, not an option with a default: a session
   * with no folder is not a lesser session, it is not a session. The id carries
   * its owner so the broker can judge ownership from the envelope alone.
   */
  openNew(workspace: string): string | null {
    const folder = normaliseWorkspacePath(workspace);
    if (!folder) return null;
    const sessionId = `${this.userId}-${crypto.randomUUID()}`;
    // The command cannot go out before the socket is up, so it waits for it.
    // Re-sending after a reconnect is harmless: opening the same folder twice
    // is idempotent, and opening a different one is what the worker refuses.
    this.pendingOpen = folder;
    this.attach(sessionId, undefined);
    return sessionId;
  }

  private flushPendingOpen(): void {
    const folder = this.pendingOpen;
    if (!folder || !this.sessionId.value || !this.broker?.isOpen()) return;
    // userId is deliberately absent: the broker stamps it from the connection.
    this.broker.send({
      action: VIBE_SESSION_OPEN_ACTION,
      transactionKey: `open:${this.sessionId.value}`,
      sessionId: this.sessionId.value,
      payload: { sessionKey: this.sessionId.value, workspace: folder },
    });
  }

  /**
   * Reopens a past session from the read model, and subscribes for what happens next.
   *
   * It used to replay the channel from the beginning. That is correct and
   * unaffordable: a finished session is mostly reasoning deltas, so replaying it
   * meant shipping tens of thousands of events to rebuild paragraphs a worker
   * had already folded once. Now the transcript arrives as a list of turns with
   * no bodies, and the socket starts at the current position — history from the
   * projection, the future from the log.
   *
   * The folder comes from the session list rather than from replayed
   * `session.opened`, which is the one thing the old path got for free.
   */
  async openExisting(sessionId: string): Promise<void> {
    this.pendingOpen = undefined;
    this.loadingHistory.set(true);
    try {
      this.attach(sessionId, undefined);
      const known = this.sessions.value.find((item) => item.sessionId === sessionId)?.workspace;
      if (known) this.model.setWorkspace(known);

      const response = await this.api(`/api/vibe/sessions/${encodeURIComponent(sessionId)}/turns`);
      if (response.ok) {
        const body = await response.json() as { turns?: TurnDigest[] };
        // Guard against a slow answer for a session the person has already left.
        if (this.sessionId.value === sessionId) this.model.hydrate(body.turns ?? []);
      }
    } finally {
      this.loadingHistory.set(false);
    }
  }

  /**
   * Fetches one turn's bodies, because somebody opened it.
   *
   * Nothing is fetched twice: a turn already holding its bodies is left alone.
   */
  async expandTurn(turnKey: string): Promise<void> {
    const turn = this.model.turn(turnKey);
    if (!turn || turn.bodiesLoaded || this.fetching.has(turnKey)) return;
    const sessionId = this.sessionId.value;
    this.fetching.add(turnKey);
    try {
      const response = await this.api(`/api/vibe/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnKey)}`);
      if (!response.ok || this.sessionId.value !== sessionId) return;
      const body = await response.json() as { blocks?: BlockPayload[] };
      this.model.loadBlocks(turnKey, (body.blocks ?? []).map(toBlock));
    } finally {
      this.fetching.delete(turnKey);
    }
  }

  /** Throws one turn's bodies away. Reopening it costs one request. */
  collapseTurn(turnKey: string): void { this.model.dropBlocks(turnKey); }


  private attach(sessionId: string, cursor: string | undefined): void {
    this.sessionId.set(sessionId);
    this.model.reset();
    this.model.setIdentity(sessionId, this.email);
    this.broker?.close();
    this.broker = new BrokerClient({
      token: this.options.token,
      channels: () => [`vibe.${this.sessionId.value}`],
      ...(cursor ? { initialCursor: cursor } : {}),
      onState: (state) => {
        this.connection.set(state);
        if (state === "online") this.flushPendingOpen();
      },
      onEvent: (envelope) => this.model.apply(envelope),
    });
    this.broker.connect();
  }

  /** Submits a turn as an event. Returns the turn key, or null if it cannot be sent. */
  submit(prompt: string): string | null {
    const text = prompt.trim();
    if (!text || !this.isOpen() || !this.broker?.isOpen()) return null;
    const turnKey = crypto.randomUUID();
    const sent = this.broker.send({
      action: VIBE_TURN_ACTION,
      transactionKey: turnKey,
      sessionId: this.sessionId.value,
      payload: { sessionKey: this.sessionId.value, turnKey, prompt: text },
    });
    if (!sent) return null;
    this.model.startTurn(turnKey, text);
    return turnKey;
  }

  close(): void {
    this.broker?.close();
    this.broker = undefined;
    this.sessionId.set("");
    this.sessions.set([]);
    this.pendingOpen = undefined;
    this.model.reset();
  }
}
