import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate } from "../middleware/auth.js";

export const contractsRouter = Router();
contractsRouter.use(authenticate);

const deliverableUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS URL.");

const contractForUser = async (id: string, userId: string) => {
  const contract = await prisma.contract.findUnique({ where: { id }, include: { milestones: { include: { submissions: true }, orderBy: { sortOrder: "asc" } }, events: { orderBy: { createdAt: "desc" } }, job: true, client: { select: { id: true, displayName: true } }, freelancer: { select: { id: true, displayName: true } } } });
  invariant(contract && (contract.clientId === userId || contract.freelancerId === userId), 404, "CONTRACT_NOT_FOUND", "Contract not found.");
  return contract;
};

contractsRouter.get("/contracts", asyncHandler(async (req, res) => {
  res.json({ data: await prisma.contract.findMany({ where: { OR: [{ clientId: req.auth!.userId }, { freelancerId: req.auth!.userId }] }, include: { job: true, client: { select: { id: true, displayName: true, avatarUrl: true } }, freelancer: { select: { id: true, displayName: true, avatarUrl: true } }, milestones: true }, orderBy: { updatedAt: "desc" } }) });
}));

contractsRouter.get("/contracts/:contractId", asyncHandler(async (req, res) => res.json({ data: await contractForUser(routeParam(req.params.contractId), req.auth!.userId) })));

contractsRouter.post("/contracts/:contractId/accept", asyncHandler(async (req, res) => {
  const contract = await contractForUser(routeParam(req.params.contractId), req.auth!.userId);
  invariant(contract.freelancerId === req.auth!.userId, 403, "FORBIDDEN", "Only the hired freelancer can accept this contract.");
  invariant(contract.status === "PENDING_ACCEPTANCE", 409, "INVALID_CONTRACT_STATE", "This contract is not awaiting acceptance.");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE", acceptedAt: new Date(), events: { create: { actorId: req.auth!.userId, type: "CONTRACT_ACCEPTED" } } } });
    await tx.notification.create({ data: { userId: contract.clientId, type: "CONTRACT", title: "Contract accepted", body: `${contract.title} is now active.`, dataJson: JSON.stringify({ contractId: contract.id }) } });
    return item;
  });
  res.json({ data: updated });
}));

contractsRouter.post("/milestones/:milestoneId/submit", asyncHandler(async (req, res) => {
  const input = z.object({ message: z.string().trim().min(3).max(5000), deliverableUrls: z.array(deliverableUrl).max(20).default([]) }).parse(req.body);
  const milestone = await prisma.milestone.findUnique({ where: { id: routeParam(req.params.milestoneId) }, include: { contract: true } });
  invariant(milestone && milestone.contract.freelancerId === req.auth!.userId, 404, "MILESTONE_NOT_FOUND", "Milestone not found.");
  invariant(milestone.contract.status === "ACTIVE" && ["PENDING", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(milestone.status), 409, "INVALID_MILESTONE_STATE", "This milestone cannot be submitted.");
  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.milestoneSubmission.create({ data: { milestoneId: milestone.id, submittedById: req.auth!.userId, message: input.message, deliverablesJson: JSON.stringify(input.deliverableUrls) } });
    await tx.milestone.update({ where: { id: milestone.id }, data: { status: "SUBMITTED" } });
    await tx.contractEvent.create({ data: { contractId: milestone.contractId, actorId: req.auth!.userId, type: "MILESTONE_SUBMITTED", detailsJson: JSON.stringify({ milestoneId: milestone.id, message: input.message, deliverableUrls: input.deliverableUrls }) } });
    await tx.notification.create({ data: { userId: milestone.contract.clientId, type: "MILESTONE", title: "Milestone submitted", body: `${milestone.title} is ready for review.`, dataJson: JSON.stringify({ contractId: milestone.contractId, milestoneId: milestone.id }) } });
    return submission;
  });
  res.status(201).json({ data: result });
}));

contractsRouter.post("/milestones/:milestoneId/review", asyncHandler(async (req, res) => {
  const input = z.object({ decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), message: z.string().trim().max(2000).optional() }).superRefine((value, context) => {
    if (value.decision === "REQUEST_CHANGES" && (!value.message || value.message.length < 10)) context.addIssue({ code: "custom", path: ["message"], message: "Explain the requested changes in at least 10 characters." });
  }).parse(req.body);
  const milestone = await prisma.milestone.findUnique({ where: { id: routeParam(req.params.milestoneId) }, include: { contract: true } });
  invariant(milestone && milestone.contract.clientId === req.auth!.userId, 404, "MILESTONE_NOT_FOUND", "Milestone not found.");
  invariant(milestone.contract.status === "ACTIVE", 409, "INVALID_CONTRACT_STATE", "Only active contracts can have milestone reviews.");
  invariant(milestone.status === "SUBMITTED", 409, "INVALID_MILESTONE_STATE", "Only submitted milestones can be reviewed.");
  const status = input.decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED";
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.milestone.update({ where: { id: milestone.id }, data: { status } });
    await tx.contractEvent.create({ data: { contractId: milestone.contractId, actorId: req.auth!.userId, type: `MILESTONE_${status}`, detailsJson: JSON.stringify({ milestoneId: milestone.id, message: input.message }) } });
    await tx.notification.create({ data: { userId: milestone.contract.freelancerId, type: "MILESTONE", title: status === "APPROVED" ? "Milestone approved" : "Changes requested", body: input.message ?? milestone.title, dataJson: JSON.stringify({ contractId: milestone.contractId, milestoneId: milestone.id }) } });
    return item;
  });
  res.json({ data: updated });
}));

