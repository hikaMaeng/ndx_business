import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";
import { createApp } from "./app.js";
import { openAuthDatabase } from "admin_domain/server";

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

test("signup, login, authenticated settings, and session revocation work in SQLite", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-auth-"));
  const database = openAuthDatabase(path.join(directory, "auth.sqlite"));
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
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("one account reuses its token while tracking devices and configurable transports", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-shared-session-"));
  const database = openAuthDatabase(path.join(directory, "auth.sqlite"));
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
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("organization acceptance: multiple roots, deep children, delegated scopes, and forbidden mutations", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "admin-organization-acceptance-"));
  const database = openAuthDatabase(path.join(directory, "organization.sqlite"));
  const previousMasters = process.env.MASTER_ADMIN_EMAILS;
  process.env.MASTER_ADMIN_EMAILS = "hika00@gmail.com";
  const app = createApp(database);
  const password = "correct horse battery";
  async function createAccount(email: string): Promise<string> {
    await request(app).post("/api/auth/signup").send({ email, password }).expect(201);
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    return login.body.sessionToken as string;
  }
  async function createOrganization(token: string, name: string, parentId: string | null = null): Promise<string> {
    const response = await request(app).post("/api/organizations").set("Authorization", `Bearer ${token}`).send({ name, parentId }).expect(201);
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

    for (const organizationId of [headquarters, platform, researchLab]) {
      await request(app).post(`/api/organizations/${organizationId}/members`).set("Authorization", `Bearer ${master}`).send({ userId: sharedMemberId }).expect(200);
    }
    await request(app).post(`/api/organizations/${engineering}/responsibilities`).set("Authorization", `Bearer ${master}`).send({ userId: subtreeOwnerId, scope: "subtree" }).expect(200);
    await request(app).post(`/api/organizations/${platform}/responsibilities`).set("Authorization", `Bearer ${master}`).send({ userId: nodeOwnerId, scope: "node" }).expect(200);

    const delegatedChild = await createOrganization(subtreeOwner, "Platform Services", platform);
    await request(app).post(`/api/organizations/${delegatedChild}/members`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: sharedMemberId }).expect(200);
    await request(app).post(`/api/organizations/${delegatedChild}/responsibilities`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: nodeOwnerId, scope: "node" }).expect(200);

    await request(app).post(`/api/organizations/${platform}/members`).set("Authorization", `Bearer ${nodeOwner}`).send({ userId: nodeOwnerId }).expect(200);
    await request(app).post(`/api/organizations/${runtime}/members`).set("Authorization", `Bearer ${nodeOwner}`).send({ userId: nodeOwnerId }).expect(403);
    await request(app).post(`/api/organizations/${sales}/members`).set("Authorization", `Bearer ${subtreeOwner}`).send({ userId: outsiderId }).expect(403);
    await request(app).post(`/api/organizations/${researchLab}/members`).set("Authorization", `Bearer ${outsider}`).send({ userId: outsiderId }).expect(403);

    const snapshot = await request(app).get("/api/organizations").set("Authorization", `Bearer ${master}`).expect(200);
    assert.equal(snapshot.body.organizations.length, 8);
    assert.equal(snapshot.body.members.filter((member: { userId: string }) => member.userId === sharedMemberId).length, 4);
    assert.deepEqual(snapshot.body.responsibilities.map((responsibility: { scope: string }) => responsibility.scope).sort(), ["node", "node", "subtree"]);
  } finally {
    if (previousMasters === undefined) delete process.env.MASTER_ADMIN_EMAILS;
    else process.env.MASTER_ADMIN_EMAILS = previousMasters;
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
