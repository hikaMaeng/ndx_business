import {
  parsePolicyEntriesResponse,
  type PolicyEntry,
  type PolicyKind,
  type PolicyMode,
} from "../../../../common/protocol/policy/index.js";

export type PolicyFetch = (path: string, options?: RequestInit) => Promise<unknown>;
export interface PolicyCommandText { failed: string }

/**
 * Which layer is being edited.
 *
 * A tagged choice rather than three optional ids, because "an organisation's
 * and also a project's" is not a thing an entry can be, and a shape that can
 * express it is a shape somebody will eventually produce by accident.
 */
export type PolicyScope =
  | { layer: "organization"; organizationId: string }
  | { layer: "account" }
  | { layer: "project"; projectId: string };

const query = (scope: PolicyScope): string => {
  if (scope.layer === "organization") return `?organizationId=${encodeURIComponent(scope.organizationId)}`;
  if (scope.layer === "project") return `?projectId=${encodeURIComponent(scope.projectId)}`;
  return "";
};

const target = (scope: PolicyScope) =>
  scope.layer === "organization" ? { organizationId: scope.organizationId }
  : scope.layer === "project" ? { projectId: scope.projectId }
  : {};

/**
 * Reading and writing one layer's entries.
 *
 * Every method reports whether it worked so a caller can close a form without
 * reading an error slice back and guessing. The list is returned rather than
 * pushed into a model: this screen is the only reader, and an entry that has
 * not been saved is not state anything else depends on.
 */
export class PolicyCommands {
  constructor(
    private readonly request: PolicyFetch,
    private readonly words: () => PolicyCommandText,
    private readonly progress: (change: { busy?: boolean; error?: string }) => void,
  ) {}

  private async run<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    this.progress({ busy: true, error: "" });
    try { return await work(); }
    catch (reason) {
      this.progress({ error: reason instanceof Error ? reason.message : this.words().failed });
      return fallback;
    } finally { this.progress({ busy: false }); }
  }

  list(scope: PolicyScope): Promise<PolicyEntry[]> {
    return this.run(async () => {
      const answer = parsePolicyEntriesResponse(await this.request(`/api/policy${query(scope)}`));
      if (!answer) throw new Error(this.words().failed);
      return answer.entries;
    }, []);
  }

  save(scope: PolicyScope, entry: {
    kind: PolicyKind; name: string; mode?: PolicyMode; enabled?: boolean; value?: Record<string, unknown>;
  }): Promise<boolean> {
    return this.run(async () => {
      await this.request("/api/policy", {
        method: "PUT",
        body: JSON.stringify({ ...entry, ...target(scope) }),
      });
      return true;
    }, false);
  }

  remove(scope: PolicyScope, kind: PolicyKind, name: string): Promise<boolean> {
    return this.run(async () => {
      const suffix = scope.layer === "organization" ? `&organizationId=${encodeURIComponent(scope.organizationId)}`
        : scope.layer === "project" ? `&projectId=${encodeURIComponent(scope.projectId)}` : "";
      await this.request(`/api/policy?kind=${kind}&name=${encodeURIComponent(name)}${suffix}`, { method: "DELETE" });
      return true;
    }, false);
  }

  /** What one project actually gets, with the losers, for the "why is mine different" view. */
  resolved(projectName: string): Promise<unknown> {
    return this.run(
      () => this.request(`/api/policy/resolved?project=${encodeURIComponent(projectName)}`),
      null,
    );
  }
}

/**
 * A blank entry of a kind.
 *
 * The fields a kind carries are declared once in the protocol, so a form can be
 * generated from them and a new kind does not need a new form.
 */
export function blankValue(kind: PolicyKind, fields: readonly string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, ""]));
}

/** Groups a layer's entries for display, so each kind gets its own list. */
export function groupByKind(entries: readonly PolicyEntry[]): Array<[PolicyKind, PolicyEntry[]]> {
  const groups = new Map<PolicyKind, PolicyEntry[]>();
  for (const entry of entries) groups.set(entry.kind, [...(groups.get(entry.kind) ?? []), entry]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}
