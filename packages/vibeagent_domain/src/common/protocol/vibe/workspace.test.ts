import assert from "node:assert/strict";
import { test } from "node:test";
import { normaliseWorkspacePath } from "./workspace.js";

test("a plain folder name is accepted and returned cleaned", () => {
  assert.equal(normaliseWorkspacePath("calculator"), "calculator");
  assert.equal(normaliseWorkspacePath("  calculator  "), "calculator");
  assert.equal(normaliseWorkspacePath("./calculator/"), "calculator");
  assert.equal(normaliseWorkspacePath("team/calculator"), "team/calculator");
  assert.equal(normaliseWorkspacePath("v1.2_final-build"), "v1.2_final-build");
});

test("anything that could leave the projects root is refused", () => {
  for (const attempt of [
    "..",
    "../etc",
    "team/../../etc",
    "/etc/passwd",
    "C:/Windows",
    "team\\calculator",
    "./../x",
    ".hidden",
    "team/.ssh",
    "a/./b",
  ]) {
    assert.equal(normaliseWorkspacePath(attempt), null, `should refuse ${JSON.stringify(attempt)}`);
  }
});

test("empty, oversized and non-string proposals are refused", () => {
  assert.equal(normaliseWorkspacePath(""), null);
  assert.equal(normaliseWorkspacePath("   "), null);
  assert.equal(normaliseWorkspacePath("/"), null);
  assert.equal(normaliseWorkspacePath(null), null);
  assert.equal(normaliseWorkspacePath(42), null);
  assert.equal(normaliseWorkspacePath("a".repeat(201)), null);
  assert.equal(normaliseWorkspacePath("a/b/c/d/e/f/g/h/i"), null);
});

test("a name that is not plain ASCII is refused rather than transliterated", () => {
  // Refusing keeps the path the client proposed identical to the directory that
  // appears on disk, which is what makes the recorded fact trustworthy.
  assert.equal(normaliseWorkspacePath("계산기"), null);
  assert.equal(normaliseWorkspacePath("my project"), null);
  assert.equal(normaliseWorkspacePath("proj;rm -rf /"), null);
});
