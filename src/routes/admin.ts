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
