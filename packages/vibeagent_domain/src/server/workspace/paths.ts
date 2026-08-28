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

/**
 * Every project lives under the account that made it.
 *
 * ```
 * /workspace/<userId>/<project>/
 * ```
 *
 * The client never names the account half. It asks for `myproject`, and the
 * account comes from the verified session — the broker stamps `userId` over
 * whatever the frame carried, so there is no string a client could send that
 * addresses somebody else's folder. That is isolation by construction rather
 * than a check that has to be remembered at every entry point.
 *
 * The account folder is the user id, not the email: it survives a change of
 * address and contains nothing a path has to escape.
 */
export function projectPath(userId: string, name: string): string {
  const account = normaliseWorkspacePath(userId);
  const project = normaliseWorkspacePath(name);
  if (!account || account.includes("/")) throw new Error(`account is not usable as a folder: ${JSON.stringify(userId)}`);
  if (!project) throw new Error(`project name is not usable: ${JSON.stringify(name)}`);
  return `${account}/${project}`;
}

/**
 * The name a client should see, given what is stored.
 *
 * Sessions record the root-relative path because everything downstream — the
 * tool's working directory, the artefact server — resolves from the root. The
 * account half is an implementation detail of where things live, so it is
 * stripped on the way out. Returns null when the path is not this account's,
 * which is the shape a caller should have to handle rather than a throw.
 */
export function projectName(userId: string, rootRelative: string): string | null {
  const prefix = `${userId}/`;
  return rootRelative.startsWith(prefix) ? rootRelative.slice(prefix.length) || null : null;
}

/** Where one account's projects live. Created on demand, like the projects themselves. */
export function accountDirectory(root: string, userId: string): string {
  const account = normaliseWorkspacePath(userId);
  if (!account || account.includes("/")) throw new Error(`account is not usable as a folder: ${JSON.stringify(userId)}`);
  return path.resolve(path.resolve(root), account);
}
