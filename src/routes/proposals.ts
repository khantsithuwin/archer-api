import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate, requireMode } from "../middleware/auth.js";

export const proposalsRouter = Router();

proposalsRouter.post("/jobs/:jobId/proposals", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const input = z.object({ coverLetter: z.string().trim().min(40).max(5000), amountMinor: z.number().int().positive().max(2_000_000_000), estimatedDuration: z.string().trim().max(80).nullable().optional(), milestones: z.array(z.object({ title: z.string().trim().min(2).max(120), amountMinor: z.number().int().positive().max(2_000_000_000), dueAt: z.coerce.date().nullable().optional() })).max(20).default([]) }).parse(req.body);
  const job = await prisma.job.findUnique({ where: { id: routeParam(req.params.jobId) } });
  invariant(job && job.status === "OPEN", 404, "JOB_NOT_FOUND", "Open job not found.");
  invariant(job.clientId !== req.auth!.userId, 403, "OWN_JOB", "You cannot propose to your own job.");
  invariant(await prisma.freelancerProfile.findUnique({ where: { userId: req.auth!.userId } }), 409, "PROFILE_REQUIRED", "Complete your freelancer profile before submitting proposals.");
  invariant(!await prisma.proposal.findUnique({ where: { jobId_freelancerId: { jobId: job.id, freelancerId: req.auth!.userId } } }), 409, "PROPOSAL_EXISTS", "You already submitted a proposal for this job.");
  if (job.workType === "FIXED_PRICE" && input.milestones.length) invariant(input.milestones.reduce((sum, item) => sum + item.amountMinor, 0) === input.amountMinor, 422, "MILESTONE_TOTAL_MISMATCH", "Milestone amounts must equal the proposal amount.");
  const proposal = await prisma.$transaction(async (tx) => {
    const created = await tx.proposal.create({ data: { jobId: job.id, freelancerId: req.auth!.userId, coverLetter: input.coverLetter, amountMinor: input.amountMinor, currency: job.currency, estimatedDuration: input.estimatedDuration, milestones: { create: input.milestones.map((item, sortOrder) => ({ ...item, sortOrder })) } }, include: { milestones: true } });
    await tx.notification.create({ data: { userId: job.clientId, type: "PROPOSAL", title: "New proposal", body: `A freelancer submitted a proposal for ${job.title}.`, dataJson: JSON.stringify({ jobId: job.id, proposalId: created.id }) } });
    return created;
  });
  res.status(201).json({ data: proposal });
}));

proposalsRouter.get("/proposals", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  res.json({ data: await prisma.proposal.findMany({ where: { freelancerId: req.auth!.userId }, include: { job: { include: { category: true } }, milestones: true, contract: true }, orderBy: { createdAt: "desc" } }) });
}));

proposalsRouter.get("/proposals/:proposalId", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const proposal = await prisma.proposal.findFirst({ where: { id: routeParam(req.params.proposalId), freelancerId: req.auth!.userId }, include: { job: { include: { category: true } }, milestones: true, contract: true } });
  invariant(proposal, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  res.json({ data: proposal });
}));

proposalsRouter.patch("/proposals/:proposalId", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const input = z.object({ coverLetter: z.string().trim().min(40).max(5000).optional(), amountMinor: z.number().int().positive().max(2_000_000_000).optional(), estimatedDuration: z.string().trim().max(80).nullable().optional() }).parse(req.body);
  const proposal = await prisma.proposal.findUnique({ where: { id: routeParam(req.params.proposalId) } });
  invariant(proposal && proposal.freelancerId === req.auth!.userId, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  invariant(["SUBMITTED", "SHORTLISTED"].includes(proposal.status), 409, "INVALID_PROPOSAL_STATE", "This proposal can no longer be edited.");
  res.json({ data: await prisma.proposal.update({ where: { id: proposal.id }, data: input }) });
}));

proposalsRouter.get("/jobs/:jobId/proposals", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: routeParam(req.params.jobId) } });
  invariant(job && job.clientId === req.auth!.userId, 404, "JOB_NOT_FOUND", "Job not found.");
  res.json({ data: await prisma.proposal.findMany({ where: { jobId: job.id }, include: { freelancer: { select: { id: true, displayName: true, avatarUrl: true, country: true, freelancerProfile: { include: { skills: { include: { skill: true } } } } } }, milestones: true, contract: true }, orderBy: { createdAt: "desc" } }) });
}));

