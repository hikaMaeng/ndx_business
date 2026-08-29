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

  /**
   * The organisations whose entries this actor may edit.
   *
   * Asked of the same snapshot the organisation screen uses, and filtered by
   * the same permission the policy routes enforce — `canUpdate` is projected
   * from `canManage`, which is what `requireOrganizationManage` reads. Deriving
   * it from anything else produces a chip that saves and then fails, which is
   * the worst of the three possible answers.
   */
  layers(): Promise<Array<{ id: string; name: string }>> {
    return this.run(async () => {
      const answer = await this.request("/api/organizations") as {
        organizations?: Array<{ id: string; name: string }>;
        access?: { nodes?: Array<{ organizationId: string; canUpdate: boolean }> };
      };
      return manageableOrganizations(answer);
    }, []);
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

/**
 * The manageable organisations in a snapshot, named.
 *
 * Separate from the fetch so the rule can be tested without a server, and
 * because it is the rule — not the request — that has to keep agreeing with
 * what the server enforces.
 */
export function manageableOrganizations(snapshot: {
  organizations?: Array<{ id: string; name: string }>;
  access?: { nodes?: Array<{ organizationId: string; canUpdate: boolean }> };
}): Array<{ id: string; name: string }> {
  const allowed = new Set(
    (snapshot.access?.nodes ?? []).filter((node) => node.canUpdate).map((node) => node.organizationId),
  );
  return (snapshot.organizations ?? [])
    .filter((organization) => allowed.has(organization.id))
    .map((organization) => ({ id: organization.id, name: organization.name }));
}
