import { Pool } from "pg";
import type { EventEnvelope, IngressEvent } from "agent_domain/common";
import type { EventQueueMessage, EventQueueTransport } from "../queue/transport.js";

interface PgmqMessage {
  msg_id: string | number;
  message: IngressEvent;
  headers: Record<string, unknown> | null;
}

export class PgmqClient implements EventQueueTransport {
  constructor(private readonly pool: Pool) {}

  async check(): Promise<void> { await this.pool.query("SELECT 1"); }

  async send(queue: string, message: IngressEvent | EventEnvelope): Promise<string> {
    const result = await this.pool.query<{ send: string | number }>("SELECT pgmq.send($1, $2::jsonb) AS send", [queue, JSON.stringify(message)]);
    return String(result.rows[0].send);
  }

  async read(queue: string, options: { visibilityTimeoutSeconds: number; quantity: number; pollSeconds: number }): Promise<EventQueueMessage[]> {
    const result = await this.pool.query<PgmqMessage>("SELECT * FROM pgmq.read_with_poll($1, $2, $3, $4, 100)", [queue, options.visibilityTimeoutSeconds, options.quantity, options.pollSeconds]);
    return result.rows.map((row) => ({ id: String(row.msg_id), event: row.message, headers: row.headers }));
  }

  async delete(queue: string, id: string): Promise<void> {
    await this.pool.query("SELECT pgmq.delete($1::text, $2::bigint)", [queue, id]);
  }

  async extendVisibility(queue: string, id: string, seconds: number): Promise<void> {
    await this.pool.query("SELECT pgmq.set_vt($1::text, $2::bigint, $3::integer)", [queue, id, seconds]);
  }

}
