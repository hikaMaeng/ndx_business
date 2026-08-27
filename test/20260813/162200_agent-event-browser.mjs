import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const out = path.resolve("test/20260813/162200_agent-event-browser");
const screenshotDir = path.join(out, "screenshots");
await fs.mkdir(screenshotDir, { recursive: true });
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
async function check(name, action) { await action(); checks.push({ name, status: "passed" }); }
async function shot(name) { const file = path.join(screenshotDir, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); screenshots.push(file); }
try {
  await page.goto("http://127.0.0.1:18081/", { waitUntil: "domcontentloaded" });
  await page.getByText("online").waitFor({ state: "visible" });
  await check("stream-online", async () => {});
  await page.getByLabel("Payload JSON").fill('{"prompt":"Inspect repository","modelKey":"coding-default","context":"browser-e2e"}');
  await page.getByLabel("Event type").selectOption("turn.start.request");
  await page.getByRole("button", { name: "Simulate locally" }).click();
  await page.locator("strong").filter({ hasText: "iteration.start.request" }).waitFor({ state: "visible" });
  await page.locator("strong").filter({ hasText: "tool.call.request" }).waitFor({ state: "visible" });
  await page.locator("strong").filter({ hasText: "turn.final.response" }).waitFor({ state: "visible" });
  await check("local-coding-agent-flow", async () => {});
  await shot("local-coding-agent-flow");
  await page.locator('input[data-channel="orders"]').check();
  await page.getByRole("button", { name: "Load sample flow" }).click();
  await page.getByText("order.created.received").waitFor({ state: "visible" });
  await check("multi-channel-subscription", async () => {});
  await shot("multi-channel-subscription");
  await page.locator('input[data-channel="telemetry"]').check();
  await page.getByRole("button", { name: "Load sample flow" }).click();
  await page.getByText("telemetry.sample.received").waitFor({ state: "visible" });
  await check("sample-event-flow", async () => {});
  await shot("sample-event-flow");
  await page.getByLabel("Payload JSON").fill('{"prompt":"Run browser worker check","modelKey":"coding-default","context":"browser-e2e"}');
  await page.getByLabel("Event type").selectOption("tool.call.request");
  await page.getByRole("button", { name: "Send to agent" }).click();
  await page.locator("strong").filter({ hasText: "tool.call.request.result" }).waitFor({ state: "visible", timeout: 15000 });
  await check("server-worker-result", async () => {});
  await shot("server-worker-result");
  await context.tracing.stop({ path: path.join(out, "trace.zip") });
  const report = { status: "passed", mode: "scenario", testedUrl: "http://127.0.0.1:18081/", finalUrl: page.url(), checks, screenshots, consoleErrors, pageErrors, trace: path.join(out, "trace.zip") };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "report.md"), `# Agent event browser verification\n\n- status: passed\n- mode: scenario\n- testedUrl: ${report.testedUrl}\n- consoleErrors: ${consoleErrors.length}\n- pageErrors: ${pageErrors.length}\n\n## Checks\n${checks.map((item) => `- ${item.name}: ${item.status}`).join("\n")}\n\n## Screenshots\n${screenshots.map((file) => `- ${file}`).join("\n")}\n`);
  console.log(`agent-event-browser status=passed report=${path.join(out, "report.md")}`);
} catch (error) {
  await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ status: "failed", checks, consoleErrors, pageErrors, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
