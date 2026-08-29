import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BUNDLE_LIMITS, bundleRoot, extractBundle, isEditable, listBundle,
  readBundleFile, resolveInBundle, writeBundleFile,
} from "./index.js";

function useDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "skill-bundle-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * A zip, built by hand.
 *
 * Written here rather than fixtured because every interesting case is a zip
 * that no archiver would produce — a path with `..` in it, an absolute path, a
 * declared size that lies. The point is to hand the extractor exactly those.
 */
function makeZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const deflated = deflateRawSync(raw);
    let crc = ~0;
    for (const byte of raw) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    crc = ~crc >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + deflated.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

test("an ordinary bundle unpacks", async (t) => {
  const root = useDirectory(t);
  const files = await extractBundle(root, makeZip([
    { name: "SKILL.md", content: "# Deploy\n\nHow this repository ships.\n" },
    { name: "scripts/check.mjs", content: "console.log('ok');\n" },
    { name: "references/notes.md", content: "detail\n" },
  ]));

  assert.deepEqual(files.map((file) => file.path), ["SKILL.md", "references/notes.md", "scripts/check.mjs"], "root files first, then nested");
  assert.equal(readFileSync(path.join(root, "scripts/check.mjs"), "utf8"), "console.log('ok');\n");
  assert.ok(files.every((file) => file.editable), "md and mjs are text a person may edit");
});

test("an entry that climbs out of the bundle is refused", async (t) => {
  const root = useDirectory(t);
  const outside = path.join(root, "..", "escaped.txt");

  // The classic: a zip whose entry names its way into a sibling directory.
  await assert.rejects(
    () => extractBundle(root, makeZip([{ name: "../escaped.txt", content: "owned" }])),
    /escapes the skill|not usable|invalid relative path|absolute path/,
  );
  assert.equal(existsSync(outside), false, "and nothing was written on the way to refusing");
});

test("a deeper climb, and a Windows one, are refused too", async (t) => {
  const root = useDirectory(t);
  // Two layers refuse these, and both are wanted: yauzl rejects a climbing or
  // absolute entry name before this code sees it, and `resolveInBundle` catches
  // whatever a different reader might one day let through.
  for (const name of ["a/../../out.txt", "..\\..\\out.txt", "/etc/passwd", "C:/Windows/out.txt"]) {
    await assert.rejects(
      () => extractBundle(root, makeZip([{ name, content: "x" }])),
      /escapes the skill|not usable|invalid relative path|absolute path/,
      `${name} should be refused`,
    );
  }
});

test("an absurdly deep path is refused before it is a directory tree", async (t) => {
  const root = useDirectory(t);
  const deep = Array.from({ length: BUNDLE_LIMITS.depth + 2 }, (_, index) => `d${index}`).join("/");
  await assert.rejects(() => extractBundle(root, makeZip([{ name: `${deep}/f.md`, content: "x" }])), /not usable/);
});

test("a bundle bigger than the limit is refused rather than written", async (t) => {
  const root = useDirectory(t);
  const big = "x".repeat(BUNDLE_LIMITS.fileBytes + 1);
  await assert.rejects(() => extractBundle(root, makeZip([{ name: "big.md", content: big }])), /too large/);
});

test("too many files is refused", async (t) => {
  const root = useDirectory(t);
  const many = Array.from({ length: BUNDLE_LIMITS.files + 1 }, (_, index) => ({ name: `f${index}.md`, content: "x" }));
  await assert.rejects(() => extractBundle(root, makeZip(many)), /too many files/);
});

test("uploading again replaces rather than merges", async (t) => {
  const root = useDirectory(t);
  await extractBundle(root, makeZip([{ name: "SKILL.md", content: "one" }, { name: "old.md", content: "gone" }]));
  const after = await extractBundle(root, makeZip([{ name: "SKILL.md", content: "two" }]));

  // A second upload is a new version. Leaving the first version's files behind
  // would make a bundle that matches neither archive.
  assert.deepEqual(after.map((file) => file.path), ["SKILL.md"]);
  assert.equal(existsSync(path.join(root, "old.md")), false);
});

