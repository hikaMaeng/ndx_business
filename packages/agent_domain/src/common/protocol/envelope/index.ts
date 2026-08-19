export type AgentEventKind = "request" | "response" | "progress" | "notice" | "heartbeat";
export type AgentEventState = "queued" | "accepted" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "timed_out";
export type AgentEventScope = "session" | "run" | "turn" | "iteration" | "step" | "tool" | "process" | "event";

export type AgentEventContext = {
  sessionKey: string;
  runKey?: string;
  turnKey?: string;
  iterationKey?: string;
  stepKey?: string;
  toolCallKey?: string;
  parentEventKey?: string;
  causationEventKey?: string;
  correlationKey?: string;
};

export type AgentEvent<TAction extends string = string, TPayload = Record<string, unknown>> = AgentEventContext & {
  eventKey: string;
  transactionKey: string;
  kind: AgentEventKind;
  action: TAction;
  channel: string;
  replyChannel: string;
  source: string;
  state: AgentEventState;
  scope: AgentEventScope;
  sequence: number;
  createdAt: string;
  payload: TPayload;
};

export type AgentError = { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
export type AgentResult<T = unknown> = { ok: true; value?: T } | { ok: false; error: AgentError };
