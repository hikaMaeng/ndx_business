import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  /** How much of a file is read to decide whether it is text. */
  sniffBytes: 4096,
} as const;

/**
 * Extensions worth refusing without opening the file.
 *
 * A short list of things that are certainly not text, and nothing else. The
 * decision below is made by looking at the bytes, so this exists only to skip
 * the read for the obvious cases — not to enumerate what a skill may contain.
 */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff",
  ".pdf", ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".wav", ".mov", ".avi", ".webm", ".ogg",
  ".so", ".dll", ".dylib", ".exe", ".wasm", ".class", ".pyc", ".node",
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

/**
 * Whether a sample of bytes is text.
 *
 * Asked of the content rather than of the file name, because a skill decides
 * for itself what it is made of. A whitelist of extensions would have to know
 * about `.rs`, `.go`, `.lua`, `.tf`, `Makefile`, `Dockerfile` and whatever the
 * next skill brings, and every gap in it shows up as a file a person can see
 * but not open — which is exactly the file they need to fix.
 *
 * So the default is text, and only bytes that cannot be text say otherwise: a
 * NUL, or a sequence UTF-8 cannot decode. `stream: true` holds back a partial
 * character at the end of the sample rather than reporting the cut as damage.
 *
 * A UTF-16 or Latin-1 file is called binary here. That is the price of an
 * editor that reads and writes UTF-8 and nothing else, and calling such a file
 * editable would mean offering to save it back as something it is not.
 */
export function looksText(sample: Buffer): boolean {
  if (sample.includes(0)) return false;
  const decoded = new TextDecoder("utf8", { fatal: false }).decode(sample, { stream: true });
  return !decoded.includes("�");
}

/** The fast half of the question: extensions not worth opening. */
export function certainlyBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Whether an existing file may be opened in the editor. */
export async function isTextFile(absolute: string): Promise<boolean> {
  if (certainlyBinary(absolute)) return false;
  const handle = await open(absolute, "r").catch(() => null);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(BUNDLE_LIMITS.sniffBytes);
    const { bytesRead } = await handle.read(buffer, 0, BUNDLE_LIMITS.sniffBytes, 0);
    return looksText(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
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
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolute, relative); continue; }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      found.push({
        path: relative,
        bytes: info.size,
        editable: info.size <= BUNDLE_LIMITS.fileBytes && await isTextFile(absolute),
      });
    }
  };
  await walk(path.resolve(root), "");
  // SKILL.md first, then root files, then nested, alphabetically inside each.
  //
  // SKILL.md is pinned rather than left to the alphabet because it is the file
  // a person opens and the only one every skill has. Sorting by name alone put
  // it behind a Makefile, which is correct alphabetically and wrong for reading
  // — and the rule the sort exists to serve is the reading one.
  const rank = (file: BundleFile): number => (file.path === "SKILL.md" ? 0 : file.path.split("/").length);
  return found.sort((left, right) => rank(left) - rank(right) || left.path.localeCompare(right.path));
}

export async function readBundleFile(root: string, requested: string): Promise<string> {
  const target = resolveInBundle(root, requested);
  const info = await stat(target);
  if (info.size > BUNDLE_LIMITS.fileBytes) throw new Error("that file is too large to edit");
  if (!await isTextFile(target)) throw new Error("that file is not text");
  return readFile(target, "utf8");
}

export async function writeBundleFile(root: string, requested: string, content: string): Promise<void> {
  const target = resolveInBundle(root, requested);
  if (Buffer.byteLength(content, "utf8") > BUNDLE_LIMITS.fileBytes) throw new Error("that file is too large");
  // Judged on what is being written, not on what is already there: a new file
  // has no bytes yet, and an edit that would leave behind something the editor
  // cannot read back is the same mistake as opening a binary one.
  if (certainlyBinary(target) || !looksText(Buffer.from(content, "utf8"))) throw new Error("that file is not text");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

/**
 * What a skill says about itself.
 *
 * Real skills carry their name and description in `SKILL.md`'s frontmatter,
 * because that is the file that travels with them. Asking an admin to retype
 * the description into a row is asking for two copies of one sentence, and the
 * one in the row is the one that stops being true — it is not next to anything
 * that changes when the skill does.
 */
export interface BundleManifest {
  name?: string;
  description?: string;
}

/**
 * The leading `---` block of a markdown file, as key/value pairs.
 *
 * Deliberately small. This reads two fields out of a header that skills in the
 * wild write by hand; a YAML parser would accept structures this has no use for
 * and would have to be kept in step with a spec nobody here is reading. A key
 * whose value is not a plain scalar is skipped rather than guessed at.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return {};
  const fields: Record<string, string> = {};
  let key = "";
  for (const line of match[1].split(/\r?\n/)) {
    // A continuation: a wrapped value is indented under its key, and joining it
    // back is the difference between a description and its first clause.
    if (key && /^\s+\S/.test(line) && !/^\s*[A-Za-z0-9_-]+:/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) { key = ""; continue; }
    key = pair[1];
    let value = pair[2].trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
}

/** Reads a bundle's own account of itself, or nothing if it does not give one. */
export async function readBundleManifest(root: string): Promise<BundleManifest> {
  const target = path.join(path.resolve(root), "SKILL.md");
  const text = await readFile(target, "utf8").catch(() => "");
  if (!text) return {};
  const fields = parseFrontmatter(text);
  const manifest: BundleManifest = {};
  if (fields.name?.trim()) manifest.name = fields.name.trim();
  if (fields.description?.trim()) manifest.description = fields.description.trim();
  return manifest;
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
