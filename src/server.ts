import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const server = createServer(createApp());
server.listen(env.PORT, () => console.log(`Archer API listening on http://localhost:${env.PORT}/api/v1`));

const shutdown = (signal: string) => {
  console.log(`${signal} received; shutting down.`);
  server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
