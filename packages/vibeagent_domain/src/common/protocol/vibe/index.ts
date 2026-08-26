/**
 * The vibe coding wire contract.
 *
 * This folder is the agreement between two implementations that never call each
 * other: the worker server that produces these events, and the web client that
 * renders them. The broker in between moves envelopes and reads none of it.
 *
 * Because both sides import these types, a payload change that only one side
 * honours fails to compile rather than failing in production.
 *
 * One file per topic:
 *
 * | file | holds |
 * | --- | --- |
 * | `actions.ts` | every action name, and which of them a client may submit |
 * | `workspace.ts` | the session's working folder and the rule that keeps it inside the root |
 * | `session.ts` | opening a session, and the fact that fixes its folder |
 * | `turn.ts` | one turn: request, per-iteration facts, outcome |
 * | `progress.ts` | the action → payload map and the wire parser |
 */
export * from "./actions.js";
export * from "./workspace.js";
export * from "./session.js";
export * from "./turn.js";
export * from "./progress.js";