proposalsRouter.post("/proposals/:proposalId/shortlist", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const proposal = await prisma.proposal.findUnique({ where: { id: routeParam(req.params.proposalId) }, include: { job: true } });
  invariant(proposal && proposal.job.clientId === req.auth!.userId, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  invariant(proposal.status === "SUBMITTED", 409, "INVALID_PROPOSAL_STATE", "Only submitted proposals can be shortlisted.");
  res.json({ data: await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "SHORTLISTED", freelancer: { update: { notifications: { create: { type: "PROPOSAL", title: "Proposal shortlisted", body: `Your proposal for ${proposal.job.title} was shortlisted.`, dataJson: JSON.stringify({ proposalId: proposal.id }) } } } } } }) });
}));

proposalsRouter.post("/proposals/:proposalId/withdraw", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const proposal = await prisma.proposal.findUnique({ where: { id: routeParam(req.params.proposalId) } });
  invariant(proposal && proposal.freelancerId === req.auth!.userId, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  invariant(["SUBMITTED", "SHORTLISTED"].includes(proposal.status), 409, "INVALID_PROPOSAL_STATE", "This proposal cannot be withdrawn.");
  res.json({ data: await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "WITHDRAWN" } }) });
}));

proposalsRouter.post("/proposals/:proposalId/reject", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const proposal = await prisma.proposal.findUnique({ where: { id: routeParam(req.params.proposalId) }, include: { job: true } });
  invariant(proposal && proposal.job.clientId === req.auth!.userId, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  invariant(["SUBMITTED", "SHORTLISTED"].includes(proposal.status), 409, "INVALID_PROPOSAL_STATE", "This proposal cannot be rejected.");
  res.json({ data: await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "REJECTED", freelancer: { update: { notifications: { create: { type: "PROPOSAL", title: "Proposal update", body: `Your proposal for ${proposal.job.title} was not selected.`, dataJson: JSON.stringify({ proposalId: proposal.id }) } } } } } }) });
}));

proposalsRouter.post("/proposals/:proposalId/accept", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(3).max(150).optional() }).parse(req.body);
  const proposal = await prisma.proposal.findUnique({ where: { id: routeParam(req.params.proposalId) }, include: { job: true, milestones: { orderBy: { sortOrder: "asc" } } } });
  invariant(proposal && proposal.job.clientId === req.auth!.userId, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  invariant(["SUBMITTED", "SHORTLISTED"].includes(proposal.status) && proposal.job.status === "OPEN", 409, "INVALID_PROPOSAL_STATE", "This proposal cannot be accepted.");
  const contract = await prisma.$transaction(async (tx) => {
    await tx.proposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED" } });
    await tx.proposal.updateMany({ where: { jobId: proposal.jobId, id: { not: proposal.id }, status: { in: ["SUBMITTED", "SHORTLISTED"] } }, data: { status: "REJECTED" } });
    await tx.job.update({ where: { id: proposal.jobId }, data: { status: "IN_PROGRESS" } });
    const defaultMilestones = proposal.job.workType === "FIXED_PRICE" && proposal.milestones.length === 0 ? [{ title: "Project delivery", amountMinor: proposal.amountMinor, dueAt: null, sortOrder: 0 }] : proposal.milestones;
    const created = await tx.contract.create({ data: { jobId: proposal.jobId, proposalId: proposal.id, clientId: proposal.job.clientId, freelancerId: proposal.freelancerId, title: input.title ?? proposal.job.title, workType: proposal.job.workType, currency: proposal.currency, amountMinor: proposal.amountMinor, termsSnapshot: JSON.stringify({ job: { title: proposal.job.title, description: proposal.job.description }, proposal: { coverLetter: proposal.coverLetter, estimatedDuration: proposal.estimatedDuration } }), milestones: { create: defaultMilestones.map((item) => ({ title: item.title, amountMinor: item.amountMinor, dueAt: item.dueAt, sortOrder: item.sortOrder })) }, events: { create: { actorId: req.auth!.userId, type: "CONTRACT_OFFERED" } } }, include: { milestones: true } });
    await tx.notification.create({ data: { userId: proposal.freelancerId, type: "CONTRACT", title: "Contract offer", body: `You received a contract offer for ${proposal.job.title}.`, dataJson: JSON.stringify({ contractId: created.id }) } });
    return created;
  });
  res.status(201).json({ data: contract });
}));
