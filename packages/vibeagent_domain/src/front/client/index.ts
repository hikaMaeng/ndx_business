import { BrokerClient, type ConnectionState } from "agent/front";
import { VIBE_TURN_ACTION } from "../../common/index.js";
import { VibeSessionModel } from "../model/session.js";

export interface VibeSessionListItem {
  sessionId: string;
  title: string;
  turns: number;
  toolCalls: number;
  startedAt: string;
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
 */
export class VibeClient {
  readonly model = new VibeSessionModel();
  private connection: ConnectionState = "connecting";
  private broker: BrokerClient | undefined;
  private sessionId = "";
  private userId = "";
  private email = "";
  private sessions: VibeSessionListItem[] = [];
  private loadingHistory = false;

  constructor(private readonly options: VibeClientOptions) {
    this.model.subscribe(() => this.options.onChange());
  }

  getConnection(): ConnectionState { return this.connection; }
  getSessionId(): string { return this.sessionId; }
  getSessions(): VibeSessionListItem[] { return this.sessions; }
  isLoadingHistory(): boolean { return this.loadingHistory; }

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

  /**
   * Starts a new session.
   *
   * The id carries its owner so the broker can judge ownership from the
   * envelope alone; no round trip is needed, because the stream begins with the
   * first event that lands on it.
   */
  openNew(): void {
    this.attach(`${this.userId}-${crypto.randomUUID()}`, undefined);
  }

  /**
   * Reopens a past session and replays it from the beginning.
   *
   * A plain subscription starts at the current high-water mark, which would
   * show an empty transcript. Asking the broker for a start cursor first is
   * what makes history visible.
   */
  async openExisting(sessionId: string): Promise<void> {
    this.loadingHistory = true;
    this.options.onChange();
    try {
      const response = await this.api("/api/channels/cursor", {
        method: "POST",
        body: JSON.stringify({ channels: [`vibe.${sessionId}`], from: "start" }),
      });
      const cursor = response.ok ? (await response.json() as { cursor?: string }).cursor : undefined;
      this.attach(sessionId, cursor);
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
      initialCursor: cursor,
      onState: (state) => { this.connection = state; this.options.onChange(); },
      onEvent: (envelope) => this.model.apply(envelope),
    });
    this.broker.connect();
  }

  /** Submits a turn as an event. Returns the turn key, or null if the socket is down. */
  submit(prompt: string): string | null {
    const text = prompt.trim();
    if (!text || !this.sessionId || !this.broker?.isOpen()) return null;
    const turnKey = crypto.randomUUID();
    // userId is deliberately absent: the broker stamps it from the connection.
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
    this.model.reset();
  }
}
