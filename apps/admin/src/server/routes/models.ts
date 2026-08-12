import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { parseCreateModelEndpointRequest, parseModelDefinitionRequest, parseUpdateModelEndpointRequest } from "admin_domain/common";
import { createModelDefinition, createModelEndpoint, listModelCatalog, refreshModelEndpoint, updateModelDefinition, updateModelEndpoint } from "admin_domain/server";
import { body, requireInput } from "./body.js";

export function registerModelRoutes(app: express.Express, database: DatabaseSync): void {
  app.get("/api/models", (_request, response) => response.json(listModelCatalog(database)));
  app.post("/api/models", (request, response) => { try { response.status(201).json(createModelEndpoint(database, requireInput(parseCreateModelEndpointRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint creation failed" }); } });
  app.put("/api/models/:endpointId", (request, response) => { try { response.json(updateModelEndpoint(database, String(request.params.endpointId), requireInput(parseUpdateModelEndpointRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint update failed" }); } });
  app.post("/api/models/:endpointId/refresh", async (request, response) => { try { response.json(await refreshModelEndpoint(database, String(request.params.endpointId))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model refresh failed" }); } });
  app.post("/api/models/:endpointId/models", (request, response) => { try { response.status(201).json(createModelDefinition(database, String(request.params.endpointId), requireInput(parseModelDefinitionRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model definition creation failed" }); } });
  app.put("/api/models/:endpointId/models/:modelId", (request, response) => { try { response.json(updateModelDefinition(database, String(request.params.endpointId), String(request.params.modelId), requireInput(parseModelDefinitionRequest(body(request))))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Model definition update failed" }); } });
}
