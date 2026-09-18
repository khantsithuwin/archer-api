import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { ensureBothDemo } from "./ensure-both-demo.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo accounts cannot be added in production.");

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" }) });
try {
  const result = await ensureBothDemo(prisma, await bcrypt.hash("ArcherDemo123!", 10));
  console.log("Both-role demo account ready:", result);
} finally {
  await prisma.$disconnect();
}
