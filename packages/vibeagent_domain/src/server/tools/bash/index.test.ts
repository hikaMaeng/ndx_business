import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runBash } from "./index.js";

const workspace = (): string => mkdtempSync(path.join(tmpdir(), "vibe-bash-"));
const base = { timeoutMs: 15_000, maxOutputBytes: 10_000 };

test("bash runs in its own process and reports stdout with a zero exit code", async () => {
  const result = await runBash("echo hello-from-bash", { ...base, workspace: workspace() });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello-from-bash/);
  assert.equal(result.timedOut, false);
});

test("a failing command surfaces its exit code instead of throwing", async () => {
  const result = await runBash("echo to-stderr >&2; exit 3", { ...base, workspace: workspace() });
  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /to-stderr/);
});

test("the command writes into the workspace it was given", async () => {
  const dir = workspace();
  const result = await runBash("printf 'body' > made.txt", { ...base, workspace: dir });
  assert.equal(result.exitCode, 0);
  assert.equal(readFileSync(path.join(dir, "made.txt"), "utf8"), "body");
});

test("a command past its budget is killed and flagged rather than left running", async () => {
  const result = await runBash("sleep 30", { ...base, workspace: workspace(), timeoutMs: 700 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test("output is bounded so one noisy command cannot exhaust the worker", async () => {
  const result = await runBash("for i in $(seq 1 5000); do echo 0123456789; done", { ...base, workspace: workspace(), maxOutputBytes: 2_000 });
  assert.ok(result.stdout.length <= 2_000, `stdout was ${result.stdout.length} bytes`);
});