contractsRouter.post("/contracts/:contractId/complete", asyncHandler(async (req, res) => {
  const contract = await contractForUser(routeParam(req.params.contractId), req.auth!.userId);
  invariant(contract.status === "ACTIVE" || contract.status === "COMPLETION_REQUESTED", 409, "INVALID_CONTRACT_STATE", "This contract cannot be completed.");
  invariant(contract.workType === "HOURLY" || contract.milestones.every((item) => item.status === "APPROVED"), 409, "MILESTONES_INCOMPLETE", "All milestones must be approved first.");
  if (req.auth!.userId === contract.freelancerId && contract.status === "ACTIVE") {
    const requested = await prisma.$transaction(async (tx) => {
      const item = await tx.contract.update({ where: { id: contract.id }, data: { status: "COMPLETION_REQUESTED", events: { create: { actorId: req.auth!.userId, type: "COMPLETION_REQUESTED" } } } });
      await tx.notification.create({ data: { userId: contract.clientId, type: "CONTRACT", title: "Completion requested", body: `${contract.title} is ready for your final review.`, dataJson: JSON.stringify({ contractId: contract.id }) } });
      return item;
    });
    res.json({ data: requested });
    return;
  }
  invariant(req.auth!.userId !== contract.freelancerId, 409, "COMPLETION_ALREADY_REQUESTED", "Completion has already been requested.");
  invariant(req.auth!.userId === contract.clientId, 403, "FORBIDDEN", "Only the client can finalize completion.");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.contract.update({ where: { id: contract.id }, data: { status: "COMPLETED", completedAt: new Date(), events: { create: { actorId: req.auth!.userId, type: "CONTRACT_COMPLETED" } } } });
    await tx.job.update({ where: { id: contract.jobId }, data: { status: "COMPLETED" } });
    await tx.notification.create({ data: { userId: contract.freelancerId, type: "CONTRACT", title: "Contract completed", body: `${contract.title} was marked complete.`, dataJson: JSON.stringify({ contractId: contract.id }) } });
    return item;
  });
  res.json({ data: updated });
}));

contractsRouter.post("/contracts/:contractId/cancel", asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(2000) }).parse(req.body);
  const contract = await contractForUser(routeParam(req.params.contractId), req.auth!.userId);
  invariant(["PENDING_ACCEPTANCE", "ACTIVE", "COMPLETION_REQUESTED"].includes(contract.status), 409, "INVALID_CONTRACT_STATE", "This contract cannot be cancelled.");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.contract.update({ where: { id: contract.id }, data: { status: "CANCELLED", events: { create: { actorId: req.auth!.userId, type: "CONTRACT_CANCELLED", detailsJson: JSON.stringify({ reason }) } } } });
    await tx.milestone.updateMany({ where: { contractId: contract.id, status: { not: "APPROVED" } }, data: { status: "CANCELLED" } });
    await tx.job.update({ where: { id: contract.jobId }, data: { status: "CLOSED" } });
    await tx.notification.create({ data: { userId: req.auth!.userId === contract.clientId ? contract.freelancerId : contract.clientId, type: "CONTRACT", title: "Contract cancelled", body: `${contract.title} was cancelled.`, dataJson: JSON.stringify({ contractId: contract.id }) } });
    return item;
  });
  res.json({ data: updated });
}));

contractsRouter.post("/contracts/:contractId/dispute", asyncHandler(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(3000) }).parse(req.body);
  const contract = await contractForUser(routeParam(req.params.contractId), req.auth!.userId);
  invariant(["ACTIVE", "COMPLETION_REQUESTED"].includes(contract.status), 409, "INVALID_CONTRACT_STATE", "This contract cannot be disputed.");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.contract.update({ where: { id: contract.id }, data: { status: "DISPUTED", events: { create: { actorId: req.auth!.userId, type: "CONTRACT_DISPUTED", detailsJson: JSON.stringify({ reason }) } } } });
    await tx.report.create({ data: { reporterId: req.auth!.userId, targetType: "USER", targetId: req.auth!.userId === contract.clientId ? contract.freelancerId : contract.clientId, reason: "Contract dispute", details: `Contract ${contract.id}: ${reason}` } });
    await tx.notification.create({ data: { userId: req.auth!.userId === contract.clientId ? contract.freelancerId : contract.clientId, type: "CONTRACT", title: "Contract disputed", body: `${contract.title} was marked as disputed.`, dataJson: JSON.stringify({ contractId: contract.id }) } });
    return item;
  });
  res.json({ data: updated });
}));
