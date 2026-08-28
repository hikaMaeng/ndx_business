import assert from "node:assert/strict";
import test from "node:test";
import { startEventLogTail } from "../log-tail/index.js";
import { EventStreamHub } from "../../stream/hub.js";
import { MetricsRegistry } from "../../metrics/registry.js";
import type { EventEnvelope } from "../../../common/index.js";
import type { EventStore } from "../../event-store/store.js";

function event(channel: string, streamId: string, sequence: number): EventEnvelope {
  return {
    eventId: `${streamId}#${sequence}`, streamId, sequence: String(sequence), action: "test.action",
    transactionKey: `tx-${sequence}`, kind: "progress", channel, correlationId: "c", source: "worker",
    eventVersion: 1, createdAt: new Date().toISOString(), payload: {},
  };
}

/** A log the tail can read forward without consuming, which is the whole point. */
function fakeLog(rows: EventEnvelope[]) {
  const reads: Array<Record<string, string>> = [];
  const store = {
    async channelHighWaterByChannel(channels: string[]) {
      const grouped: Record<string, Record<string, string>> = {};
      for (const row of rows) {
        if (!channels.includes(row.channel)) continue;
        const streams = (grouped[row.channel] ??= {});
        if (!streams[row.streamId] || BigInt(row.sequence) > BigInt(streams[row.streamId])) streams[row.streamId] = row.sequence;
      }
      return grouped;
    },
    async channelHighWater(channels: string[]) {
      const high: Record<string, string> = {};
      for (const row of rows) {
        if (!channels.includes(row.channel)) continue;
        if (!high[row.streamId] || BigInt(row.sequence) > BigInt(high[row.streamId])) high[row.streamId] = row.sequence;
      }
      return high;
    },
    async replayChannels(channels: string[], positions: Record<string, string>, highWater: Record<string, string>, limit: number) {
      reads.push({ ...positions });
      const matched = rows.filter((row) => channels.includes(row.channel)
        && BigInt(row.sequence) > BigInt(positions[row.streamId] ?? "0")
        && BigInt(row.sequence) <= BigInt(highWater[row.streamId] ?? "0"));
      return { events: matched.slice(0, limit), complete: matched.length <= limit };
    },
  } as unknown as EventStore;
  return { store, reads, rows };
}

async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a newly watched channel starts at now, so history is not replayed into the hub", async () => {
  const log = fakeLog([event("vibe.a", "session:a", 1), event("vibe.a", "session:a", 2)]);
  const hub = new EventStreamHub();
  const seen: EventEnvelope[] = [];
  const tail = startEventLogTail({ eventStore: log.store, hub, metrics: new MetricsRegistry(), pollMs: 5, batchSize: 10 });
  hub.watchChannels(() => tail.wake());
  hub.subscribe(["vibe.a"], (received) => seen.push(received));
  await settle();
  tail.stop(); await tail.done;

  // The connection replays its own past through its cursor; doing it here too
  // would only duplicate what the socket already sent.
  assert.deepEqual(seen, []);
});

test("events appended after the tail starts reach the hub exactly once", async () => {
  const log = fakeLog([event("vibe.a", "session:a", 1)]);
  const hub = new EventStreamHub();
  const seen: EventEnvelope[] = [];
  const tail = startEventLogTail({ eventStore: log.store, hub, metrics: new MetricsRegistry(), pollMs: 5, batchSize: 10 });
  hub.watchChannels(() => tail.wake());
  hub.subscribe(["vibe.a"], (received) => seen.push(received));
  await settle();

  log.rows.push(event("vibe.a", "session:a", 2), event("vibe.a", "session:a", 3));
  tail.wake("vibe.a");
  await settle();
  tail.stop(); await tail.done;

  assert.deepEqual(seen.map((received) => received.sequence), ["2", "3"]);
});

test("an unsubscribed channel is dropped and its rows stop being read", async () => {
  const log = fakeLog([event("vibe.a", "session:a", 1)]);
  const hub = new EventStreamHub();
  const seen: EventEnvelope[] = [];
  const tail = startEventLogTail({ eventStore: log.store, hub, metrics: new MetricsRegistry(), pollMs: 5, batchSize: 10 });
  hub.watchChannels(() => tail.wake());
  const stop = hub.subscribe(["vibe.a"], (received) => seen.push(received));
  await settle();
  stop();
  await settle();

  log.rows.push(event("vibe.a", "session:a", 2));
  tail.wake("vibe.a");
  await settle();
  tail.stop(); await tail.done;

  assert.deepEqual(seen, []);
});

test("a wake for a channel this broker has no socket on does nothing", async () => {
  const log = fakeLog([event("vibe.b", "session:b", 1)]);
  const hub = new EventStreamHub();
  const tail = startEventLogTail({ eventStore: log.store, hub, metrics: new MetricsRegistry(), pollMs: 60_000, batchSize: 10 });
  await settle(2);
  const before = log.reads.length;
  tail.wake("vibe.b");
  await settle(2);
  tail.stop(); await tail.done;

  // Every broker sees every notification; only the ones holding a matching
  // socket may turn it into a query.
  assert.equal(log.reads.length, before);
});

test("two independent tails both see the same event, because reading consumes nothing", async () => {
  const log = fakeLog([event("vibe.a", "session:a", 1)]);
  const hubs = [new EventStreamHub(), new EventStreamHub()];
  const seen: EventEnvelope[][] = [[], []];
  const tails = hubs.map((hub, index) => {
    const tail = startEventLogTail({ eventStore: log.store, hub, metrics: new MetricsRegistry(), pollMs: 5, batchSize: 10 });
    hub.watchChannels(() => tail.wake());
    hub.subscribe(["vibe.a"], (received) => seen[index]!.push(received));
    return tail;
  });
  await settle();

  log.rows.push(event("vibe.a", "session:a", 2));
  await settle();
  for (const tail of tails) { tail.stop(); await tail.done; }

  assert.deepEqual(seen[0]!.map((received) => received.sequence), ["2"]);
  assert.deepEqual(seen[1]!.map((received) => received.sequence), ["2"]);
});
