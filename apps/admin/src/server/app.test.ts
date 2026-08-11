import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { openAuthDatabase } from "admin_domain/server";

function useMasterEmails(value: string): () => void {
  const previous = process.env.MASTER_ADMIN_EMAILS;
  process.env.MASTER_ADMIN_EMAILS = value;
  return () => {
    if (previous === undefined) delete process.env.MASTER_ADMIN_EMAILS;
    else process.env.MASTER_ADMIN_EMAILS = previous;
  };
}

test("GET /health returns admin health", async () => {
  const response = await request(createApp()).get("/health").expect(200);

  assert.deepEqual(response.body, {
    status: "ok",
    service: "admin"
  });
});

test("GET /api/health returns admin health", async () => {
  const response = await request(createApp()).get("/api/health").expect(200);

  assert.deepEqual(response.body, {
    status: "ok",
    service: "admin"
  });
});

test("API permission middleware defaults every API route to authentication", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-permission-"));
  const database = openAuthDatabase(path.join(directory, "permission.sqlite"));
  const restoreMasterEmails = useMasterEmails("master@example.com");
  const app = createApp(database);
  const password = "correct horse battery";
  try {
    await request(app).get("/health").expect(200);
    await request(app).get("/api/health").expect(200);
    await request(app).get("/api/auth/me").expect(401);
    await request(app).post("/api/auth/logout").expect(401);
    await request(app).get("/api/organizations").expect(401);
    await request(app).get("/api/models").expect(401);
    await request(app).get("/api/admin/settings").expect(401);

    await request(app).post("/api/auth/signup").send({ email: "master@example.com", password }).expect(201);
    await request(app).post("/api/auth/signup").send({ email: "member@example.com", password }).expect(201);
    const masterLogin = await request(app).post("/api/auth/login").send({ email: "master@example.com", password }).expect(200);
    const memberLogin = await request(app).post("/api/auth/login").send({ email: "member@example.com", password }).expect(200);
    const masterToken = masterLogin.body.sessionToken as string;
    const memberToken = memberLogin.body.sessionToken as string;

    await request(app).get("/api/organizations").set("Authorization", `Bearer ${memberToken}`).expect(200);
    await request(app).get("/api/models").set("Authorization", `Bearer ${memberToken}`).expect(403);
    await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${memberToken}`).expect(403);
    await request(app).get("/api/models").set("Authorization", `Bearer ${masterToken}`).expect(200);
    await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${masterToken}`).expect(200);
  } finally {
    restoreMasterEmails();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("signup, login, authenticated settings, and session revocation work in SQLite", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-auth-"));
  const database = openAuthDatabase(path.join(directory, "auth.sqlite"));
  const restoreMasterEmails = useMasterEmails("operator@example.com");
  const app = createApp(database);
  try {
    const signup = await request(app).post("/api/auth/signup").send({ email: "operator@example.com", password: "correct horse battery" }).expect(201);
    assert.equal(signup.body.status, "active");
    const login = await request(app).post("/api/auth/login").send({ email: "operator@example.com", password: "correct horse battery" }).expect(200);
    const token = login.body.sessionToken as string;
    const settings = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(settings.body.settings.sessionIdleTimeoutSeconds, 3600);
    assert.equal(settings.body.sessions.length, 1);
    const sessionId = settings.body.sessions[0].id as string;
    await request(app).delete(`/api/admin/sessions/${sessionId}`).set("Authorization", `Bearer ${token}`).expect(200);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`).expect(401);
  } finally {
    restoreMasterEmails();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("one account reuses its token while tracking devices and configurable transports", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-shared-session-"));
  const database = openAuthDatabase(path.join(directory, "auth.sqlite"));
  const restoreMasterEmails = useMasterEmails("shared@example.com");
  const app = createApp(database);
  try {
    await request(app).post("/api/auth/signup").send({ email: "shared@example.com", password: "correct horse battery" }).expect(201);
    const first = await request(app).post("/api/auth/login").send({ email: "shared@example.com", password: "correct horse battery" }).expect(200);
    const second = await request(app).post("/api/auth/login").send({ email: "shared@example.com", password: "correct horse battery" }).expect(200);
    assert.equal(first.body.sessionToken, second.body.sessionToken);
    await request(app).get("/api/auth/me").set("Authorization", `Bearer ${first.body.sessionToken}`).set("X-Session-Device", "browser-a").set("User-Agent", "Browser A").expect(200);
    await request(app).get("/api/auth/me").set("X-Session-Device", "mobile-b").set("Cookie", `admin_session=${first.body.sessionToken}`).set("User-Agent", "Mobile B").expect(200);
    const settings = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${first.body.sessionToken}`).expect(200);
    assert.equal(settings.body.sessions[0].devices.length, 3);
    await request(app).put("/api/admin/settings").set("Authorization", `Bearer ${first.body.sessionToken}`).send({ sessionHeaderName: "X-Client-Token", sessionCookieName: "client_session" }).expect(200);
    await request(app).get("/api/auth/me").set("X-Client-Token", first.body.sessionToken).set("X-Session-Device", "plugin-c").expect(200);
  } finally {
    restoreMasterEmails();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("organization acceptance: multiple roots, deep children, delegated scopes, and forbidden mutations", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-organization-acceptance-"));
  const database = openAuthDatabase(path.join(directory, "organization.sqlite"));
  const restoreMasterEmails = useMasterEmails("hika00@gmail.com");
  const app = createApp(database);
  const password = "correct horse battery";
  async function createAccount(email: string): Promise<string> {
    await request(app).post("/api/auth/signup").send({ email, password }).expect(201);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    return login.body.sessionToken as string;
  }
  async function createOrganization(token: string, name: string, parentId: string | null = null): Promise<string> {
    const response = await request(app).post("/api/organizations").set("Authorization", `Bearer ${token}`).send({ name, mode: parentId === null ? "root" : "child", parentId }).expect(201);
    const created = response.body.organizations.find((organization: { name: string }) => organization.name === name) as { id: string };
    assert.ok(created);
    return created.id;
  }
  try {
    const masterLogin = await request(app).post("/api/auth/signup").send({ email: "hika00@gmail.com", password }).expect(201);
    assert.equal(masterLogin.body.status, "active");
    const masterAuth = await request(app).post("/api/auth/login").send({ email: "hika00@gmail.com", password }).expect(200);
    assert.equal(masterAuth.body.user.isMasterAdmin, true);
    const master = masterAuth.body.sessionToken as string;
    const subtreeOwner = await createAccount("org.owner@example.com");
    const nodeOwner = await createAccount("node.owner@example.com");
    const sharedMember = await createAccount("shared.member@example.com");
    const outsider = await createAccount("other.member@example.com");
    const userId = (email: string) => (database.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
    const sharedMemberId = userId("shared.member@example.com");
    const subtreeOwnerId = userId("org.owner@example.com");
    const nodeOwnerId = userId("node.owner@example.com");
    const outsiderId = userId("other.member@example.com");

    const headquarters = await createOrganization(master, "Headquarters");
    const research = await createOrganization(master, "Research");
    const engineering = await createOrganization(master, "Engineering", headquarters);
    const platform = await createOrganization(master, "Platform", engineering);
    const runtime = await createOrganization(master, "Runtime", platform);
    const sales = await createOrganization(master, "Sales", headquarters);
    const researchLab = await createOrganization(master, "Research Lab", research);

    const updatedResearch = await request(app)
      .put(`/api/organizations/${researchLab}`)
      .set("Authorization", `Bearer ${master}`)
      .send({ name: "Applied Research", color: "cyan", icon: "layers" })
      .expect(200);
    const updatedNode = updatedResearch.body.organizations.find((organization: { id: string }) => organization.id === researchLab);
    assert.equal(updatedNode.name, "Applied Research");
    assert.equal(updatedNode.color, "cyan");
    assert.equal(updatedNode.icon, "layers");

    for (const organizationId of [headquarters, platform, researchLab]) {
      await request(app).post(`/api/organizations/${organizationId}/members`).set("Authorization", `Bearer ${master}`).send({ userId: sharedMemberId }).expect(200);
    }
    await request(app).post(`/api/organizations/${engineering}/responsibilities`).set("Authorization", `Bearer ${master}`).send({ userId: subtreeOwnerId, scope: "subtree" }).expect(200);
    await request(app).post(`/api/organizations/${platform}/responsibilities`).set("Authorization", `Bearer ${master}`).send({ userId: nodeOwnerId, scope: "node" }).expect(200);

    await request(app).post("/api/organizations").set("Authorization", `Bearer ${nodeOwner}`).send({ name: "Forbidden Root", mode: "root", parentId: null }).expect(403);
    await request(app).post("/api/organizations").set("Authorization", `Bearer ${nodeOwner}`).send({ name: "Forbidden Child", mode: "child", parentId: platform }).expect(403);
    await request(app).post("/api/organizations").set("Authorization", `Bearer ${subtreeOwner}`).send({ name: "Forbidden Sibling", mode: "sibling", parentId: engineering }).expect(403);
    await request(app).post(`/api/organizations/${platform}/responsibilities`).set("Authorization", `Bearer ${nodeOwner}`).send({ userId: sharedMemberId, scope: "subtree" }).expect(403);
    await request(app).delete(`/api/organizations/${platform}`).set("Authorization", `Bearer ${nodeOwner}`).expect(403);
    await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${nodeOwner}`).expect(403);
    await request(app).get("/api/admin/users").set("Authorization", `Bearer ${nodeOwner}`).expect(403);
    await request(app).get("/api/organizations/users").set("Authorization", `Bearer ${nodeOwner}`).expect(200);
    await request(app).get("/api/organizations/users").set("Authorization", `Bearer ${outsider}`).expect(403);

    const nodeOwnerUpdate = await request(app)
      .put(`/api/organizations/${platform}`)
      .set("Authorization", `Bearer ${nodeOwner}`)
      .send({ name: "Platform", color: "blue", icon: "building" })
      .expect(200);
    const nodeOwnerPermission = nodeOwnerUpdate.body.access.nodes.find((node: { organizationId: string }) => node.organizationId === platform);
    assert.deepEqual(nodeOwnerPermission, {
      organizationId: platform,
      canUpdate: true,
      canManageMembers: true,
      canCreateChild: false,
      canCreateSibling: false,
      canDelete: false,
      canAssignAdminAll: false,
    });

    const delegatedChild = await createOrganization(subtreeOwner, "Platform Services", platform);
    await request(app).post(`/api/organizations/${delegatedChild}/members`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: sharedMemberId }).expect(200);
    await request(app).post(`/api/organizations/${delegatedChild}/responsibilities`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: nodeOwnerId, scope: "node" }).expect(200);
    await request(app).post(`/api/organizations/${delegatedChild}/responsibilities`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: outsiderId, scope: "subtree" }).expect(200);
    await request(app).delete(`/api/organizations/${delegatedChild}/responsibilities/${outsiderId}`).set("Authorization", `Bearer ${subtreeOwner}`).expect(200);

    await request(app).post(`/api/organizations/${platform}/members`).set("Authorization", `Bearer ${nodeOwner}`).send({ userId: nodeOwnerId }).expect(200);
    await request(app).post(`/api/organizations/${platform}/responsibilities`).set("Authorization", `Bearer ${master}`).send({ userId: sharedMemberId, scope: "node" }).expect(200);
    await request(app).delete(`/api/organizations/${platform}/responsibilities/${sharedMemberId}`).set("Authorization", `Bearer ${master}`).expect(200);
    await request(app).post(`/api/organizations/${research}/members`).set("Authorization", `Bearer ${master}`).send({ userId: outsiderId }).expect(200);
    const removedMember = await request(app).delete(`/api/organizations/${research}/members/${outsiderId}`).set("Authorization", `Bearer ${master}`).expect(200);
    assert.equal(removedMember.body.members.some((member: { organizationId: string; userId: string }) => member.organizationId === research && member.userId === outsiderId), false);
    await request(app).post(`/api/organizations/${runtime}/members`).set("Authorization", `Bearer ${nodeOwner}`).send({ userId: nodeOwnerId }).expect(403);
    await request(app).post(`/api/organizations/${sales}/members`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: outsiderId }).expect(403);
    await request(app).post(`/api/organizations/${researchLab}/members`).set("Authorization", `Bearer ${outsider}`).send({ userId: outsiderId }).expect(403);

    const snapshot = await request(app).get("/api/organizations").set("Authorization", `Bearer ${master}`).expect(200);
    assert.equal(snapshot.body.organizations.length, 8);
    assert.equal(snapshot.body.members.filter((member: { userId: string }) => member.userId === sharedMemberId).length, 4);
    assert.deepEqual(snapshot.body.responsibilities.map((responsibility: { scope: string }) => responsibility.scope).sort(), ["node", "node", "subtree"]);
    assert.equal(snapshot.body.access.isMasterAdmin, true);
    assert.equal(snapshot.body.access.canCreateRoot, true);
    assert.equal(snapshot.body.access.nodes.every((node: { canDelete: boolean }) => node.canDelete), true);

    const delegatedSnapshot = await request(app).get("/api/organizations").set("Authorization", `Bearer ${subtreeOwner}`).expect(200);
    const delegatedPermission = delegatedSnapshot.body.access.nodes.find((node: { organizationId: string }) => node.organizationId === platform);
    assert.equal(delegatedSnapshot.body.access.canCreateRoot, false);
    assert.equal(delegatedPermission.canCreateChild, true);
    assert.equal(delegatedPermission.canAssignAdminAll, true);
    assert.equal(delegatedPermission.canCreateSibling, false);
    assert.equal(delegatedPermission.canDelete, false);
  } finally {
    restoreMasterEmails();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("model endpoints refresh provider models, filter embeddings, and persist model options", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-models-"));
  const database = openAuthDatabase(path.join(directory, "models.sqlite"));
  const restoreMasterEmails = useMasterEmails("models@example.com");
  const previousFetch = globalThis.fetch;
  const app = createApp(database);
  try {
    await request(app)
      .post("/api/auth/signup")
      .send({ email: "models@example.com", password: "correct horse battery" })
      .expect(201);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "models@example.com", password: "correct horse battery" })
      .expect(200);
    const token = login.body.sessionToken as string;
    const created = await request(app)
      .post("/api/models")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Primary provider",
        url: "https://provider.example/v1/chat/completions",
        headerName: "Authorization",
        headerValue: "Bearer test-key",
        type: "openai-chat-completion",
      })
      .expect(201);
    const endpoint = created.body.endpoints[0] as { id: string };
    assert.ok(endpoint.id);
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://provider.example/v1/models");
      assert.deepEqual(init?.headers, { Authorization: "Bearer test-key" });
      return new Response(
        JSON.stringify({ data: [{ id: "chat-primary" }, { id: "text-embedding-3-small" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const refreshed = await request(app)
      .post(`/api/models/${endpoint.id}/refresh`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.deepEqual(refreshed.body.models.map((item: { identifier: string }) => item.identifier), ["chat-primary"]);
    const item = refreshed.body.models[0] as { id: string };
    const updated = await request(app)
      .put(`/api/models/${endpoint.id}/models/${item.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        identifier: "chat-primary",
        contextSize: 128000,
        temperature: 0.7,
        minP: 0.05,
        topP: 0.9,
        topK: 40,
        repeatPenalty: 1.1,
        reasoning: true,
        supportsText: true,
        supportsImage: true,
        supportsSound: false,
        supportsVideo: false,
      })
      .expect(200);
    assert.equal(updated.body.models[0].identifier, "chat-primary");
    assert.equal(updated.body.models[0].contextSize, 128000);
    assert.equal(updated.body.models[0].temperature, 0.7);
    assert.equal(updated.body.models[0].minP, 0.05);
    assert.equal(updated.body.models[0].topP, 0.9);
    assert.equal(updated.body.models[0].topK, 40);
    assert.equal(updated.body.models[0].repeatPenalty, 1.1);
    assert.equal(updated.body.models[0].reasoning, true);
    assert.equal(updated.body.models[0].supportsImage, true);
    assert.equal(updated.body.models[0].supportsSound, false);

    const organization = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Model-enabled node", mode: "root", parentId: null })
      .expect(201);
    const organizationId = organization.body.organizations.find(
      (item: { name: string }) => item.name === "Model-enabled node",
    ).id as string;
    const assigned = await request(app)
      .post(`/api/organizations/${organizationId}/inference-services`)
      .set("Authorization", `Bearer ${token}`)
      .send({ endpointId: endpoint.id })
      .expect(200);
    assert.deepEqual(assigned.body.inferenceServices, [{
      organizationId,
      endpointId: endpoint.id,
      name: "Primary provider",
      models: [{ modelId: item.id, identifier: "chat-primary", active: true }],
    }]);
    const child = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Model child node", mode: "child", parentId: organizationId })
      .expect(201);
    const childId = child.body.organizations.find(
      (organization: { name: string }) => organization.name === "Model child node",
    ).id as string;
    assert.equal(
      child.body.inferenceServices.some(
        (service: { organizationId: string }) => service.organizationId === childId,
      ),
      false,
    );
    const addedModel = await request(app)
      .post(`/api/models/${endpoint.id}/models`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        identifier: "chat-later",
        contextSize: 0,
        temperature: 1,
        minP: 0,
        topP: 1,
        topK: 0,
        repeatPenalty: 1,
        reasoning: false,
        supportsText: true,
        supportsImage: false,
        supportsSound: false,
        supportsVideo: false,
      })
      .expect(201);
    const laterModel = addedModel.body.models.find(
      (definition: { identifier: string }) => definition.identifier === "chat-later",
    ) as { id: string };
    const allModels = await request(app)
      .get("/api/organizations")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.deepEqual(
      allModels.body.inferenceServices[0].models.map(
        (model: { identifier: string; active: boolean }) => [model.identifier, model.active],
      ),
      [["chat-later", true], ["chat-primary", true]],
    );
    const disabled = await request(app)
      .put(`/api/organizations/${organizationId}/inference-services/${endpoint.id}/models/${item.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false })
      .expect(200);
    assert.equal(
      disabled.body.inferenceServices[0].models.find(
        (model: { modelId: string }) => model.modelId === item.id,
      ).active,
      false,
    );
    assert.equal(
      disabled.body.inferenceServices[0].models.find(
        (model: { modelId: string }) => model.modelId === laterModel.id,
      ).active,
      true,
    );
    const removed = await request(app)
      .delete(`/api/organizations/${organizationId}/inference-services/${endpoint.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    assert.deepEqual(removed.body.inferenceServices, []);

  } finally {
    globalThis.fetch = previousFetch;
    restoreMasterEmails();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
