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

describe("both-role demo and proposal lifecycle", () => {
  const login = async (email: string) => {
    const response = await request(app).post("/api/v1/auth/login").send({ email, password: "ArcherDemo123!" });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  };

  it("provides connected client and freelancer data for the both-role demo", async () => {
    const token = await login("both@archer.local");
    const me = await request(app).get("/api/v1/auth/me").set("authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.modes.map((entry: { mode: string }) => entry.mode).sort()).toEqual(["CLIENT", "FREELANCER"]);
    expect(me.body.data.clientProfile).not.toBeNull();
    expect(me.body.data.freelancerProfile).not.toBeNull();
    const jobs = await request(app).get("/api/v1/client/jobs").set("authorization", `Bearer ${token}`);
    const proposals = await request(app).get("/api/v1/proposals").set("authorization", `Bearer ${token}`);
    expect(jobs.body.data.some((job: { id: string }) => job.id === "job_both_demo")).toBe(true);
    expect(proposals.body.data.some((proposal: { id: string }) => proposal.id === "proposal_both_demo")).toBe(true);
    const incoming = await request(app).get("/api/v1/jobs/job_both_demo/proposals").set("authorization", `Bearer ${token}`);
    expect(incoming.status).toBe(200);
    expect(incoming.body.data.some((proposal: { id: string; freelancerId: string }) => proposal.id === "proposal_to_both_demo" && proposal.freelancerId === "usr_freelancer_1")).toBe(true);
  });

  it("allows owner edits and withdrawal plus client shortlist and rejection", async () => {
    const clientToken = await login("client1@archer.local");
    const bothToken = await login("both@archer.local");
    const otherFreelancerToken = await login("freelancer2@archer.local");
    const categories = await request(app).get("/api/v1/categories");
    const category = categories.body.data[0] as { id: string; skills: { id: string }[] };
    const title = `Proposal lifecycle ${Date.now()}`;
    const created = await request(app).post("/api/v1/jobs").set("authorization", `Bearer ${clientToken}`).send({
      title, description: "Create a clear, accessible dashboard for a small team with tested and maintainable code.",
      categoryId: category.id, skillIds: [category.skills[0]!.id], workType: "FIXED_PRICE", currency: "USD",
      budgetMinMinor: 10000, budgetMaxMinor: 30000, experienceLevel: "INTERMEDIATE",
    });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id as string;
    try {
      expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set("authorization", `Bearer ${clientToken}`).send({})).status).toBe(200);
      const coverLetter = "I can deliver this dashboard with accessible design, tested code, and clear progress updates throughout the project.";
      expect((await request(app).post(`/api/v1/jobs/${jobId}/proposals`).set("authorization", `Bearer ${bothToken}`).send({ coverLetter, amountMinor: 2_000_000_001 })).status).toBe(422);
      const createdProposal = await request(app).post(`/api/v1/jobs/${jobId}/proposals`).set("authorization", `Bearer ${bothToken}`).send({ coverLetter, amountMinor: 12505 });
      expect(createdProposal.status).toBe(201);
      const proposalId = createdProposal.body.data.id as string;
      expect((await request(app).get(`/api/v1/proposals/${proposalId}`).set("authorization", `Bearer ${bothToken}`)).body.data.amountMinor).toBe(12505);
      expect((await request(app).get(`/api/v1/proposals/${proposalId}`).set("authorization", `Bearer ${otherFreelancerToken}`)).status).toBe(404);
      expect((await request(app).get(`/api/v1/proposals/${proposalId}`).set("authorization", `Bearer ${clientToken}`)).status).toBe(403);
      const edited = await request(app).patch(`/api/v1/proposals/${proposalId}`).set("authorization", `Bearer ${bothToken}`).send({ amountMinor: 13005 });
      expect(edited.status).toBe(200);
      expect(edited.body.data.amountMinor).toBe(13005);
      expect((await request(app).post(`/api/v1/proposals/${proposalId}/shortlist`).set("authorization", `Bearer ${clientToken}`).send({})).body.data.status).toBe("SHORTLISTED");
      expect((await request(app).post(`/api/v1/proposals/${proposalId}/reject`).set("authorization", `Bearer ${clientToken}`).send({})).body.data.status).toBe("REJECTED");
      expect((await request(app).patch(`/api/v1/proposals/${proposalId}`).set("authorization", `Bearer ${bothToken}`).send({ amountMinor: 14005 })).status).toBe(409);
      const otherProposal = await request(app).post(`/api/v1/jobs/${jobId}/proposals`).set("authorization", `Bearer ${otherFreelancerToken}`).send({ coverLetter, amountMinor: 14005 });
      expect(otherProposal.status).toBe(201);
      expect((await request(app).post(`/api/v1/proposals/${otherProposal.body.data.id}/withdraw`).set("authorization", `Bearer ${otherFreelancerToken}`).send({})).body.data.status).toBe("WITHDRAWN");
    } finally {
      await prisma.notification.deleteMany({ where: { body: { contains: title } } });
      await prisma.proposal.deleteMany({ where: { jobId } });
      await prisma.job.delete({ where: { id: jobId } });
    }
  });
});
