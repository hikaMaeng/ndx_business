import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Who the first commit is by. The account that made the project, so history starts attributed. */
export interface RepositoryIdentity { name: string; email: string }

const exists = async (target: string): Promise<boolean> => {
  try { await access(target); return true; } catch { return false; }
};

/**
 * Every project is a git repository from the moment it exists.
 *
 * Not a convenience. An agent writes files here on its own, sometimes many at
 * once and sometimes wrongly, and without a repository there is no way to see
 * what it changed or to put it back. `git init` at creation means the first
 * mistake is already recoverable; adding it afterwards means the history starts
 * at whatever state the mistake left behind.
 *
 * Idempotent, because creating a project is a request that can be retried: an
 * existing repository is left exactly as it is, and so is an existing
 * `.gitignore` — somebody may have edited it.
 *
 * The identity is written into the repository rather than relied on from the
 * environment. A container has no global git identity, so without this the
 * agent's first `git commit` fails with advice about running `git config`,
 * which is not something it should have to work out.
 */
export async function initialiseRepository(
  directory: string,
  input: { gitignore: string; identity: RepositoryIdentity },
): Promise<{ initialised: boolean; ignoreWritten: boolean }> {
  const git = (...args: string[]): Promise<unknown> =>
    run("git", ["-C", directory, ...args], { timeout: 30_000, windowsHide: true });

  const already = await exists(path.join(directory, ".git"));
  if (!already) {
    // The branch is named rather than inherited: `init.defaultBranch` is not set
    // in the image, and a repository whose branch depends on the host's git
    // configuration is a repository that differs between deployments.
    await run("git", ["init", "-b", "main", directory], { timeout: 30_000, windowsHide: true });
    await git("config", "user.name", input.identity.name);
    await git("config", "user.email", input.identity.email);
  }

  const ignorePath = path.join(directory, ".gitignore");
  const ignoreWritten = !(await exists(ignorePath));
  if (ignoreWritten) await writeFile(ignorePath, input.gitignore, "utf8");

  if (!already) {
    await git("add", ".gitignore");
    await git("commit", "-m", "Start the project", "--no-verify");
  }
  return { initialised: !already, ignoreWritten };
}
