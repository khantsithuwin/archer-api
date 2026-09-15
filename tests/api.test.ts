import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
afterAll(() => prisma.$disconnect());

describe("Archer API", () => {
  it("reports liveness and readiness", async () => {
    expect((await request(app).get("/api/v1/health/live")).status).toBe(200);
    expect((await request(app).get("/api/v1/health/ready")).status).toBe(200);
  });

  it("rejects invalid credentials with the stable error envelope", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({ email: "nobody@example.com", password: "incorrect-password" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(response.body.error.requestId).toBeTypeOf("string");
  });

  it("logs in a seeded admin and authorizes metrics", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@archer.local", password: "ArcherDemo123!" });
    expect(login.status).toBe(200);
    const response = await request(app).get("/api/v1/admin/metrics").set("authorization", `Bearer ${login.body.data.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.users).toBeGreaterThanOrEqual(311);
    expect(response.body.data.openJobs).toBeGreaterThanOrEqual(250);
  });

  it("filters and paginates public jobs", async () => {
    const response = await request(app).get("/api/v1/jobs").query({ currency: "USD", limit: 5 });
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(5);
    expect(response.body.data.every((job: { currency: string }) => job.currency === "USD")).toBe(true);
    expect(response.body.meta.total).toBeGreaterThan(0);
  });
});
