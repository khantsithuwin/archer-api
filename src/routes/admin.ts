import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate, requireMode } from "../middleware/auth.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requireMode("ADMIN"));

adminRouter.get("/metrics", asyncHandler(async (_req, res) => {
  const [users, openJobs, activeContracts, openReports] = await prisma.$transaction([prisma.user.count(), prisma.job.count({ where: { status: "OPEN" } }), prisma.contract.count({ where: { status: "ACTIVE" } }), prisma.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } })]);
  res.json({ data: { users, openJobs, activeContracts, openReports } });
}));

adminRouter.get("/reports", asyncHandler(async (_req, res) => res.json({ data: await prisma.report.findMany({ include: { reporter: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 100 }) })));

adminRouter.patch("/reports/:reportId", asyncHandler(async (req, res) => {
  const input = z.object({ status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]), internalNote: z.string().trim().max(3000).nullable().optional() }).parse(req.body);
  const reportId = routeParam(req.params.reportId);
  invariant(await prisma.report.findUnique({ where: { id: reportId } }), 404, "REPORT_NOT_FOUND", "Report not found.");
  const report = await prisma.$transaction(async (tx) => {
    const updated = await tx.report.update({ where: { id: reportId }, data: input });
    await tx.adminAuditLog.create({ data: { adminId: req.auth!.userId, action: "REPORT_UPDATED", targetType: "REPORT", targetId: updated.id, detailsJson: JSON.stringify(input) } });
    return updated;
  });
  res.json({ data: report });
}));

adminRouter.post("/users/:userId/status", asyncHandler(async (req, res) => {
  const { status } = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(req.body);
  const userId = routeParam(req.params.userId);
  invariant(userId !== req.auth!.userId, 409, "SELF_MODERATION", "Administrators cannot change their own status here.");
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: userId }, data: { status, tokenVersion: { increment: 1 } } });
    if (status === "SUSPENDED") await tx.session.updateMany({ where: { userId: updated.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.adminAuditLog.create({ data: { adminId: req.auth!.userId, action: `USER_${status}`, targetType: "USER", targetId: updated.id } });
    return updated;
  });
  res.json({ data: { id: user.id, status: user.status } });
}));

adminRouter.post("/contracts/:contractId/resolve-dispute", asyncHandler(async (req, res) => {
  const input = z.object({ resolution: z.enum(["RESUME", "CANCEL"]), note: z.string().trim().min(10).max(2000) }).parse(req.body);
  const contractId = routeParam(req.params.contractId);
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  invariant(contract && contract.status === "DISPUTED", 409, "INVALID_CONTRACT_STATE", "Only disputed contracts can be resolved.");
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.contract.update({ where: { id: contractId }, data: { status: input.resolution === "RESUME" ? "ACTIVE" : "CANCELLED", events: { create: { actorId: req.auth!.userId, type: "DISPUTE_RESOLVED", detailsJson: JSON.stringify(input) } } } });
    if (input.resolution === "CANCEL") {
      await tx.milestone.updateMany({ where: { contractId, status: { not: "APPROVED" } }, data: { status: "CANCELLED" } });
      await tx.job.update({ where: { id: contract.jobId }, data: { status: "CLOSED" } });
    }
    await tx.report.updateMany({ where: { reason: "Contract dispute", details: { startsWith: `Contract ${contractId}:` }, status: { in: ["OPEN", "IN_REVIEW"] } }, data: { status: "RESOLVED", internalNote: input.note } });
    await tx.adminAuditLog.create({ data: { adminId: req.auth!.userId, action: "CONTRACT_DISPUTE_RESOLVED", targetType: "CONTRACT", targetId: contractId, detailsJson: JSON.stringify(input) } });
    await tx.notification.createMany({ data: [contract.clientId, contract.freelancerId].map((userId) => ({ userId, type: "CONTRACT" as const, title: "Dispute resolved", body: `${contract.title} is ${input.resolution === "RESUME" ? "active again" : "cancelled"}.`, dataJson: JSON.stringify({ contractId }) })) });
    return item;
  });
  res.json({ data: { id: updated.id, status: updated.status } });
}));
