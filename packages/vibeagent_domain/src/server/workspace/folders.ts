import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { accountDirectory, projectPath, resolveWorkspaceDirectory } from "./paths.js";

/** How deep the picker looks. Deep enough to nest a project group, shallow enough to stay a list. */
const LIST_DEPTH = 2;

/** Creates the session's folder if it does not exist yet, and returns its absolute path. */
export async function ensureWorkspaceDirectory(root: string, relative: string): Promise<string> {
  const resolved = resolveWorkspaceDirectory(root, relative);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

/**
 * The same, for a project named by its owner.
 *
 * Takes the account separately from the name so the two can never be confused:
 * the account comes from the verified session and the name from the request,
 * and only this function decides how they combine into a path.
 */
export async function ensureProjectDirectory(root: string, userId: string, name: string): Promise<string> {
  return ensureWorkspaceDirectory(root, projectPath(userId, name));
}

/**
 * The folders a client may choose from when opening a session.
 *
 * One account's, and nobody else's. The walk starts at the account's own
 * directory rather than the projects root, so another account's work is not
 * filtered out of the answer — it was never in scope to begin with.
 *
 * Only directories, and only ones whose names the contract would accept — a
 * folder created outside this system with a name we would refuse is not
 * offered, because offering it would produce a session that cannot be opened.
 */
export async function listWorkspaceFolders(root: string, userId: string): Promise<string[]> {
  const base = accountDirectory(root, userId);
  const found: string[] = [];

  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      try { resolveWorkspaceDirectory(base, relative); } catch { continue; }
      found.push(relative);
      if (depth < LIST_DEPTH) await walk(path.join(directory, entry.name), relative, depth + 1);
    }
  };

  await walk(base, "", 1);
  return found.sort((left, right) => left.localeCompare(right));
}
