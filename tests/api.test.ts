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

describe("contract lifecycle", () => {
  const login = async (email: string) => {
    const response = await request(app).post("/api/v1/auth/login").send({ email, password: "ArcherDemo123!" });
    expect(response.status).toBe(200);
    return response.body.data.accessToken as string;
  };
  const createContract = async (title: string) => {
    const clientToken = await login("client1@archer.local");
    const freelancerToken = await login("freelancer1@archer.local");
    const categories = await request(app).get("/api/v1/categories");
    const category = categories.body.data[0] as { id: string; skills: { id: string }[] };
    const job = await request(app).post("/api/v1/jobs").set("authorization", `Bearer ${clientToken}`).send({
      title, description: "Build a clear, accessible project dashboard with a tested implementation and a documented handoff.",
      categoryId: category.id, skillIds: [category.skills[0]!.id], workType: "FIXED_PRICE", currency: "USD",
      budgetMinMinor: 12000, budgetMaxMinor: 25000, experienceLevel: "INTERMEDIATE",
    });
    expect(job.status).toBe(201);
    const jobId = job.body.data.id as string;
    expect((await request(app).post(`/api/v1/jobs/${jobId}/publish`).set("authorization", `Bearer ${clientToken}`).send({})).status).toBe(200);
    const proposal = await request(app).post(`/api/v1/jobs/${jobId}/proposals`).set("authorization", `Bearer ${freelancerToken}`).send({
      coverLetter: "I can deliver this dashboard with clear milestones, accessible components, tested behavior, and regular progress updates.", amountMinor: 15005,
    });
    expect(proposal.status).toBe(201);
    const offer = await request(app).post(`/api/v1/proposals/${proposal.body.data.id}/accept`).set("authorization", `Bearer ${clientToken}`).send({});
    expect(offer.status).toBe(201);
    expect(offer.body.data.status).toBe("PENDING_ACCEPTANCE");
    return { clientToken, freelancerToken, jobId, contractId: offer.body.data.id as string, milestoneId: offer.body.data.milestones[0].id as string };
  };
  const cleanup = async (jobId: string, contractId: string, title: string) => {
    await prisma.notification.deleteMany({ where: { OR: [{ body: { contains: title } }, { dataJson: { contains: contractId } }] } });
    await prisma.report.deleteMany({ where: { details: { contains: contractId } } });
    await prisma.adminAuditLog.deleteMany({ where: { targetType: "CONTRACT", targetId: contractId } });
    await prisma.contract.delete({ where: { id: contractId } });
    await prisma.proposal.deleteMany({ where: { jobId } });
    await prisma.job.delete({ where: { id: jobId } });
  };

  it("submits, revises, approves, and completes fixed-price work with ownership checks", async () => {
    const title = `Contract completion ${Date.now()}`;
    const { clientToken, freelancerToken, jobId, contractId, milestoneId } = await createContract(title);
    try {
      const otherToken = await login("freelancer2@archer.local");
      expect((await request(app).get(`/api/v1/contracts/${contractId}`).set("authorization", `Bearer ${otherToken}`)).status).toBe(404);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/accept`).set("authorization", `Bearer ${clientToken}`).send({})).status).toBe(403);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/accept`).set("authorization", `Bearer ${freelancerToken}`).send({})).body.data.status).toBe("ACTIVE");
      expect((await request(app).post(`/api/v1/contracts/${contractId}/complete`).set("authorization", `Bearer ${freelancerToken}`).send({})).status).toBe(409);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/complete`).set("authorization", `Bearer ${clientToken}`).send({})).status).toBe(409);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${otherToken}`).send({ message: "Ready for review" })).status).toBe(404);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Ready for review", deliverableUrls: ["javascript:alert(1)"] })).status).toBe(422);
      const submitted = await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Initial dashboard delivery is ready.", deliverableUrls: ["https://example.com/delivery"] });
      expect(submitted.status).toBe(201);
      const work = await request(app).get(`/api/v1/contracts/${contractId}`).set("authorization", `Bearer ${clientToken}`);
      expect(work.body.data.milestones[0].status).toBe("SUBMITTED");
      expect(JSON.parse(work.body.data.milestones[0].submissions[0].deliverablesJson)).toEqual(["https://example.com/delivery"]);
      expect(work.body.data.events.some((event: { type: string }) => event.type === "MILESTONE_SUBMITTED")).toBe(true);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/review`).set("authorization", `Bearer ${clientToken}`).send({ decision: "REQUEST_CHANGES", message: "Too short" })).status).toBe(422);
      const changes = await request(app).post(`/api/v1/milestones/${milestoneId}/review`).set("authorization", `Bearer ${clientToken}`).send({ decision: "REQUEST_CHANGES", message: "Please improve keyboard navigation." });
      expect(changes.body.data.status).toBe("CHANGES_REQUESTED");
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Keyboard navigation has been updated." })).status).toBe(201);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/review`).set("authorization", `Bearer ${clientToken}`).send({ decision: "APPROVE", message: "Looks good." })).body.data.status).toBe("APPROVED");
      expect((await request(app).post(`/api/v1/contracts/${contractId}/complete`).set("authorization", `Bearer ${freelancerToken}`).send({})).body.data.status).toBe("COMPLETION_REQUESTED");
      expect((await request(app).post(`/api/v1/contracts/${contractId}/complete`).set("authorization", `Bearer ${freelancerToken}`).send({})).status).toBe(409);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/complete`).set("authorization", `Bearer ${clientToken}`).send({})).body.data.status).toBe("COMPLETED");
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${clientToken}`)).body.data.status).toBe("COMPLETED");
      expect((await request(app).post(`/api/v1/contracts/${contractId}/cancel`).set("authorization", `Bearer ${clientToken}`).send({ reason: "This project is no longer needed." })).status).toBe(409);
    } finally { await cleanup(jobId, contractId, title); }
  });

  it("cancels an offer with a reason and closes unfinished work", async () => {
    const title = `Contract cancellation ${Date.now()}`;
    const { freelancerToken, clientToken, jobId, contractId, milestoneId } = await createContract(title);
    try {
      expect((await request(app).post(`/api/v1/contracts/${contractId}/cancel`).set("authorization", `Bearer ${freelancerToken}`).send({ reason: "Too short" })).status).toBe(422);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/dispute`).set("authorization", `Bearer ${freelancerToken}`).send({ reason: "The agreed work cannot continue." })).status).toBe(409);
      const cancelled = await request(app).post(`/api/v1/contracts/${contractId}/cancel`).set("authorization", `Bearer ${freelancerToken}`).send({ reason: "The agreed work cannot continue." });
      expect(cancelled.body.data.status).toBe("CANCELLED");
      const detail = await request(app).get(`/api/v1/contracts/${contractId}`).set("authorization", `Bearer ${clientToken}`);
      expect(detail.body.data.milestones[0].status).toBe("CANCELLED");
      expect(detail.body.data.events.some((event: { type: string; detailsJson: string }) => event.type === "CONTRACT_CANCELLED" && JSON.parse(event.detailsJson).reason === "The agreed work cannot continue.")).toBe(true);
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${clientToken}`)).body.data.status).toBe("CLOSED");
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Work ready" })).status).toBe(409);
    } finally { await cleanup(jobId, contractId, title); }
  });

  it("pauses a disputed contract and links the moderation report", async () => {
    const title = `Contract dispute ${Date.now()}`;
    const { clientToken, freelancerToken, jobId, contractId, milestoneId } = await createContract(title);
    try {
      expect((await request(app).post(`/api/v1/contracts/${contractId}/accept`).set("authorization", `Bearer ${freelancerToken}`).send({})).status).toBe(200);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Initial delivery is ready for review." })).status).toBe(201);
      const disputed = await request(app).post(`/api/v1/contracts/${contractId}/dispute`).set("authorization", `Bearer ${clientToken}`).send({ reason: "The agreed delivery has stopped without an update." });
      expect(disputed.body.data.status).toBe("DISPUTED");
      expect(await prisma.report.count({ where: { details: { contains: contractId } } })).toBe(1);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/review`).set("authorization", `Bearer ${clientToken}`).send({ decision: "APPROVE" })).status).toBe(409);
      expect((await request(app).post(`/api/v1/milestones/${milestoneId}/submit`).set("authorization", `Bearer ${freelancerToken}`).send({ message: "Work ready" })).status).toBe(409);
      expect((await request(app).post(`/api/v1/contracts/${contractId}/cancel`).set("authorization", `Bearer ${clientToken}`).send({ reason: "The agreed work cannot continue." })).status).toBe(409);
      const adminToken = await login("admin@archer.local");
      expect((await request(app).post(`/api/v1/admin/contracts/${contractId}/resolve-dispute`).set("authorization", `Bearer ${clientToken}`).send({ resolution: "RESUME", note: "We reviewed the delivery issue." })).status).toBe(403);
      expect((await request(app).post(`/api/v1/admin/contracts/${contractId}/resolve-dispute`).set("authorization", `Bearer ${adminToken}`).send({ resolution: "RESUME", note: "Too short" })).status).toBe(422);
      const resumed = await request(app).post(`/api/v1/admin/contracts/${contractId}/resolve-dispute`).set("authorization", `Bearer ${adminToken}`).send({ resolution: "RESUME", note: "The project may safely continue." });
      expect(resumed.body.data.status).toBe("ACTIVE");
      expect((await prisma.report.findFirst({ where: { details: { contains: contractId } } }))?.status).toBe("RESOLVED");
      expect((await request(app).post(`/api/v1/contracts/${contractId}/dispute`).set("authorization", `Bearer ${freelancerToken}`).send({ reason: "The project cannot continue safely." })).body.data.status).toBe("DISPUTED");
      const cancelled = await request(app).post(`/api/v1/admin/contracts/${contractId}/resolve-dispute`).set("authorization", `Bearer ${adminToken}`).send({ resolution: "CANCEL", note: "The project should be closed after review." });
      expect(cancelled.body.data.status).toBe("CANCELLED");
      expect((await request(app).get(`/api/v1/client/jobs/${jobId}`).set("authorization", `Bearer ${clientToken}`)).body.data.status).toBe("CLOSED");
      expect(await prisma.report.count({ where: { details: { contains: contractId }, status: "RESOLVED" } })).toBe(2);
      expect(await prisma.adminAuditLog.count({ where: { targetType: "CONTRACT", targetId: contractId } })).toBe(2);
    } finally { await cleanup(jobId, contractId, title); }
  });
});
