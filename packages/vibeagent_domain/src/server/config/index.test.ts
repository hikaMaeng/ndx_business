import assert from "node:assert/strict";
import { test } from "node:test";
import { readLoopConfig } from "./index.js";

const required = { VIBE_INFERENCE_BASE_URL: "http://x/v1", VIBE_INFERENCE_MODEL: "m" };

test("inference defaults are the coding profile, not chat defaults", () => {
  const config = readLoopConfig(required as NodeJS.ProcessEnv);
  assert.equal(config.temperature, 0.15);
  assert.equal(config.topP, 0.9);
  assert.equal(config.maxTokens, 8192);
  assert.equal(config.maxIterations, 24);
});

test("endpoint and model are required rather than silently defaulted", () => {
  assert.throws(() => readLoopConfig({ VIBE_INFERENCE_MODEL: "m" } as NodeJS.ProcessEnv), /VIBE_INFERENCE_BASE_URL/);
  assert.throws(() => readLoopConfig({ VIBE_INFERENCE_BASE_URL: "http://x/v1" } as NodeJS.ProcessEnv), /VIBE_INFERENCE_MODEL/);
});

test("an out-of-range budget is rejected instead of clamped", () => {
  assert.throws(() => readLoopConfig({ ...required, VIBE_MAX_ITERATIONS: "0" } as NodeJS.ProcessEnv), /VIBE_MAX_ITERATIONS/);
  assert.throws(() => readLoopConfig({ ...required, VIBE_INFERENCE_TEMPERATURE: "5" } as NodeJS.ProcessEnv), /VIBE_INFERENCE_TEMPERATURE/);
});
