import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const testedUrl = "http://127.0.0.1:18081/";
const out = path.resolve("test/20260813/agent-protocol-browser");
const screenshotDir = path.join(out, "screenshots");
await fs.mkdir(screenshotDir, { recursive: true });
const groups = {
  session: ["session.create.request", "session.delete.request", "session.get.request", "session.snapshot.response", "session.deleted.response", "session.cancel.request", "session.cancelled.response", "session.resume.request", "session.resumed.response"],
  turn: ["turn.start.request", "turn.input.append.request", "turn.stop.request", "turn.final.response", "turn.cancelled.response", "turn.failed.response"],
  iteration: ["iteration.start.request", "iteration.progress", "iteration.merge.request", "iteration.merged.response", "iteration.failed.response"],
  tool: ["tool.call.request", "tool.started", "tool.progress", "tool.stdout", "tool.stderr", "tool.completed", "tool.failed", "tool.cancel.request", "tool.cancelled"],
  hook: ["hook.invoke.request", "hook.started", "hook.completed", "hook.failed", "hook.skipped"],
  model: ["model.select.request", "model.change.request", "model.defaults.update.request", "model.selected.response", "model.defaults.updated.response"],
  state: ["kv.put.request", "kv.get.request", "kv.delete.request", "kv.persist.request", "kv.persisted.response", "compaction.start.request", "compaction.progress", "compaction.completed.response", "checkpoint.create.request", "checkpoint.created.response"],
  process: ["process.start.request", "process.started", "process.stdout", "process.stderr", "process.exit", "process.timeout", "process.cancel.request", "process.cancelled"],
  approval: ["approval.request", "approval.granted", "approval.rejected", "approval.expired"],
  artifact: ["artifact.register.request", "artifact.progress", "artifact.registered.response", "artifact.failed.response"],
};
const actions = Object.values(groups).flat();
const playwright = createRequire(path.join(process.env.HEADLESS_BROWSER_PLAYWRIGHT_ROOT, "package.json"))("playwright");
const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));
const checks = [];
const screenshots = [];
async function shot(name) { const file = path.join(screenshotDir, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file); }
async function waitForEvent(eventType) { await page.locator("strong").filter({ hasText: eventType }).last().waitFor({ state: "visible", timeout: 20000 }); }
try {
  await page.goto(testedUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("online").waitFor({ state: "visible" });
  checks.push({ name: "stream-online", status: "passed" });
  for (const [group, groupActions] of Object.entries(groups)) {
    for (const action of groupActions) {
      await page.getByLabel("Event type").selectOption(action);
      await page.getByLabel("Payload JSON").fill(JSON.stringify({ protocol: group, action, source: "protocol-browser-e2e", sessionKey: "session-browser-e2e", runKey: "run-browser-e2e", turnKey: "turn-browser-e2e" }, null, 2));
      await page.getByRole("button", { name: "Send to agent" }).click();
      await waitForEvent("session.accepted");
      await waitForEvent(`${action}.result`);
    }
    checks.push({ name: `${group}-protocol-actions`, status: "passed", count: groupActions.length, actions: groupActions });
    await shot(`protocol-${group}`);
  }
  await context.tracing.stop({ path: path.join(out, "trace.zip") });
  const report = { status: "passed", mode: "scenario", testedUrl, actionCount: actions.length, actions, checks, screenshots, consoleErrors, pageErrors, trace: path.join(out, "trace.zip") };
  await fs.writeFile(path.join(out, "actions.json"), JSON.stringify({ groups, actions }, null, 2));
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "report.md"), `# Agent protocol browser verification\n\n- status: passed\n- mode: scenario\n- testedUrl: ${testedUrl}\n- actionCount: ${actions.length}\n- consoleErrors: ${consoleErrors.length}\n- pageErrors: ${pageErrors.length}\n\n## Checks\n${checks.map((item) => `- ${item.name}: ${item.status}${item.count ? ` (${item.count})` : ""}`).join("\n")}\n\n## Screenshots\n${screenshots.map((file) => `- ${file}`).join("\n")}\n`);
  console.log(`agent-protocol-browser status=passed actionCount=${actions.length} report=${path.join(out, "report.md")}`);
} catch (error) {
  await context.tracing.stop({ path: path.join(out, "trace-failure.zip") }).catch(() => {});
  await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ status: "failed", checks, consoleErrors, pageErrors, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
