export * from "./protocol/vibe/index.js";

/**
 * The part of a stored workspace path a person should see.
 *
 * A session records where the folder is — under the account that owns it — so
 * that links and the tool's working directory resolve from the projects root.
 * Nobody wants to read an account id, so the account half is dropped here, in
 * the contract, rather than by each screen deciding to slice a string.
 */
export function workspaceDisplayName(workspace: string): string {
  const separator = workspace.indexOf("/");
  return separator < 0 ? workspace : workspace.slice(separator + 1);
}
