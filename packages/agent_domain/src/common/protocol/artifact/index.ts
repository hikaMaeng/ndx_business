import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type ArtifactAction = "artifact.register.request" | "artifact.progress" | "artifact.registered.response" | "artifact.failed.response";
export type ArtifactPayload = { artifactKey?: string; kind: "file" | "diff" | "patch" | "log" | "screenshot"; path?: string; uri?: string; contentHash?: string; sizeBytes?: number };
export type ArtifactResultPayload = AgentResult<ArtifactPayload & { artifactKey: string }>;
export type ArtifactEvent = AgentEvent<ArtifactAction, ArtifactPayload | ArtifactResultPayload>;
