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

describe("client job lifecycle", () => {
  it("keeps drafts private, lets the owner edit and publish, then close", async () => {
    const login = async (email: string) => {
      const response = await request(app).post("/api/v1/auth/login").send({ email, password: "ArcherDemo123!" });
      expect(response.status).toBe(200);
      return response.body.data.accessToken as string;
    };
    const ownerToken = await login("client1@archer.local");
    const otherToken = await login("client2@archer.local");
    const freelancerToken = await login("freelancer1@archer.local");
    const categories = await request(app).get("/api/v1/categories");
    const category = categories.body.data[0] as { id: string; skills: { id: string }[] };
    expect(category.skills.length).toBeGreaterThan(0);
    const created = await request(app).post("/api/v1/jobs").set("authorization", `Bearer ${ownerToken}`).send({
      title: "Build a research dashboard", description: "Create a clear research dashboard for a small product team with tested, maintainable code.",
      categoryId: category.id, skillIds: [category.skills[0]!.id], workType: "FIXED_PRICE", currency: "USD",
      budgetMinMinor: 12505, budgetMaxMinor: 25000, experienceLevel: "INTERMEDIATE",
    });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id as string;
    try {
      const owned = await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${ownerToken}`);
      expect(owned.status).toBe(200);
      expect(owned.body.data.status).toBe("DRAFT");
      expect((await request(app).get(`/api/v1/jobs/${jobId}`)).status).toBe(404);
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`)).status).toBe(401);
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${freelancerToken}`)).status).toBe(403);
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${otherToken}`)).status).toBe(404);
      expect((await request(app).patch(`/api/v1/jobs/${jobId}`).set("authorization", `Bearer ${otherToken}`).send({ title: "Unauthorized update" })).status).toBe(404);
      const edited = await request(app).patch(`/api/v1/jobs/${jobId}`).set("authorization", `Bearer ${ownerToken}`).send({ title: "Build a better research dashboard", budgetMaxMinor: 30000 });
      expect(edited.status).toBe(200);
      expect(edited.body.data.title).toBe("Build a better research dashboard");
      const published = await request(app).post(`/api/v1/jobs/${jobId}/publish`).set("authorization", `Bearer ${ownerToken}`).send({});
      expect(published.status).toBe(200);
      expect(published.body.data.status).toBe("OPEN");
      expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set("authorization", `Bearer ${ownerToken}`).send({})).status).toBe(409);
      const publicJob = await request(app).get(`/api/v1/jobs/${jobId}`);
      expect(publicJob.status).toBe(200);
      expect(publicJob.body.data.budgetMinMinor).toBe(12505);
      expect((await request(app).post(`/api/v1/jobs/${jobId}/close`).set("authorization", `Bearer ${ownerToken}`).send({})).status).toBe(204);
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${ownerToken}`)).body.data.status).toBe("CLOSED");
    } finally {
      await prisma.job.delete({ where: { id: jobId } });
    }
  });
});
