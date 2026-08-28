/**
 * What every role needs to know, read once.
 *
 * The three processes share almost nothing — different dependencies, different
 * failure modes, different reasons to change — but they do share where the
 * account service lives and where projects are kept. Reading that here keeps
 * the roles from each inventing their own default and drifting apart.
 */
const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const accountBaseUrl = process.env.VIBE_ACCOUNT_BASE_URL ?? "http://admin:18080";
export const workspaceRoot = process.env.VIBE_WORKSPACE_ROOT ?? "/workspace";
export const clientDir = process.env.VIBE_CLIENT_DIR ?? "/app/dist/front";
export const sessionCacheMs = number("VIBE_SESSION_CACHE_MS", 5_000);
export const maxConcurrentTurns = number("VIBE_MAX_CONCURRENT_TURNS", 256);

/**
 * How many database connections this worker may hold.
 *
 * Sized per role rather than fixed, because the roles are no longer one
 * process. Inference and tool execution run several reactions at once and want
 * the room; turn control and the projection do millisecond writes and do not.
 * One database now serves every service, so a pool that is generous everywhere
 * is a pool that exhausts it.
 */
export const workerPoolSize = Number(process.env.AGENT_POOL_MAX ?? 8) || 8;
