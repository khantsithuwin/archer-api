import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { corsOrigins, env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { contractsRouter } from "./routes/contracts.js";
import { engagementRouter } from "./routes/engagement.js";
import { jobsRouter } from "./routes/jobs.js";
import { profilesRouter } from "./routes/profiles.js";
import { proposalsRouter } from "./routes/proposals.js";

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({
    level: env.LOG_LEVEL,
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    genReqId: (req, res) => { const id = req.headers["x-request-id"]?.toString() ?? randomUUID(); res.setHeader("x-request-id", id); return id; },
  }));
  app.use((req, _res, next) => { req.requestId = String(req.id); next(); });

  app.get("/api/v1/health/live", (_req, res) => res.json({ data: { status: "ok" } }));
  app.get("/api/v1/health/ready", async (_req, res, next) => { try { const { prisma } = await import("./lib/prisma.js"); await prisma.$queryRaw`SELECT 1`; res.json({ data: { status: "ready" } }); } catch (error) { next(error); } });
  app.get("/api/v1/openapi.yaml", (_req, res) => res.sendFile("openapi.yaml", { root: process.cwd() }));
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", profilesRouter, jobsRouter, proposalsRouter, contractsRouter, engagementRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use(notFound, errorHandler);
  return app;
};
