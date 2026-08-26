import type { EventEnvelope, IngressEvent } from "../../common/index.js";
import { deterministicEventId } from "../../server/index.js";
import type { EventStore } from "../event-store/store.js";
import type { EventQueueTransport } from "../queue/transport.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import { CoalescedWakeup } from "./notifier.js";
import { nextReadBackoff, wait } from "./backoff.js";
import type { BrokerLoop } from "./log-tail.js";

/** action → the reactor queues that should receive it. Supplied by the app; meaningless to this file. */
export type ReactionTable = Readonly<Record<string, readonly string[]>>;

/**
 * The only thing that knows which reaction follows which fact.
 *
 * Workers never address each other. A worker records what happened and stops;
 * this reads the log and puts a copy of that fact on the queue of every reactor
 * the table names. Two reactors interested in one fact get their own copies on
 * their own queues, so it is fan-out, not competing consumption.
 *
 * It understands none of it. The table is a map from one opaque string to a
 * list of queue names, and this file never asks what any of them mean — the
 * same discipline that lets the broker carry a domain it has never heard of.
 *
 * Delivery is at-least-once by construction: the position is saved after the
 * sends, so a crash in between re-sends. That is why each dispatch carries an
 * identity derived from the fact and the queue — the duplicate is absorbed by
 * the reactor's claim rather than prevented here, which would need a
 * transaction spanning the queue and the cursor for no benefit.
 */
export function startFactDispatcher(input: {
  name: string;
  eventStore: EventStore;
  queue: EventQueueTransport;
  table: ReactionTable;
  metrics: MetricsRegistry;
  pollMs: number;
  batchSize: number;
}): BrokerLoop & { wake(action?: string): void } {
  const actions = Object.keys(input.table);
  const notifier = new CoalescedWakeup();
  let stopped = false;
  let positions: Record<string, string> | undefined;

  const wake = (action?: string): void => {
    // A fact nothing reacts to is not worth a query.
    if (action && action.length > 0 && !input.table[action]) return;
    notifier.notify();
  };

  /**
   * One reaction's identity.
   *
   * A fact carries the transaction of whoever recorded it, and reusing that
   * would make the reaction look like a repeat of work already completed —
   * the claim would refuse it. So each dispatch gets a key of its own, derived
   * from the fact and the queue: unique per reaction, identical on a redelivery,
   * and different for two reactors reacting to the same fact.
   *
   * It is marked for workers, so the record of the reaction itself never
   * reaches a client. Only what the reactor goes on to record does.
   */
  const work = (fact: EventEnvelope, queueName: string): IngressEvent => {
    const identity = deterministicEventId(`react:${queueName}:${fact.eventId}`);
    return {
      eventId: identity,
      transactionKey: identity,
      action: fact.action,
      channel: fact.channel,
      audience: "worker",
      ...(fact.replyChannel ? { replyChannel: fact.replyChannel } : {}),
      ...(fact.sessionId ? { sessionId: fact.sessionId } : {}),
      ...(fact.runId ? { runId: fact.runId } : {}),
      ...(fact.turnId ? { turnId: fact.turnId } : {}),
      correlationId: fact.correlationId,
      createdAt: new Date().toISOString(),
      payload: fact.payload,
    };
  };

  /**
   * Where to begin when there is no saved position.
   *
   * At the end, not the beginning. A dispatcher that started from zero would
   * answer every fact the log has ever held — every turn that already ran, every
   * command that already finished — and hand all of it out as new work. History
   * is not a backlog; it already happened. Only a saved position is resumed,
   * because that is the only kind that means "I had not got here yet".
   */
  const seed = async (): Promise<Record<string, string>> => {
    const saved = await input.eventStore.readerPosition(input.name);
    if (Object.keys(saved).length) return saved;
    const now = await input.eventStore.actionHighWater(actions);
    await input.eventStore.saveReaderPosition(input.name, now);
    console.log(JSON.stringify({ event: "broker.fact.dispatch.seeded", dispatcher: input.name, streams: Object.keys(now).length }));
    return now;
  };

  const drain = async (): Promise<boolean> => {
    if (!actions.length) return true;
    if (!positions) positions = await seed();

    const highWater = await input.eventStore.actionHighWater(actions);
    if (!Object.keys(highWater).length) return true;

    const batch = await input.eventStore.readActions(actions, positions, highWater, input.batchSize);
    input.metrics.increment("factDispatchReads");
    if (!batch.events.length) return batch.complete;

    const advanced = { ...positions };
    for (const fact of batch.events) {
      for (const queueName of input.table[fact.action] ?? []) {
        await input.queue.send(queueName, work(fact, queueName));
        input.metrics.increment("factDispatchSends");
      }
      advanced[fact.streamId] = fact.sequence;
    }

    // Saved only after the sends. Losing the save costs a repeat, which the
    // reactor's claim absorbs; saving first would cost a fact.
    await input.eventStore.saveReaderPosition(input.name, advanced);
    positions = advanced;
    return batch.complete;
  };

  const run = async (): Promise<void> => {
    let backoffMs = 100;
    while (!stopped) {
      try {
        const caughtUp = await drain();
        backoffMs = 100;
        if (caughtUp) await notifier.wait(input.pollMs);
      } catch (error) {
        input.metrics.increment("factDispatchFailures");
        console.error(JSON.stringify({ event: "broker.fact.dispatch.retry", dispatcher: input.name, backoffMs, error: error instanceof Error ? error.message : String(error) }));
        await wait(backoffMs);
        backoffMs = nextReadBackoff(backoffMs);
      }
    }
  };

  const done = run();
  return { stop: () => { stopped = true; notifier.notify(); }, done, wake };
}
