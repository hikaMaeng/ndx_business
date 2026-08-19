import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const out = path.resolve(process.env.BROWSER_OUT_DIR);
const root = process.env.HEADLESS_BROWSER_PLAYWRIGHT_ROOT ?? "C:/Users/hika0/AppData/Roaming/npm/node_modules/playwright";
await fs.mkdir(path.join(out, "screenshots"), { recursive: true });
const playwright = createRequire(path.join(root, "package.json"))("playwright");
const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const websockets = [];
const consoleErrors = [];
const pageErrors = [];
const steps = [];
page.on("websocket", (socket) => websockets.push(socket.url()));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.message));
const step = async (name, run) => { try { await run(); steps.push({ name, status: "passed" }); } catch (error) { steps.push({ name, status: "failed", error: String(error) }); throw error; } };
try {
  await step("goto", async () => { await page.goto("http://127.0.0.1:18081/", { waitUntil: "domcontentloaded" }); });
  await step("main-landmark", async () => { await page.getByRole("main").waitFor({ state: "visible", timeout: 10000 }); });
  await step("websocket-connected", async () => { await page.getByText("online").waitFor({ state: "visible", timeout: 10000 }); });
  await step("client-event-frame-sent", async () => {
    await page.getByLabel("Event type").selectOption("turn.start.request");
    await page.getByLabel("Payload JSON").fill(JSON.stringify({ prompt: "delivery invariant verification", simulateDelayMs: 120 }, null, 2));
    await page.getByRole("button", { name: "Send to agent" }).click();
  });
  await step("server-worker-result-frame-received", async () => {
    await page.locator("strong").filter({ hasText: "turn.start.request.result" }).waitFor({ state: "visible", timeout: 15000 });
  });
  const screenshot = path.join(out, "screenshots", "delivery-cps-flow.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  const report = { status: "passed", mode: "scenario", testedUrl: "http://127.0.0.1:18081/", websocketUrls: websockets, steps, consoleErrors, pageErrors, screenshot };
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`agent-delivery-browser status=passed dir=${out}`);
} catch (error) {
  await fs.writeFile(path.join(out, "failure.json"), JSON.stringify({ status: "failed", steps, websocketUrls: websockets, consoleErrors, pageErrors, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally { await browser.close(); }
