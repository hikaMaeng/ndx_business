/**
 * What a finished execution says.
 *
 * This is a wire shape, not an internal one: it is persisted verbatim into the
 * result event, carried down a client's socket, and read back by whoever asked
 * for the work. It lived next to the idempotency store, which is where it is
 * produced — but where a type is produced is not where it belongs when both
 * sides of a wire have to agree on it.
 */
export type ResultPayload = {
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};
