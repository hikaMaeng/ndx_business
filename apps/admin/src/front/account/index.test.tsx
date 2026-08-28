import assert from "node:assert/strict";
import test from "node:test";
import { installDom } from "../testing/dom.js";

installDom();

const { act } = await import("react");
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { AccountScreen } = await import("./index.js");

/** Past this many attempts the retry storm is proven. */
const RUNAWAY = 25;

/**
 * The screen guards its load with `status !== "idle"`, so the happy path was
 * never the risk. Its failure branch is: it puts the status back to `idle` so a
 * later attempt can succeed. With anything rebuilt-per-render in the effect's
 * dependencies, that reset re-fires the effect immediately and a single failed
 * request becomes an unbounded retry loop against a server that is already
 * having a bad time.
 *
 * So this mounts it against a server that always refuses, and counts.
 */
test("a failed load is not retried in a loop", async (t) => {
  const attempts: string[] = [];
  const request = async (path: string): Promise<unknown> => {
    attempts.push(path);
    // Stop answering once the point is made, or the loop feeds itself faster
    // than the test can reach its assertion and the run hangs instead of failing.
    if (attempts.length > RUNAWAY) return new Promise(() => {});
    throw new Error("the settings service is unavailable");
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(() => { act(() => root.unmount()); container.remove(); });

  await act(async () => {
    root.render(<AccountScreen token={`retry-${Date.now()}`} request={request as never} />);
  });
  for (let turn = 0; turn < 30; turn += 1) {
    if (attempts.length > RUNAWAY) break;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  assert.ok(attempts.length >= 1, "the screen never tried to load its settings");
  assert.ok(
    attempts.length <= 2,
    `one failing request produced ${attempts.length} attempts.\n`
    + "The load effect is re-running after its own failure. Its dependency array must not\n"
    + "contain anything rebuilt on every render — read the translations through a ref.",
  );
});
