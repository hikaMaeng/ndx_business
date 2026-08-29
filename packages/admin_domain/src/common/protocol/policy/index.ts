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

/**
 * What a kind's `value` carries, for a form to render the right fields.
 *
 * `skill` carries `mcp` because a skill declares which MCP servers it needs.
 * The binding is the skill's, not the server's: a session is shown skills, and
 * an MCP entry listed beside the skill that wraps it would show one capability
 * under two names.
 */
export const POLICY_VALUE_FIELDS: Readonly<Record<PolicyKind, readonly string[]>> = {
  skill: ["description", "mcp"],
  mcp: ["description"],
  command: ["description", "run"],
  hook: ["description", "on", "run"],
  prompt: ["title", "body"],
};

/**
 * Kinds whose remaining fields depend on a choice.
 *
 * An MCP server is reached over stdio or over SSE, and the two share nothing
 * but a description — a command and its arguments mean nothing to an SSE
 * server, and a URL means nothing to a process. Listing all of them flat would
 * put four fields on every form that can never be filled in together, and
 * "which of these did they mean" would become a question the reader has to
 * answer from the values.
 *
 * Declared rather than coded so a third transport needs no new form, the same
 * way a sixth kind needs no new screen.
 */
export const POLICY_VARIANTS: Readonly<Partial<Record<PolicyKind, {
  field: string;
  options: Readonly<Record<string, readonly string[]>>;
}>>> = {
  mcp: {
    field: "transport",
    options: {
      stdio: ["command", "args", "env"],
      sse: ["url", "headers"],
    },
  },
};

/** One MCP server, once its transport has been settled. */
export type McpServer =
  | { transport: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { transport: "sse"; url: string; headers: Record<string, string> };

/** Splits a whitespace- or comma-separated list, dropping the empties. */
export function splitList(value: unknown): string[] {
  return typeof value === "string" ? value.split(/[\s,]+/).filter(Boolean) : [];
}

/** Parses `KEY=value` lines into a map, ignoring anything that is not one. */
export function parsePairs(value: unknown): Record<string, string> {
  const pairs: Record<string, string> = {};
  if (typeof value !== "string") return pairs;
  for (const line of value.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) pairs[key] = line.slice(at + 1).trim();
  }
  return pairs;
}

/**
 * Turns a stored MCP entry into something connectable, or refuses.
 *
 * Refusing rather than filling in a default: an MCP entry with no command and
 * no URL is not a server that will work once something else is configured, it
 * is an entry somebody stopped halfway through. Producing a plausible-looking
 * one would move the failure to the point of connection, where the reason is
 * gone.
 */
export function parseMcpServer(value: unknown): McpServer | null {
  if (!isRecord(value)) return null;
  const transport = value.transport === "sse" ? "sse" : value.transport === "stdio" ? "stdio" : null;
  if (!transport) return null;

  if (transport === "stdio") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command) return null;
    return { transport, command, args: splitList(value.args), env: parsePairs(value.env) };
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";
  // Checked here rather than at connect time, and `https` only outside
  // localhost: an MCP server is handed whatever the session can reach, and
  // sending that over plain http is a decision nobody should make by leaving a
  // field the way they typed it.
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) return null;
  return { transport, url, headers: parsePairs(value.headers) };
}
