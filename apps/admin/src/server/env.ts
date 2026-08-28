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

  // Required, with no fallback. The other two values in this function throw
  // when they are wrong; this one used to guess, and guessing where the data
  // lives is worse than guessing a port. An unset variable used to open a
  // second, empty store at a relative path — one shipped that way and grew to
  // 257 MB beside the real one before anybody noticed, because nothing about it
  // looks like a failure: the service starts, and simply knows no accounts.
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set to the admin PostgreSQL database");

  return { port: parsedPort, nodeEnv, databaseUrl };
}
