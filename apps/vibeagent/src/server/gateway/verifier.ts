import { createSessionVerifier } from "agent/broker";
import { accountBaseUrl, sessionCacheMs } from "../config.js";

/** What `requireSession` needs: it turns a token into a user, or refuses. */
export type SessionVerifier = ReturnType<typeof createSessionVerifier>;

/**
 * One verifier for the whole gateway.
 *
 * Every route guard shares it so they share its cache; building one per router
 * would multiply the calls to the account service by the number of route files.
 */
export const gatewayVerifier = (): SessionVerifier =>
  createSessionVerifier({ adminBaseUrl: accountBaseUrl, cacheMs: sessionCacheMs });