test("only text is opened for editing", async (t) => {
  const root = useDirectory(t);
  await extractBundle(root, makeZip([
    { name: "SKILL.md", content: "# skill\n" },
    { name: "scripts/run.sh", content: "echo hi\n" },
    { name: "assets/logo.png", content: "\u0089PNG\u0000binary" },
  ]));

  assert.equal(await readBundleFile(root, "SKILL.md"), "# skill\n");
  assert.equal(await readBundleFile(root, "scripts/run.sh"), "echo hi\n");
  await assert.rejects(() => readBundleFile(root, "assets/logo.png"), /not text/);

  const listed = await listBundle(root);
  assert.equal(listed.find((file) => file.path === "assets/logo.png")?.editable, false, "shown, but not opened");
});

test("an edit cannot write outside the bundle either", async (t) => {
  const root = useDirectory(t);
  await extractBundle(root, makeZip([{ name: "SKILL.md", content: "x" }]));

  // The browser sends a path too, so it is the same defence and not a second one.
  await assert.rejects(() => writeBundleFile(root, "../escaped.md", "owned"), /escapes the skill|not usable|invalid relative path|absolute path/);
  await assert.rejects(() => readBundleFile(root, "../../etc/passwd"), /escapes the skill|not usable|invalid relative path|absolute path/);
  assert.equal(existsSync(path.join(root, "..", "escaped.md")), false);
});

test("an edit lands, and a new file may be created inside", async (t) => {
  const root = useDirectory(t);
  await extractBundle(root, makeZip([{ name: "SKILL.md", content: "before" }]));

  await writeBundleFile(root, "SKILL.md", "after");
  assert.equal(await readBundleFile(root, "SKILL.md"), "after");

  await writeBundleFile(root, "scripts/new.mjs", "console.log(1);\n");
  assert.deepEqual((await listBundle(root)).map((file) => file.path), ["SKILL.md", "scripts/new.mjs"]);
});

test("a dotfile with no extension is text", () => {
  assert.equal(isEditable(".gitignore"), true);
  assert.equal(isEditable("a/.npmrc"), true);
  assert.equal(isEditable("logo.png"), false);
  assert.equal(isEditable("archive.tar.gz"), false);
});

test("the same skill name in two layers gets two folders", () => {
  const root = "/skills";
  const org = bundleRoot(root, { organizationId: "acme" }, "deploy");
  const account = bundleRoot(root, { ownerId: "u1" }, "deploy");
  const project = bundleRoot(root, { projectId: "p1" }, "deploy");

  // The merge decides which one a session sees. Without the layer in the path
  // the nearer one would overwrite the further one's files.
  assert.equal(new Set([org, account, project]).size, 3);
  assert.ok(org.includes(`${path.sep}org${path.sep}acme${path.sep}deploy`));
});

test("a name that is not usable as a folder is refused", () => {
  assert.throws(() => bundleRoot("/skills", { ownerId: "u1" }, "../escape"), /not usable/);
  assert.throws(() => bundleRoot("/skills", { ownerId: "u1" }, ""), /not usable/);
  assert.throws(() => bundleRoot("/skills", { ownerId: "../x" }, "deploy"), /not usable/);
});

test("resolveInBundle is the one place the rule lives", () => {
  const root = path.resolve("/skills/account/u1/deploy");
  assert.equal(resolveInBundle(root, "SKILL.md"), path.join(root, "SKILL.md"));
  assert.equal(resolveInBundle(root, "/SKILL.md"), path.join(root, "SKILL.md"), "a leading slash is not an escape");
  assert.equal(resolveInBundle(root, "a\\b.md"), path.join(root, "a", "b.md"), "backslashes are separators, not names");
  assert.throws(() => resolveInBundle(root, ".."), /escapes|not usable/);
});
