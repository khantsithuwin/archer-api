import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).default("file:./prisma/dev.db"),
  JWT_ACCESS_SECRET: z.string().min(32).default("development-access-secret-change-me-now"),
  JWT_REFRESH_SECRET: z.string().min(32).default("development-refresh-secret-change-me-now"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:8081"),
  LOG_LEVEL: z.string().default("info"),
});

export const env = schema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
