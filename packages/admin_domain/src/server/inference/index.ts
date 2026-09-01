import { policyChain } from "../policy/index.js";
import { queries, type AdminDatabase } from "../database/index.js";

/**
 * Which model a session runs on, and with what sampling.
 *
 * Not the signed-in person's choice. A business decides what its people's
 * agents run on, the same way it decides what skills they get, and a per-user
 * picker would make "which model wrote this" unanswerable from the org chart.
 *
 * So the answer comes from the project's organisation, and from the nearest
 * ancestor of it that has one:
 *
 *   a > b > c, the project under c, and only b configured → b's model.
 *
 * Searching upwards rather than down or sideways is what makes a parent's
 * choice a default its children inherit and may replace. A sub-organisation
 * that wants its own says so; one that says nothing gets its parent's, which is
 * the arrangement everybody already expects from an org chart.
 *
 * With no organisation at all — an account that belongs to nothing — or with
 * nothing configured anywhere up the chain, the deployment's default model is
 * used. That is one row, chosen in Admin, and it is the reason a fresh install
 * can open a session at all.
 */

/** A model, its endpoint, and the sampling registered for it. */
export interface ResolvedInference {
  endpointId: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  contextSize: number;
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  repeatPenalty: number;
  reasoning: boolean;
  /**
   * Which organisation supplied it, or `null` for the deployment default.
   *
   * Recorded because "why is this session on that model" is the question that
   * follows every surprise, and the answer is one level of an org chart that
   * nobody can see from the model name.
   */
  organizationId: string | null;
}

interface Row {
  endpoint_id: string;
  url: string;
  header_name: string | null;
  header_value: string | null;
  identifier: string;
  context_size: number;
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  repeat_penalty: number;
  reasoning: number;
}

const shape = (row: Row, organizationId: string | null): ResolvedInference => ({
  endpointId: row.endpoint_id,
  baseUrl: row.url,
  // The header carries the key when there is one. An endpoint with no header
  // configured is an endpoint that wants no authorization, not one whose key is
  // the empty string.
  ...(row.header_value ? { apiKey: row.header_value } : {}),
  model: row.identifier,
  contextSize: row.context_size,
  temperature: row.temperature,
  topP: row.top_p,
  topK: row.top_k,
  minP: row.min_p,
  repeatPenalty: row.repeat_penalty,
  reasoning: Boolean(row.reasoning),
  organizationId,
});

const SELECT = `
  SELECT e.id AS endpoint_id, e.url, e.header_name, e.header_value,
         d.identifier, d.context_size, d.temperature, d.top_p, d.top_k, d.min_p,
         d.repeat_penalty, d.reasoning
    FROM model_definitions d
    JOIN model_endpoints e ON e.id = d.endpoint_id
`;

/** The one model a deployment falls back to. At most one row can claim it. */
export async function defaultInference(database: AdminDatabase): Promise<ResolvedInference | null> {
  const row = await queries(database).get(`${SELECT} WHERE d.is_default = 1 LIMIT 1`) as Row | undefined;
  return row ? shape(row, null) : null;
}

/**
 * The model for a session, resolved from the project's organisation upwards.
 *
 * Walks the chain in order and stops at the first organisation with an active
 * model attached. `policyChain` already returns ancestors nearest-first, so the
 * order here is the inheritance order and not a second opinion about it.
 *
 * An organisation whose model is switched off counts as *not configured*, and
 * the search continues past it. Switching a model off is how somebody says
 * "not this one"; reading it as "nothing above this either" would make one
 * disabled row silently cut a subtree off from its parent's choice. Rows left
 * inactive by the one-model-per-organisation migration land here too, and they
 * must not stop the walk any more than a hand-disabled one does.
 */
export async function resolveInference(
  database: AdminDatabase,
  organizationId: string | null,
): Promise<ResolvedInference | null> {
  const ask = queries(database);
  for (const id of await policyChain(database, organizationId)) {
    // No tie-break, because there is no tie to break: a partial unique index on
    // `organization_inference_models(organization_id) WHERE active = 1` lets an
    // organisation hold one active model and no more. Ordering by identifier
    // here used to decide, silently, something the organisation never said.
    const row = await ask.get(`
      ${SELECT}
      JOIN organization_inference_models m
        ON m.endpoint_id = d.endpoint_id AND m.model_id = d.id
       WHERE m.organization_id = ? AND m.active = 1
    `, id) as Row | undefined;
    if (row) return shape(row, id);
  }
  return defaultInference(database);
}
