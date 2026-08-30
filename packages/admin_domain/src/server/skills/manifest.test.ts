import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseFrontmatter, readBundleManifest } from "./index.js";

function useDirectory(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "skill-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("a real skill's header, read as it is written", () => {
  // Verbatim from anthropics/skills — the shape this has to survive is the one
  // skills in the wild actually use, not the one a fixture would be tidy about.
  const fields = parseFrontmatter([
    "---",
    "name: mcp-builder",
    "description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK).",
    "license: Complete terms in LICENSE.txt",
    "---",
    "",
    "# MCP Builder",
  ].join("\n"));

  assert.equal(fields.name, "mcp-builder");
  assert.match(fields.description, /^Guide for creating high-quality MCP/);
  assert.match(fields.description, /MCP SDK\)\.$/, "the whole sentence, not the first clause");
  assert.equal(fields.license, "Complete terms in LICENSE.txt");
});

test("a quoted description keeps its colons and loses its quotes", () => {
  // The docx skill's description is quoted because it contains a colon, which
  // is also the character that separates a key from its value.
  const fields = parseFrontmatter([
    "---",
    "name: docx",
    `description: "Use this skill for Word documents. Triggers include: any mention of 'Word doc'."`,
    "---",
  ].join("\n"));

  assert.equal(fields.description, "Use this skill for Word documents. Triggers include: any mention of 'Word doc'.");
});

test("a wrapped value is joined back together", () => {
  // A description split across lines is still one description. Keeping only the
  // first line would put half a sentence in front of every session.
  const fields = parseFrontmatter([
    "---",
    "name: wrapped",
    "description: The first part of a sentence",
    "  and the rest of it,",
    "  and the end.",
    "license: MIT",
    "---",
  ].join("\n"));

  assert.equal(fields.description, "The first part of a sentence and the rest of it, and the end.");
  assert.equal(fields.license, "MIT", "and the next key is still a key");
});

test("no frontmatter is no fields, not a guess", () => {
  assert.deepEqual(parseFrontmatter("# Just a heading\n\nSome text.\n"), {});
  assert.deepEqual(parseFrontmatter(""), {});
  // A `---` further down the file is a horizontal rule, not a header.
  assert.deepEqual(parseFrontmatter("# Title\n\n---\nname: nope\n---\n"), {});
});

test("CRLF headers read the same as LF ones", () => {
  const fields = parseFrontmatter("---\r\nname: windows\r\ndescription: written on a windows machine\r\n---\r\n\r\n# Title\r\n");
  assert.equal(fields.name, "windows");
  assert.equal(fields.description, "written on a windows machine");
});

test("the manifest comes from the bundle, or is empty", async (t) => {
  const root = useDirectory(t);
  assert.deepEqual(await readBundleManifest(root), {}, "no SKILL.md is no claim");

  writeFileSync(path.join(root, "SKILL.md"), "# No header\n\nJust prose.\n");
  assert.deepEqual(await readBundleManifest(root), {}, "and neither is a SKILL.md without one");

  writeFileSync(path.join(root, "SKILL.md"), "---\nname: pdf\ndescription: everything to do with PDF files\n---\n");
  assert.deepEqual(await readBundleManifest(root), { name: "pdf", description: "everything to do with PDF files" });

  // An empty description is not a description. Taking it would blank the row,
  // and a blank description drops the skill out of the session index entirely.
  writeFileSync(path.join(root, "SKILL.md"), "---\nname: pdf\ndescription:   \n---\n");
  assert.deepEqual(await readBundleManifest(root), { name: "pdf" });
});
