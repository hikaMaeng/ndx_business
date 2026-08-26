import { BrokerClient, type ConnectionState } from "agent/front";
import { VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION, normaliseWorkspacePath } from "../../common/index.js";
import { VibeSessionModel } from "../model/index.js";

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
  onChange(): void;
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
  private connection: ConnectionState = "connecting";
  private broker: BrokerClient | undefined;
  private sessionId = "";
  private userId = "";
  private email = "";
  private sessions: VibeSessionListItem[] = [];
  private folders: string[] = [];
  private loadingHistory = false;
  /** The folder a brand-new session must be opened with, held until the socket is up. */
  private pendingOpen: string | undefined;

  constructor(private readonly options: VibeClientOptions) {
    this.model.subscribe(() => this.options.onChange());
  }

  getConnection(): ConnectionState { return this.connection; }
  getSessionId(): string { return this.sessionId; }
  getSessions(): VibeSessionListItem[] { return this.sessions; }
  isLoadingHistory(): boolean { return this.loadingHistory; }
  /** A session is usable only once its folder is on record. */
  isOpen(): boolean { return Boolean(this.sessionId) && Boolean(this.model.getSnapshot().workspace); }

  /**
   * Projects, newest activity first.
   *
   * A folder with no sessions yet is still a project — that is the whole point
   * of adding one before working in it — so the list is folders on disk joined
   * with the sessions that happen to live in them, not sessions grouped by folder.
   */
  getProjects(): VibeProject[] {
    const byFolder = new Map<string, VibeProject>();
    for (const folder of this.folders) byFolder.set(folder, { workspace: folder, sessions: [], lastActivityAt: "" });
    for (const session of this.sessions) {
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
    this.sessions = body.sessions ?? [];
    this.options.onChange();
  }

  /** The folders under the projects root. These are the projects. */
  async refreshProjects(): Promise<void> {
    const response = await this.api("/api/vibe/workspaces");
    if (!response.ok) return;
    const body = await response.json() as { workspaces?: string[] };
    this.folders = body.workspaces ?? [];
    this.options.onChange();
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
    if (!folder || !this.sessionId || !this.broker?.isOpen()) return;
    // userId is deliberately absent: the broker stamps it from the connection.
    this.broker.send({
      action: VIBE_SESSION_OPEN_ACTION,
      transactionKey: `open:${this.sessionId}`,
      sessionId: this.sessionId,
      payload: { sessionKey: this.sessionId, workspace: folder },
    });
  }

  /**
   * Reopens a past session and replays it from the beginning.
   *
   * A plain subscription starts at the current high-water mark, which would
   * show an empty transcript. Asking the broker for a start cursor first is
   * what makes history visible — and it is also how the folder comes back,
   * since `session.opened` is the first event in the stream.
   */
  async openExisting(sessionId: string): Promise<void> {
    this.pendingOpen = undefined;
    this.loadingHistory = true;
    this.options.onChange();
    try {
      const response = await this.api("/api/channels/cursor", {
        method: "POST",
        body: JSON.stringify({ channels: [`vibe.${sessionId}`], from: "start" }),
      });
      const cursor = response.ok ? (await response.json() as { cursor?: string }).cursor : undefined;
      this.attach(sessionId, cursor);
      // The list already knows the folder; showing it before replay reaches
      // `session.opened` avoids a flash of "not open yet".
      const known = this.sessions.find((item) => item.sessionId === sessionId)?.workspace;
      if (known) this.model.setWorkspace(known);
    } finally {
      this.loadingHistory = false;
      this.options.onChange();
    }
  }

  private attach(sessionId: string, cursor: string | undefined): void {
    this.sessionId = sessionId;
    this.model.reset();
    this.model.setIdentity(sessionId, this.email);
    this.broker?.close();
    this.broker = new BrokerClient({
      token: this.options.token,
      channels: () => [`vibe.${this.sessionId}`],
      ...(cursor ? { initialCursor: cursor } : {}),
      onState: (state) => {
        this.connection = state;
        if (state === "online") this.flushPendingOpen();
        this.options.onChange();
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
      sessionId: this.sessionId,
      payload: { sessionKey: this.sessionId, turnKey, prompt: text },
    });
    if (!sent) return null;
    this.model.startTurn(turnKey, text);
    return turnKey;
  }

  close(): void {
    this.broker?.close();
    this.broker = undefined;
    this.sessionId = "";
    this.sessions = [];
    this.pendingOpen = undefined;
    this.model.reset();
  }
}
