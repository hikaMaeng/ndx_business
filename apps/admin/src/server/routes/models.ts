import express from "express";
import type { PostgresDatabase } from "admin_domain/server/postgres";
import { parseCreateModelEndpointRequest, parseModelDefinitionRequest, parseUpdateModelEndpointRequest } from "admin_domain/common";
import { createModelDefinition, createModelEndpoint, listModelCatalog, refreshModelEndpoint, updateModelDefinition, updateModelEndpoint } from "admin_domain/server/postgres";
import { body, requireInput } from "./body.js";

export function registerModelRoutes(app: express.Express, database: PostgresDatabase): void {
  app.get("/api/models", async (_request, response) => response.json(await listModelCatalog(database)));
  app.post("/api/models", async (request, response) => { try { response.status(201).json(await createModelEndpoint(database, requireInput(parseCreateModelEndpointRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint creation failed" }); } });
  app.put("/api/models/:endpointId", async (request, response) => { try { response.json(await updateModelEndpoint(database, String(request.params.endpointId), requireInput(parseUpdateModelEndpointRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint update failed" }); } });
  app.post("/api/models/:endpointId/refresh", async (request, response) => { try { response.json(await refreshModelEndpoint(database, String(request.params.endpointId))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model refresh failed" }); } });
  app.post("/api/models/:endpointId/models", async (request, response) => { try { response.status(201).json(await createModelDefinition(database, String(request.params.endpointId), requireInput(parseModelDefinitionRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model definition creation failed" }); } });
  app.put("/api/models/:endpointId/models/:modelId", async (request, response) => { try { response.json(await updateModelDefinition(database, String(request.params.endpointId), String(request.params.modelId), requireInput(parseModelDefinitionRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model definition update failed" }); } });
}
