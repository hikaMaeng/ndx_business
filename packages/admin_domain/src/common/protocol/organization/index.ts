export type Organization = { id: string; name: string; parentId: string | null; createdAt: string };
export type OrganizationMember = { organizationId: string; userId: string; email: string };
export type OrganizationResponsibility = { organizationId: string; userId: string; scope: "node" | "subtree"; email: string };
export type OrganizationSnapshot = { organizations: Organization[]; members: OrganizationMember[]; responsibilities: OrganizationResponsibility[] };
export type CreateOrganizationRequest = { name: string; parentId?: string | null };
export type AssignMemberRequest = { userId: string };
export type AssignResponsibleRequest = { userId: string; scope: "node" | "subtree" };
