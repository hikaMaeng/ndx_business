import { createServer, type RequestListener, type Server } from "node:http";

export function createGatewayStandby(): Server {
  return createServer((request, response) => {
    response.setHeader("connection", "close");
    if (request.url === "/health") { response.writeHead(200); response.end(JSON.stringify({ status: "ok", service: "agent", ready: false })); return; }
    if (request.url === "/ready") { response.writeHead(503); response.end(JSON.stringify({ status: "unavailable" })); return; }
    response.writeHead(503); response.end(JSON.stringify({ status: "standby" }));
  });
}

/** Reuses the bound standby listener so ownership promotion never creates a port gap. */
export function activateGatewayStandby(server: Server, listener: RequestListener): void {
  server.removeAllListeners("request");
  server.on("request", listener);
}
