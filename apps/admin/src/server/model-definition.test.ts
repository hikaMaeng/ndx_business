import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { openAuthDatabase } from "admin_domain/server";
import { createApp } from "./app.js";

test("manual model definitions are created and updated", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-manual-model-"));
  const database = openAuthDatabase(path.join(directory, "models.sqlite"));
  const previousMasterEmails = process.env.MASTER_ADMIN_EMAILS;
  process.env.MASTER_ADMIN_EMAILS = "manual-models@example.com";
  const app = createApp(database);
  try {
    await request(app)
      .post("/api/auth/signup")
      .send({ email: "manual-models@example.com", password: "correct horse battery" })
      .expect(201);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "manual-models@example.com", password: "correct horse battery" })
      .expect(200);
    const token = login.body.sessionToken as string;
    const endpoint = await request(app)
      .post("/api/models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Manual models",
        url: "https://provider.example/v1",
        headerName: "",
        headerValue: "",
        type: "openai-chat-completion",
      })
      .expect(201);
    const endpointId = endpoint.body.endpoints[0].id as string;
    const created = await request(app)
      .post(`/api/models/${endpointId}/models`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        identifier: "manual-model",
        contextSize: 32768,
        temperature: 0.8,
        minP: 0,
        topP: 0.95,
        topK: 30,
        repeatPenalty: 1.05,
        reasoning: false,
        supportsText: true,
        supportsImage: false,
        supportsSound: false,
        supportsVideo: false,
      })
      .expect(201);
    const definition = created.body.models.find(
      (model: { identifier: string }) => model.identifier === "manual-model",
    ) as { id: string; contextSize: number };
    assert.equal(definition.contextSize, 32768);
    const updated = await request(app)
      .put(`/api/models/${endpointId}/models/${definition.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        identifier: "manual-model",
        contextSize: 65536,
        temperature: 0.8,
        minP: 0,
        topP: 0.95,
        topK: 30,
        repeatPenalty: 1.05,
        reasoning: true,
        supportsText: true,
        supportsImage: true,
        supportsSound: false,
        supportsVideo: false,
      })
      .expect(200);
    assert.equal(updated.body.models.find((model: { id: string }) => model.id === definition.id).contextSize, 65536);
    assert.equal(updated.body.models.find((model: { id: string }) => model.id === definition.id).reasoning, true);
  } finally {
    if (previousMasterEmails === undefined) delete process.env.MASTER_ADMIN_EMAILS;
    else process.env.MASTER_ADMIN_EMAILS = previousMasterEmails;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
