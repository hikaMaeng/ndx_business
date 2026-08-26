import path from "node:path";
import { normaliseWorkspacePath } from "../../common/index.js";

/**
 * Turning a client-supplied folder name into a real directory.
 *
 * The syntax check lives in the shared contract so the client can apply it too.
 * This is the half that cannot be shared: it resolves against the deployment's
 * actual root and re-checks containment. Two independent checks, because this
 * is the boundary where a bad path becomes a real write.
 */
export function resolveWorkspaceDirectory(root: string, relative: string): string {
  const cleaned = normaliseWorkspacePath(relative);
  if (!cleaned) throw new Error(`workspace path is not usable: ${JSON.stringify(relative)}`);

  const base = path.resolve(root);
  const resolved = path.resolve(base, cleaned);
  // Belt and braces: even if the syntax check were bypassed, a resolved path
  // outside the root never becomes a directory.
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`workspace path escapes the projects root: ${JSON.stringify(relative)}`);
  }
  return resolved;
}
