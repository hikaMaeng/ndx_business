import type {
  OrganizationInferenceModel,
  OrganizationSnapshot,
} from "../../../../common/protocol/organization/index.js";
import type { UserSummary } from "../../../../common/protocol/auth/index.js";

/**
 * Who may still be added to this node.
 *
 * Three rules, and none of them is about rendering. A pending or rejected
 * account is not a person who can be given work; somebody already in the node
 * cannot be added again; and the search is what the person typed.
 *
 * Capped because this feeds a suggestion list — a hundred matches is not a
 * better answer than six, it is the same answer with the useful part scrolled
 * off. The cap is here rather than in the markup so the two surfaces that will
 * eventually want this list agree on what "suggestions" means.
 */
export function addableAccounts(
  accounts: readonly UserSummary[],
  members: readonly { userId: string }[],
  query: string,
  limit = 6,
): UserSummary[] {
  const search = query.trim().toLowerCase();
  if (!search) return [];
  const already = new Set(members.map((member) => member.userId));
  return accounts
    .filter((account) => account.status === "active" && !already.has(account.id) && account.email.toLowerCase().includes(search))
    .slice(0, limit);
}

/** The one model this node chose for itself, if it chose one. */
export function chosenInferenceModel(
  snapshot: OrganizationSnapshot,
  organizationId: string,
): OrganizationInferenceModel | undefined {
  return snapshot.inferenceModels.find((model) => model.organizationId === organizationId);
}

/**
 * The model a node that chose nothing will actually run on, and whose it is.
 *
 * The server resolves this by walking ancestors nearest-first and stopping at
 * the first one with a model, so the walk is repeated here in that order — a
 * screen that showed the root's model where the parent had its own would be
 * telling somebody the wrong thing about the session they are about to start.
 *
 * Undefined means nothing is set anywhere up the chain, which is the deployment
 * default answering. Naming it is Models' business, not this screen's.
 *
 * The seen set guards a parent link that points back into its own chain: the
 * data should never contain one, and looping forever over a bad row is a worse
 * way to find that out than rendering nothing.
 */
export function inheritedInferenceModel(
  snapshot: OrganizationSnapshot,
  organizationId: string,
): { model: OrganizationInferenceModel; organizationName: string } | undefined {
  const seen = new Set<string>([organizationId]);
  let parentId = snapshot.organizations.find((one) => one.id === organizationId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const ancestor = snapshot.organizations.find((one) => one.id === parentId);
    if (!ancestor) return undefined;
    const model = chosenInferenceModel(snapshot, ancestor.id);
    if (model) return { model, organizationName: ancestor.name };
    parentId = ancestor.parentId;
  }
  return undefined;
}

/** The scope this account holds here, if any. What a toggle needs to know before it acts. */
export function heldResponsibility(
  snapshot: OrganizationSnapshot,
  organizationId: string,
  userId: string,
): "node" | "subtree" | undefined {
  return snapshot.responsibilities.find(
    (item) => item.organizationId === organizationId && item.userId === userId,
  )?.scope;
}

/** The accounts in this node, in the order the snapshot already sorted them. */
export function membersOf(snapshot: OrganizationSnapshot, organizationId: string) {
  return snapshot.members.filter((member) => member.organizationId === organizationId);
}
