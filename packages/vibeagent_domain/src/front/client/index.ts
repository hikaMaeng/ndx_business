import { BrokerClient, type ConnectionState } from "agent/front";
import { VIBE_TURN_ACTION, type VibeTurnSubmission } from "../../common/index.js";
import { VibeSessionModel } from "../model/session.js";

export interface VibeClientOptions {
  token(): string;
  onChange(): void;
}

/**
 * The vibe coding client.
 *
 * The library gives transport — send an event, receive an event, resume from a
 * cursor. Everything here is the part it cannot give: which action to submit,
 * and what an arriving event means. The screen sits on top of this and only
 * renders `model.getSnapshot()`.
 */
export class VibeClient {
  readonly model = new VibeSessionModel();
  private connection: ConnectionState = "connecting";
  private broker: BrokerClient | undefined;
  private sessionId = "";

  constructor(private readonly options: VibeClientOptions) {
    this.model.subscribe(() => this.options.onChange());
  }

  getConnection(): ConnectionState { return this.connection; }
  getSessionId(): string { return this.sessionId; }

  /**
   * Opens a session. The id carries its owner so the broker can judge ownership
   * from the envelope alone — no round trip is needed to create one, because
   * the stream begins with the first event that lands on it.
   */
  open(userId: string, email: string): void {
    this.sessionId = `${userId}-${crypto.randomUUID()}`;
    this.model.reset();
    this.model.setIdentity(this.sessionId, email);
    this.broker?.close();
    this.broker = new BrokerClient({
      token: this.options.token,
      channels: () => [`vibe.${this.sessionId}`],
      onState: (state) => { this.connection = state; this.options.onChange(); },
      onEvent: (envelope) => this.model.apply(envelope),
    });
    this.broker.connect();
  }

  /** Submits a turn as an event. Returns the turn key, or null if the socket is down. */
  submit(prompt: string): string | null {
    const text = prompt.trim();
    if (!text || !this.broker?.isOpen()) return null;
    const submission: VibeTurnSubmission = { sessionId: this.sessionId, turnKey: crypto.randomUUID(), prompt: text };
    // userId is deliberately absent: the broker stamps it from the connection.
    const sent = this.broker.send({
      action: VIBE_TURN_ACTION,
      transactionKey: submission.turnKey,
      sessionId: submission.sessionId,
      payload: { sessionKey: submission.sessionId, turnKey: submission.turnKey, prompt: submission.prompt },
    });
    if (!sent) return null;
    this.model.startTurn(submission.turnKey, submission.prompt);
    return submission.turnKey;
  }

  close(): void { this.broker?.close(); this.broker = undefined; this.sessionId = ""; this.model.reset(); }
}
