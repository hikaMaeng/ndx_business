export type OrganizationRequestApi = (
  path: string,
  options?: RequestInit,
  token?: string,
) => Promise<unknown>;
