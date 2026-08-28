import assert from "node:assert/strict";
import test from "node:test";
import { installDom } from "../testing/dom.js";

installDom();

const { act } = await import("react");
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { AdminShell } = await import("./index.js");

/** Past this many identity calls the loop is proven; there is nothing to learn from more. */
const RUNAWAY = 25;

/**
 * Counts what the app asks the server for while it settles.
 *
 * The defect this guards against is not a wrong value on screen — the screen
 * looked correct the whole time it was happening. It is an effect that re-runs
 * after its own render, for ever. The only thing that shows it is the number of
 * requests, so requests are what this measures.
 *
 * Past `RUNAWAY` the stub stops answering. A runaway loop is fed by its own
 * resolved promises, so continuing to resolve them means the test never reaches
 * its assertion — it hangs for the runner's full timeout and reports nothing
 * useful. Starving it turns a hang into a failure that names the problem.
 */
function recordFetches(): { calls: string[]; identity: () => number; restore: () => void } {
  const calls: string[] = [];
  const previous = globalThis.fetch;
  const identity = (): number => calls.filter((url) => url.includes("/api/auth/me")).length;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input instanceof Request ? input.url : input));
    if (identity() > RUNAWAY) return new Promise<Response>(() => {});
    return new Response(
      JSON.stringify({ id: "u1", email: "someone@example.com", status: "active", isMasterAdmin: false }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  return { calls, identity, restore: () => { globalThis.fetch = previous; } };
}

/** Lets React finish: effects, the promises they start, and the renders those cause. */
async function settle(stop: () => boolean, turns = 40): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    if (stop()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function mount(t: { after: (fn: () => void) => void }) {
  const recorder = recordFetches();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  t.after(() => { recorder.restore(); act(() => root.unmount()); container.remove(); });
  return { recorder, root };
}

const runaway = (seen: number): string =>
  `expected the shell to resolve its user once, saw ${seen} calls to /api/auth/me.\n`
  + "An effect is re-running after its own render. Check that nothing rebuilt on every\n"
  + "render — the translations object from `texts()`, an inline callback prop — is in\n"
  + "its dependency array; read those through a ref instead.";

test("the shell asks who you are once, not once per render", async (t) => {
  const { recorder, root } = mount(t);

  // A stable callback, as `main.tsx` now passes. An inline arrow here would be
  // testing the caller's mistake rather than the shell's own contract.
  const onLogout = (): void => {};
  await act(async () => { root.render(<AdminShell token="test-token" onLogout={onLogout} />); });
  await settle(() => recorder.identity() > RUNAWAY);

  // A lower bound as well as an upper one: without it this would still pass if
  // the shell stopped asking altogether, which is the other way to a small number.
  assert.ok(recorder.identity() >= 1, "the shell never asked who the user is");
  assert.ok(recorder.identity() <= 2, runaway(recorder.identity()));
});

test("re-rendering the shell is not a reason to re-authenticate", async (t) => {
  const { recorder, root } = mount(t);

  // A *new* callback on every render, which is what an inline arrow in the
  // parent produces. The shell must not treat that as a reason to ask again.
  await act(async () => { root.render(<AdminShell token="test-token" onLogout={() => {}} />); });
  await settle(() => recorder.identity() > RUNAWAY, 10);
  const afterMount = recorder.identity();
  // Checked before the re-renders, because a mount that is already looping
  // makes the delta below small for the wrong reason — this test would then
  // pass on exactly the code it exists to catch.
  assert.ok(afterMount <= 2, runaway(afterMount));

  for (let render = 0; render < 5; render += 1) {
    if (recorder.identity() > RUNAWAY) break;
    await act(async () => { root.render(<AdminShell token="test-token" onLogout={() => {}} />); });
  }
  await settle(() => recorder.identity() > RUNAWAY, 10);

  assert.ok(
    recorder.identity() - afterMount <= 5,
    `five re-renders produced ${recorder.identity() - afterMount} extra identity calls.\n` + runaway(recorder.identity()),
  );
});
