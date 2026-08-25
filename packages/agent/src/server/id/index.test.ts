import assert from "node:assert/strict";
import test from "node:test";
import { deterministicEventId } from "./index.js";

test("a deterministic event id is stable per logical outcome and unique across outcomes", () => {
  assert.equal(deterministicEventId("result:tx-1"), deterministicEventId("result:tx-1"));
  assert.notEqual(deterministicEventId("result:tx-1"), deterministicEventId("result:tx-2"));
  assert.match(deterministicEventId("result:tx-1"), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
