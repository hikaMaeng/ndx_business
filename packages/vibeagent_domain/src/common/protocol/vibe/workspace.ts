/**
 * The working folder of a session.
 *
 * A session and a folder are separate things. Several sessions may work in one
 * folder, and the folder is never derived from the session id — deriving it
 * would make "which session" and "which project" the same question, which they
 * are not. It is chosen when the session opens and is immutable afterwards.
 *
 * The path is always relative to the deployment's projects root.
 */

/** Longest path a client may propose, and the deepest nesting under the root. */
const MAX_LENGTH = 200;
const MAX_DEPTH = 8;

/** A path segment: no leading dot, so a proposal cannot create hidden folders. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Rejects anything that could leave the projects root.
 *
 * This is untrusted input on its way to becoming a filesystem location, so it
 * is refused rather than repaired: absolute paths, drive letters, backslashes,
 * control characters, `.` and `..` segments and anything outside a conservative
 * character set are all rejected outright. Normalising an attack into something
 * that merely looks safe is how these boundaries fail. The worker resolves the
 * result against the real root and checks containment again.
 *
 * Returns the cleaned relative path, or null if it is not usable.
 */
export function normaliseWorkspacePath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!trimmed || trimmed.length > MAX_LENGTH) return null;
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed) || trimmed.includes("\\")) return null;

  const segments = trimmed.split("/");
  if (segments.length > MAX_DEPTH) return null;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || !SEGMENT.test(segment)) return null;
  }
  return segments.join("/");
}

/** True when the value is already a usable workspace path. */
export function isWorkspacePath(value: unknown): value is string {
  return normaliseWorkspacePath(value) !== null;
}

