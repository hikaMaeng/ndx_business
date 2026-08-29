/**
 * What a deployment configures, on the wire.
 *
 * Five kinds, one shape. `value` is deliberately opaque here: what an MCP entry
 * needs and what a prompt needs have nothing in common, and a union that tried
 * to say both would have to be widened every time a kind learns a field.
 */
export const POLICY_KINDS = ["skill", "mcp", "command", "hook", "prompt"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/**
 * `default` is a suggestion a nearer layer may override. `enforced` is policy:
 * only an organisation may set it, and nothing below can take it back.
 */
export const POLICY_MODES = ["default", "enforced"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];

export type PolicyScope =
  | { kind: "organization"; organizationId: string }
  | { kind: "account" }
  | { kind: "project"; projectId: string };

export interface PolicyEntry {
  id: string;
  kind: PolicyKind;
  name: string;
  organizationId: string | null;
  ownerId: string | null;
  projectId: string | null;
  mode: PolicyMode;
  enabled: boolean;
  value: Record<string, unknown>;
  updatedAt: string;
}

export interface PolicyEntriesResponse { entries: PolicyEntry[] }

export interface SavePolicyRequest {
  kind: PolicyKind;
  name: string;
  /** Exactly one of these decides where it lands. Omitting all of them is an error. */
  organizationId?: string | null;
  projectId?: string | null;
  mode?: PolicyMode;
  enabled?: boolean;
  value?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePolicyEntry(value: unknown): PolicyEntry | null {
  if (!isRecord(value)) return null;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && POLICY_KINDS.includes(value.kind as PolicyKind)
    && POLICY_MODES.includes(value.mode as PolicyMode)
    && typeof value.enabled === "boolean"
    && isRecord(value.value)
    ? value as unknown as PolicyEntry
    : null;
}

export function parsePolicyEntriesResponse(value: unknown): PolicyEntriesResponse | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  return value.entries.every((entry) => parsePolicyEntry(entry) !== null)
    ? { entries: value.entries as PolicyEntry[] }
    : null;
}

/**
 * Validates a save before it is sent.
 *
 * The name is what makes an entry the same entry across layers, so an empty one
 * would create something no other layer can ever override. Enforcement is
 * refused here as well as in the domain: the screen should not offer a control
 * that produces a request the server will reject.
 */
export function parseSavePolicyRequest(value: unknown): SavePolicyRequest | null {
  if (!isRecord(value)) return null;
  if (!POLICY_KINDS.includes(value.kind as PolicyKind)) return null;
  if (typeof value.name !== "string" || !value.name.trim()) return null;

  const organizationId = typeof value.organizationId === "string" && value.organizationId ? value.organizationId : null;
  const projectId = typeof value.projectId === "string" && value.projectId ? value.projectId : null;
  if (organizationId && projectId) return null;

  const mode = POLICY_MODES.includes(value.mode as PolicyMode) ? value.mode as PolicyMode : "default";
  if (mode === "enforced" && !organizationId) return null;

  return {
    kind: value.kind as PolicyKind,
    name: value.name.trim(),
    organizationId,
    projectId,
    mode,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    value: isRecord(value.value) ? value.value : {},
  };
}

/** What a kind's `value` is expected to carry, for a form to render the right fields. */
export const POLICY_VALUE_FIELDS: Readonly<Record<PolicyKind, readonly string[]>> = {
  skill: ["description"],
  mcp: ["description", "command"],
  command: ["description", "run"],
  hook: ["description", "on", "run"],
  prompt: ["title", "body"],
};
