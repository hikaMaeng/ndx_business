import { Pool } from "pg";
import type { EventEnvelope, IngressEvent } from "../../common/index.js";
import type { EventQueueMessage, EventQueueTransport } from "../queue/transport.js";

interface PgmqMessage<TEvent extends IngressEvent | EventEnvelope> {
  msg_id: string | number;
  message: TEvent;
  headers: Record<string, unknown> | null;
  read_ct: number | null;
}

export class PgmqClient implements EventQueueTransport {
  private readonly pendingSends = new Map<string, Array<{ message: IngressEvent | EventEnvelope; resolve: (id: string) => void; reject: (error: unknown) => void }>>();
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly pool: Pool) {}

  async check(): Promise<void> { await this.pool.query("SELECT 1"); }

  send(queue: string, message: IngressEvent | EventEnvelope): Promise<string> {
    return new Promise((resolve, reject) => {
      const batch = this.pendingSends.get(queue) ?? [];
      batch.push({ message, resolve, reject });
      this.pendingSends.set(queue, batch);
      if (batch.length >= 128) void this.flush(queue);
      // A short window lets concurrent HTTP/WebSocket arrivals share one
      // durable PGMQ transaction. It bounds single-message acknowledgement
      // latency while avoiding a queue-locking transaction per request.
      else if (!this.flushTimers.has(queue)) this.flushTimers.set(queue, setTimeout(() => { void this.flush(queue); }, 10));
    });
  }

  private async flush(queue: string): Promise<void> {
    const timer = this.flushTimers.get(queue);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(queue);
    const batch = this.pendingSends.get(queue);
    if (!batch?.length) return;
    this.pendingSends.delete(queue);
    try {
      const result = await this.pool.query<{ id: string | number }>("SELECT pgmq.send_batch($1::text, ARRAY(SELECT value FROM jsonb_array_elements($2::jsonb))) AS id", [queue, JSON.stringify(batch.map(({ message }) => message))]);
      if (result.rows.length !== batch.length) throw new Error(`PGMQ send_batch returned ${result.rows.length} ids for ${batch.length} messages`);
      batch.forEach((entry, index) => entry.resolve(String(result.rows[index].id)));
    } catch (error) { batch.forEach((entry) => entry.reject(error)); }
    if (this.pendingSends.has(queue)) void this.flush(queue);
  }

  async read(queue: string, options: { visibilityTimeoutSeconds: number; quantity: number; pollSeconds: number }): Promise<EventQueueMessage[]> {
    const result = await this.pool.query<PgmqMessage<IngressEvent | EventEnvelope>>("SELECT * FROM pgmq.read_with_poll($1, $2, $3, $4, 100)", [queue, options.visibilityTimeoutSeconds, options.quantity, options.pollSeconds]);
    return result.rows.map((row) => ({ id: String(row.msg_id), event: row.message, headers: row.headers, readCount: Number(row.read_ct ?? 1) }));
  }

  async delete(queue: string, id: string): Promise<void> {
    await this.pool.query("SELECT pgmq.delete($1::text, $2::bigint)", [queue, id]);
  }

  async extendVisibility(queue: string, id: string, seconds: number): Promise<void> {
    await this.pool.query("SELECT pgmq.set_vt($1::text, $2::bigint, $3::integer)", [queue, id, seconds]);
  }

  async archive(queue: string, id: string): Promise<void> {
    await this.pool.query("SELECT pgmq.archive($1::text, $2::bigint)", [queue, id]);
  }

  async ensure(queue: string): Promise<void> {
    try { await this.pool.query("SELECT pgmq.create($1::text)", [queue]); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("already exists")) throw error;
    }
  }

}
