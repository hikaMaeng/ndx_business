import type {
  OrganizationInferenceServiceOption,
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

/** The inference services this node has not attached yet. */
export function unattachedInferenceServices(
  snapshot: OrganizationSnapshot,
  organizationId: string,
): OrganizationInferenceServiceOption[] {
  const attached = new Set(
    snapshot.inferenceServices
      .filter((service) => service.organizationId === organizationId)
      .map((service) => service.endpointId),
  );
  return snapshot.inferenceServiceOptions.filter((option) => !attached.has(option.endpointId));
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
