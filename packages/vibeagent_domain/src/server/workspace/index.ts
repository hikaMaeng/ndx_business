/**
 * The projects root and what lives under it.
 *
 * | file | holds |
 * | --- | --- |
 * | `paths.ts` | turning an untrusted relative path into a contained absolute one |
 * | `folders.ts` | creating a session's folder, and listing what a client may pick |
 */
export { resolveWorkspaceDirectory } from "./paths.js";
export { ensureWorkspaceDirectory, listWorkspaceFolders } from "./folders.js";
