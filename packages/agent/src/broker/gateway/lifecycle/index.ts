import type { Server } from "node:http";

export async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
    server.closeAllConnections();
  });
}

export async function shutdownGateway(input: {
  stopReader(): void;
  waitForReader(): Promise<void>;
  closeSocketsAndRemoveSubscriptions(): Promise<void>;
  closeHttp(): Promise<void>;
  releaseOwnership(): Promise<void>;
}): Promise<void> {
  input.stopReader();
  await input.waitForReader();
  const socketsClosed = input.closeSocketsAndRemoveSubscriptions();
  await input.closeHttp();
  await socketsClosed;
  await input.releaseOwnership();
}
