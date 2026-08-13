import express from "express";
import type { PostgresDatabase } from "admin_domain/server/postgres";
import { addOrganizationInferenceServiceRoute, parseAssignMemberRequest, parseAssignOrganizationInferenceServiceRequest, parseAssignResponsibleRequest, parseCreateOrganizationRequest, parseUpdateOrganizationInferenceModelRequest, parseUpdateOrganizationRequest, removeOrganizationInferenceServiceRoute, updateOrganizationInferenceModelRoute } from "admin_domain/common";
import { assignMember, assignOrganizationInferenceService, assignResponsible, createOrganization, deleteOrganization, listOrganizationAccounts, listOrganizations, removeMember, removeOrganizationInferenceService, removeResponsible, updateOrganization, updateOrganizationInferenceModel } from "admin_domain/server/postgres";
import type { AuthenticatedRequest } from "../permission/index.js";
import { body, requireInput } from "./body.js";

const actor = (request: AuthenticatedRequest) => ({ id: request.user!.id, master: Boolean(request.user!.isMasterAdmin) });
const forbidden = (response: express.Response, error: unknown, fallback: string) => response.status(403).json({ error: error instanceof Error ? error.message : fallback });
const guarded = (handler: (request: AuthenticatedRequest) => Promise<unknown>, fallback: string) => async (request: AuthenticatedRequest, response: express.Response) => { try { response.json(await handler(request)); } catch (error) { forbidden(response, error, fallback); } };

export function registerOrganizationRoutes(app: express.Express, database: PostgresDatabase): void {
  app.get("/api/organizations", async (request: AuthenticatedRequest, response) => { const user = actor(request); response.json(await listOrganizations(database, user.id, user.master)); });
  app.get("/api/organizations/users", guarded(async (request) => { const user = actor(request); return listOrganizationAccounts(database, user.id, user.master); }, "Organization account access failed"));
  app.post("/api/organizations", async (request: AuthenticatedRequest, response) => { try { const user = actor(request); response.status(201).json(await createOrganization(database, user.id, user.master, requireInput(parseCreateOrganizationRequest(body(request))))); } catch (error) { forbidden(response, error, "Organization update failed"); } });
  app.put("/api/organizations/:id", guarded(async (request) => { const user = actor(request); return updateOrganization(database, user.id, user.master, String(request.params.id), requireInput(parseUpdateOrganizationRequest(body(request)))); }, "Organization update failed"));
  app.post("/api/organizations/:id/members", guarded(async (request) => { const user = actor(request); return assignMember(database, user.id, user.master, String(request.params.id), requireInput(parseAssignMemberRequest(body(request)))); }, "Member assignment failed"));
  app.delete("/api/organizations/:id/members/:userId", guarded(async (request) => { const user = actor(request); return removeMember(database, user.id, user.master, String(request.params.id), String(request.params.userId)); }, "Member removal failed"));
  app.post("/api/organizations/:id/responsibilities", guarded(async (request) => { const user = actor(request); return assignResponsible(database, user.id, user.master, String(request.params.id), requireInput(parseAssignResponsibleRequest(body(request)))); }, "Responsibility assignment failed"));
  app.delete("/api/organizations/:id/responsibilities/:userId", guarded(async (request) => { const user = actor(request); return removeResponsible(database, user.id, user.master, String(request.params.id), String(request.params.userId)); }, "Responsibility removal failed"));
  app.post(addOrganizationInferenceServiceRoute.path, guarded(async (request) => { const user = actor(request); return assignOrganizationInferenceService(database, user.id, user.master, String(request.params.id), requireInput(parseAssignOrganizationInferenceServiceRequest(body(request)))); }, "Inference service assignment failed"));
  app.delete(removeOrganizationInferenceServiceRoute.path, guarded(async (request) => { const user = actor(request); return removeOrganizationInferenceService(database, user.id, user.master, String(request.params.id), String(request.params.endpointId)); }, "Inference service removal failed"));
  app.put(updateOrganizationInferenceModelRoute.path, guarded(async (request) => { const user = actor(request); return updateOrganizationInferenceModel(database, user.id, user.master, String(request.params.id), String(request.params.endpointId), String(request.params.modelId), requireInput(parseUpdateOrganizationInferenceModelRequest(body(request)))); }, "Inference model update failed"));
  app.delete("/api/organizations/:id", guarded(async (request) => { const user = actor(request); return deleteOrganization(database, actor(request).id, actor(request).master, String(request.params.id)); }, "Organization deletion failed"));
}
