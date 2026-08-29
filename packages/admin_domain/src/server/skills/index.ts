import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromBuffer as openZip, type Entry, type ZipFile } from "yauzl";

/**
 * Where a skill's files live, and what may be done to them.
 *
 * A skill is not a record. It is `SKILL.md` and whatever it needs beside it —
 * references, scripts, assets — and it can be large. The policy row points at
 * one of these; this is the folder it points at.
 *
 * Uploaded as a zip, browsed and edited afterwards. Every one of those three is
 * a way to write a path, which is why path safety is a single function used by
 * all of them rather than a check each remembers to make.
 */

/** Enough for a real skill, small enough that a mistake is not a disk. */
export const BUNDLE_LIMITS = {
  totalBytes: 8 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  files: 500,
  /** Beyond this a path is not a skill layout, it is an attempt at something. */
  depth: 8,
} as const;

/** Extensions a person may edit in a browser. Anything else is shown but not opened. */
const TEXT_EXTENSIONS = new Set([
  ".md", ".txt", ".sh", ".bash", ".mjs", ".cjs", ".js", ".ts", ".json", ".yaml", ".yml",
  ".toml", ".ini", ".env", ".py", ".rb", ".sql", ".csv", ".xml", ".html", ".css", ".gitignore",
]);

export interface BundleFile {
  /** Relative to the bundle root, always with forward slashes. */
  path: string;
  bytes: number;
  /** Whether the browser may open it in an editor. */
  editable: boolean;
}

/**
 * Turns a requested path into a real one, or refuses.
 *
 * The whole of the defence, in one place. A zip entry names its own path and an
 * editor request names one too, so both arrive from outside; `..`, an absolute
 * path, a drive letter or a backslash are all ways of leaving the folder, and
 * `path.resolve` collapses them into something that either is or is not inside
 * the root. Checking the resolved answer rather than the requested string is
 * what makes the list of tricks not need to be complete.
 */
export function resolveInBundle(root: string, requested: string): string {
  const cleaned = requested.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.split("/").length > BUNDLE_LIMITS.depth) {
    throw new Error(`path is not usable: ${JSON.stringify(requested)}`);
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, cleaned);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes the skill: ${JSON.stringify(requested)}`);
  }
  return resolved;
}

export function isEditable(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  const extension = path.extname(name);
  // A dotfile with no extension — `.gitignore`, `.npmrc` — is text people edit.
  return TEXT_EXTENSIONS.has(extension) || (name.startsWith(".") && !extension);
}

/** Every file in a bundle, deepest paths included, sorted so a tree renders in order. */
export async function listBundle(root: string): Promise<BundleFile[]> {
  const found: BundleFile[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { await walk(path.join(directory, entry.name), relative); continue; }
      if (!entry.isFile()) continue;
      const info = await stat(path.join(directory, entry.name));
      found.push({ path: relative, bytes: info.size, editable: isEditable(relative) });
    }
  };
  await walk(path.resolve(root), "");
  // Root files first, then nested, alphabetically inside each. SKILL.md is the
  // one a person opens, and a listing that buries it under folders is one
  // nobody scans.
  const depth = (file: BundleFile): number => file.path.split("/").length;
  return found.sort((left, right) => depth(left) - depth(right) || left.path.localeCompare(right.path));
}

export async function readBundleFile(root: string, requested: string): Promise<string> {
  const target = resolveInBundle(root, requested);
  if (!isEditable(target)) throw new Error("that file is not text");
  const info = await stat(target);
  if (info.size > BUNDLE_LIMITS.fileBytes) throw new Error("that file is too large to edit");
  return readFile(target, "utf8");
}

export async function writeBundleFile(root: string, requested: string, content: string): Promise<void> {
  const target = resolveInBundle(root, requested);
  if (!isEditable(target)) throw new Error("that file is not text");
  if (Buffer.byteLength(content, "utf8") > BUNDLE_LIMITS.fileBytes) throw new Error("that file is too large");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function deleteBundle(root: string): Promise<void> {
  await rm(path.resolve(root), { recursive: true, force: true });
}

/**
 * Unpacks an upload into a bundle folder, replacing whatever was there.
 *
 * Replacing rather than merging: a second upload is a new version of the skill,
 * and leaving the previous version's files behind would produce a bundle that
 * matches neither zip and that nobody can reason about.
 *
 * Everything the archive claims is checked rather than trusted. A zip entry
 * carries its own path and its own sizes, all written by whoever made the file.
 */
export async function extractBundle(root: string, archive: Buffer): Promise<BundleFile[]> {
  const base = path.resolve(root);
  await rm(base, { recursive: true, force: true });
  await mkdir(base, { recursive: true });

  const zip = await new Promise<ZipFile>((resolve, reject) => {
    openZip(archive, { lazyEntries: true }, (error, file) => {
      if (error || !file) reject(error ?? new Error("could not read the archive"));
      else resolve(file);
    });
  });

  let files = 0;
  let total = 0;

  await new Promise<void>((resolve, reject) => {
    zip.on("error", reject);
    zip.on("end", resolve);
    zip.on("entry", (entry: Entry) => {
      const name = entry.fileName.replace(/\\/g, "/");

      // Directories carry no data; the files inside them make them.
      if (name.endsWith("/")) { zip.readEntry(); return; }
      // A zip may name anything at all, including a path with `..` in it or an
      // absolute one. This is where that stops.
      let target: string;
      try { target = resolveInBundle(base, name); }
      catch (error) { reject(error); return; }

      files += 1;
      if (files > BUNDLE_LIMITS.files) { reject(new Error("the archive has too many files")); return; }
      if (entry.uncompressedSize > BUNDLE_LIMITS.fileBytes) { reject(new Error(`${name} is too large`)); return; }
      total += entry.uncompressedSize;
      // Checked against the declared size before inflating, so a bomb is
      // refused rather than written.
      if (total > BUNDLE_LIMITS.totalBytes) { reject(new Error("the archive is too large")); return; }

      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { reject(error ?? new Error(`could not read ${name}`)); return; }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => {
          void mkdir(path.dirname(target), { recursive: true })
            .then(() => writeFile(target, Buffer.concat(chunks)))
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });
    });
    zip.readEntry();
  });

  return listBundle(base);
}

/**
 * Where one skill's files sit, given who owns it.
 *
 * Layered like the policy that names them, because two layers may define the
 * same skill name and the merge decides which one a session sees. Without the
 * scope in the path the nearer one would overwrite the further one's files.
 */
export function bundleRoot(
  skillsRoot: string,
  scope: { organizationId?: string | null; ownerId?: string | null; projectId?: string | null },
  name: string,
): string {
  const safe = (value: string): string => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`not usable as a folder: ${JSON.stringify(value)}`);
    return value;
  };
  const layer = scope.organizationId
    ? ["org", safe(scope.organizationId)]
    : scope.projectId
      ? ["project", safe(scope.projectId)]
      : ["account", safe(scope.ownerId ?? "")];
  return path.join(path.resolve(skillsRoot), ...layer, safe(name));
}
