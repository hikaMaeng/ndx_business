import { createServer, type RequestListener, type Server } from "node:http";

export interface GatewayStandby {
  server: Server;
  activate(listener: RequestListener): void;
}

export function createGatewayStandby(): GatewayStandby {
  const standbyListener: RequestListener = (request, response) => {
    response.setHeader("connection", "close");
    if (request.url === "/health") { response.writeHead(200); response.end(JSON.stringify({ status: "ok", service: "agent", ready: false })); return; }
    if (request.url === "/ready") { response.writeHead(503); response.end(JSON.stringify({ status: "unavailable" })); return; }
    response.writeHead(503); response.end(JSON.stringify({ status: "standby" }));
  };
  const server = createServer(standbyListener);
  const rejectUpgrade = (_request: unknown, socket: { write(message: string): void; destroy(): void }) => {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
  };
  server.on("upgrade", rejectUpgrade);
  return {
    server,
    /** Reuses the bound standby listener so ownership promotion never creates a port gap. */
    activate(listener: RequestListener): void {
      server.off("request", standbyListener);
      server.on("request", listener);
      server.off("upgrade", rejectUpgrade);
    },
  };
}
