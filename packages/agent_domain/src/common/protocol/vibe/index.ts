export type { AgentError, AgentEventContext, AgentEventScope, AgentEventState, AgentResult } from "../envelope/index.js";
export * from "../session/index.js";
export * from "../turn/index.js";
export * from "../iteration/index.js";
export * from "../tool/index.js";
export * from "../hook/index.js";
export * from "../model/index.js";
export * from "../state/index.js";
export * from "../process/index.js";
export * from "../approval/index.js";
export * from "../artifact/index.js";

import type { AgentEvent } from "../envelope/index.js";
import type { ApprovalAction, ApprovalEvent } from "../approval/index.js";
import type { ArtifactAction, ArtifactEvent } from "../artifact/index.js";
import type { HookAction, HookEvent } from "../hook/index.js";
import type { IterationAction, IterationEvent } from "../iteration/index.js";
import type { ModelAction, ModelEvent } from "../model/index.js";
import type { ProcessAction, ProcessEvent } from "../process/index.js";
import type { SessionAction, SessionEvent } from "../session/index.js";
import type { StateAction, StateEvent } from "../state/index.js";
import type { ToolAction, ToolEvent } from "../tool/index.js";
import type { TurnAction, TurnEvent } from "../turn/index.js";

export type VibeEvent = SessionEvent | TurnEvent | IterationEvent | ToolEvent | HookEvent | ModelEvent | StateEvent | ProcessEvent | ApprovalEvent | ArtifactEvent;
export type VibeAction = SessionAction | TurnAction | IterationAction | ToolAction | HookAction | ModelAction | StateAction | ProcessAction | ApprovalAction | ArtifactAction;
export type VibeEventEnvelope = AgentEvent<VibeAction>;
