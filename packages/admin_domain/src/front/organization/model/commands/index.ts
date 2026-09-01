import {
  organizationInferenceModelPath,
  parseOrganizationSnapshot,
  type OrganizationColor,
  type OrganizationIcon,
  type OrganizationSnapshot,
} from "../../../../common/protocol/organization/index.js";

/**
 * How this feature reaches the server. A function, not a wire shape.
 *
 * Injected rather than imported: the domain must not know how a request is
 * authenticated, only that something can make one.
 */
export type OrganizationFetch = (path: string, options?: RequestInit) => Promise<unknown>;

/** What to say when a request fails without saying anything useful itself. */
export interface OrganizationCommandText {
  failed: string;
}

/** Reported so a caller can clear a form or flash a confirmation on success. */
export type CommandResult = boolean;

/**
 * Every write to one organisation node, and the shape all of them share.
 *
 * These lived inside the modal as seven near-identical async functions, each
 * opening with `setBusy(true); setError("")`, each closing with a `finally`,
 * and each swallowing its own error with the same comment. That is not
 * rendering — it is what the screen *does* — and a second surface onto the same
 * organisation would have had to copy all seven.
 *
 * The server answers every one of them with the whole snapshot, so there is one
 * path in and one place the new truth lands. No optimistic patching and no
 * merging a response into a local copy.
 */
export class OrganizationCommands {
  /**
   * The words arrive as a getter, not a value.
   *
   * A caller that builds its translations by spreading bundles hands over a new
   * object on every render. If that object decided this instance's identity the
   * caller would rebuild the commands each time, and any effect keyed on them
   * would re-run for ever.
   */
  constructor(
    private readonly request: OrganizationFetch,
    private readonly words: () => OrganizationCommandText,
    private readonly onSnapshot: (snapshot: OrganizationSnapshot) => void,
    private readonly progress: (change: { busy?: boolean; error?: string }) => void,
  ) {}

  private async run(path: string, options: RequestInit): Promise<CommandResult> {
    this.progress({ busy: true, error: "" });
    try {
      const next = parseOrganizationSnapshot(await this.request(path, options));
      if (!next) throw new Error(this.words().failed);
      this.onSnapshot(next);
      return true;
    } catch (reason) {
      this.progress({ error: reason instanceof Error ? reason.message : this.words().failed });
      return false;
    } finally {
      this.progress({ busy: false });
    }
  }

  saveInformation(
    organizationId: string,
    draft: { name: string; color: OrganizationColor; icon: OrganizationIcon },
  ): Promise<CommandResult> {
    return this.run(`/api/organizations/${organizationId}`, { method: "PUT", body: JSON.stringify(draft) });
  }

  addMember(organizationId: string, userId: string): Promise<CommandResult> {
    return this.run(`/api/organizations/${organizationId}/members`, { method: "POST", body: JSON.stringify({ userId }) });
  }

  removeMember(organizationId: string, userId: string): Promise<CommandResult> {
    return this.run(`/api/organizations/${organizationId}/members/${userId}`, { method: "DELETE" });
  }

  /**
   * Grants a scope, or takes it back when it is already the one held.
   *
   * The control is a toggle, so pressing the scope somebody already has has to
   * mean "remove it" — otherwise there is no way to revoke without a second
   * control. Which of the two it is depends on the current snapshot, so the
   * decision belongs with the data rather than with the button.
   */
  setResponsibility(
    organizationId: string,
    userId: string,
    scope: "node" | "subtree",
    held: "node" | "subtree" | undefined,
  ): Promise<CommandResult> {
    return held === scope
      ? this.run(`/api/organizations/${organizationId}/responsibilities/${userId}`, { method: "DELETE" })
      : this.run(`/api/organizations/${organizationId}/responsibilities`, { method: "POST", body: JSON.stringify({ userId, scope }) });
  }

  /**
   * Chooses the organisation's one model, or clears it when nothing is named.
   *
   * A `<select>` whose placeholder means "inherit from the parent" reports that
   * choice as the empty value, and the empty value is a real answer rather than
   * a caller who forgot an argument — so it clears rather than doing nothing.
   */
  setInferenceModel(organizationId: string, modelId: string): Promise<CommandResult> {
    return this.run(organizationInferenceModelPath(organizationId), modelId
      ? { method: "PUT", body: JSON.stringify({ modelId }) }
      : { method: "DELETE" });
  }

  clearInferenceModel(organizationId: string): Promise<CommandResult> {
    return this.run(organizationInferenceModelPath(organizationId), { method: "DELETE" });
  }
}

/**
 * The screen's own writes, as distinct from one node's.
 *
 * Loading is here with them because it wears the same clothes: busy on, error
 * cleared, snapshot in, busy off. The one thing it does differently is worth
 * saying — the account list is only fetched when the snapshot says this actor
 * can manage members anywhere. Asking otherwise is a request the server
 * refuses, and an error in the corner of a screen that is working correctly.
 */
export class OrganizationScreenCommands {
  constructor(
    private readonly request: OrganizationFetch,
    private readonly words: () => OrganizationCommandText,
    private readonly apply: (change: { snapshot?: OrganizationSnapshot; accounts?: readonly unknown[] }) => void,
    private readonly progress: (change: { busy?: boolean; error?: string }) => void,
    private readonly parseAccounts: (value: unknown) => { users: readonly unknown[] } | null,
  ) {}

  private async run<T>(work: () => Promise<T>): Promise<T | null> {
    this.progress({ busy: true, error: "" });
    try { return await work(); }
    catch (reason) {
      this.progress({ error: reason instanceof Error ? reason.message : this.words().failed });
      return null;
    } finally { this.progress({ busy: false }); }
  }

  load(): Promise<OrganizationSnapshot | null> {
    return this.run(async () => {
      const snapshot = parseOrganizationSnapshot(await this.request("/api/organizations"));
      if (!snapshot) throw new Error(this.words().failed);
      this.apply({ snapshot });

      if (!snapshot.access.nodes.some((node) => node.canManageMembers)) {
        this.apply({ accounts: [] });
        return snapshot;
      }
      const accounts = this.parseAccounts(await this.request("/api/organizations/users"));
      if (!accounts) throw new Error(this.words().failed);
      this.apply({ accounts: accounts.users });
      return snapshot;
    });
  }

  private write(path: string, options: RequestInit): Promise<OrganizationSnapshot | null> {
    return this.run(async () => {
      const snapshot = parseOrganizationSnapshot(await this.request(path, options));
      if (!snapshot) throw new Error(this.words().failed);
      this.apply({ snapshot });
      return snapshot;
    });
  }

  create(input: { name: string; mode: string; parentId: string | null }): Promise<OrganizationSnapshot | null> {
    return this.write("/api/organizations", { method: "POST", body: JSON.stringify(input) });
  }

  remove(organizationId: string): Promise<OrganizationSnapshot | null> {
    return this.write(`/api/organizations/${organizationId}`, { method: "DELETE" });
  }
}

/** The nodes directly under one parent. `null` asks for the roots. */
export function childrenOf(snapshot: OrganizationSnapshot, parentId: string | null) {
  return snapshot.organizations.filter((organization) => organization.parentId === parentId);
}
