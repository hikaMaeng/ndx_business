import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoopConfig } from "../../config/index.js";
import type { SessionInference } from "../context/index.js";
import { withInference } from "./index.js";

/**
 * The merge is the whole of what the resolution does to a call, and it is the
 * one part of `callModel` a test can reach: everything around it ends in `chat`,
 * which talks to a real endpoint over the network.
 *
 * Two of these are about a credential. Getting that wrong does not fail — the
 * request succeeds, and the deployment's key has been handed to whichever host
 * an organisation registered — so nothing but a test would ever notice.
 */

const config: LoopConfig = {
  baseUrl: "http://container:8000/v1",
  apiKey: "container-key",
  model: "container-model",
  temperature: 0.15,
  topP: 0.9,
  maxTokens: 8192,
  requestTimeoutMs: 300_000,
  streamFlushMs: 120,
  workspaceRoot: "/workspace",
  maxIterations: 24,
  toolTimeoutMs: 120_000,
  maxToolOutputBytes: 200_000,
  systemPrompt: "prompt",
};

const resolved = (over: Partial<SessionInference> = {}): SessionInference => ({
  baseUrl: "https://org.example/v1",
  model: "org-model",
  temperature: 0.4,
  topP: 0.8,
  topK: 40,
  minP: 0.05,
  repeatPenalty: 1.1,
  organizationId: "org-1",
  ...over,
});

test("the resolution decides the model and the sampling", () => {
  const merged = withInference(config, resolved());

  assert.equal(merged.baseUrl, "https://org.example/v1");
  assert.equal(merged.model, "org-model");
  assert.equal(merged.temperature, 0.4);
  assert.equal(merged.topK, 40);
});

test("what the resolution does not answer stays the deployment's", () => {
  const merged = withInference(config, resolved());

  assert.equal(merged.requestTimeoutMs, 300_000, "a resolution says which model, not how long to wait for it");
  assert.equal(merged.maxTokens, 8192);
  assert.equal(merged.systemPrompt, "prompt");
});

test("a moved endpoint with no key of its own does not inherit the container's", () => {
  const merged = withInference(config, resolved());

  assert.equal(merged.apiKey, undefined, "the deployment's bearer token would have gone to org.example");
});

test("an endpoint that registered a key uses it", () => {
  const merged = withInference(config, resolved({ apiKey: "org-key" }));

  assert.equal(merged.apiKey, "org-key");
});

test("the container's own endpoint keeps the container's key", () => {
  // A deployment that registered its local endpoint in Admin without a header
  // still authenticates from the environment. Dropping the key here would break
  // the one arrangement every fresh install starts from.
  const merged = withInference(config, resolved({ baseUrl: config.baseUrl }));

  assert.equal(merged.apiKey, "container-key");
});
