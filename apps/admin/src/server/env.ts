export type ServerEnv = {
  port: number;
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
};

export function readEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const rawPort = source.PORT;
  const parsedPort = Number(rawPort);

  if (!Number.isInteger(parsedPort) || parsedPort < 10000 || parsedPort > 59999) {
    throw new Error("PORT must be an integer from 10000 to 59999");
  }

  const nodeEnv = source.NODE_ENV ?? "development";
  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  return {
    port: parsedPort,
    nodeEnv,
    databaseUrl: source.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15432/ndx_business"
  };
}
