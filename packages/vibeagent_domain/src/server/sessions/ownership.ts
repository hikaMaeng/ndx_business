/**
 * The one rule the broker needs to police a replay request.
 *
 * Ownership is carried by the session id itself, so this is a string check and
 * not a lookup: the broker can answer it without learning anything about what a
 * session contains.
 */
export function ownsVibeChannel(channel: string, userId: string): boolean {
  return channel.startsWith(`vibe.${userId}-`);
}
