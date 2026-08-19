import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const out = path.resolve("test/20260814-agent-websocket-browser");
await fs.mkdir(path.join(out, "screenshots"), { recursive: true });
const playwright = createRequire(path.join(process.env.HEADLESS_BROWSER_PLAYWRIGHT_ROOT, "package.json"))("playwright");
const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const websockets = [];
const consoleErrors = [];
const pageErrors = [];
page.on("websocket", (socket) => websockets.push(socket.url()));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));
try {
  await page.goto("http://127.0.0.1:18081/", { waitUntil: "domcontentloaded" });
  await page.getByText("online").waitFor({ state: "visible", timeout: 10000 });
  await page.getByLabel("Event type").selectOption("turn.start.request");
  await page.getByLabel("Payload JSON").fill(JSON.stringify({ prompt: "websocket cps verification", simulateDelayMs: 120 }, null, 2));
  await page.getByRole("button", { name: "Send to agent" }).click();
  await page.locator("strong").filter({ hasText: "turn.start.request.result" }).waitFor({ state: "visible", timeout: 15000 });
  const screenshot = path.join(out, "screenshots", "websocket-cps-flow.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const report = { status: "passed", mode: "scenario", testedUrl: "http://127.0.0.1:18081/", websocketUrls: websockets, checks: ["websocket-connected", "client-event-frame-sent", "server-worker-result-frame-received"], consoleErrors, pageErrors, screenshot };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(out, "report.md"), `# Agent WebSocket CPS browser verification\n\n- status: passed\n- testedUrl: ${report.testedUrl}\n- websocket: ${websockets.join(", ")}\n- consoleErrors: ${consoleErrors.length}\n- pageErrors: ${pageErrors.length}\n\n## Checks\n- websocket-connected: passed\n- client-event-frame-sent: passed\n- server-worker-result-frame-received: passed\n\n## Screenshot\n- ${screenshot}\n`);
  console.log(`agent-websocket-browser status=passed report=${path.join(out, "report.md")}`);
} catch (error) {
  await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ status: "failed", websocketUrls: websockets, consoleErrors, pageErrors, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
