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

/**
 * The same rule, applied to a session id rather than to its channel.
 *
 * The read model is addressed by session, not by channel, so it needs the rule
 * in that form. It is the same check because it is the same fact: a session id
 * begins with the id of whoever owns it.
 */
export function ownsVibeSession(sessionKey: string, userId: string): boolean {
  return Boolean(userId) && sessionKey.startsWith(`${userId}-`);
}
