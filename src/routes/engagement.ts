import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate } from "../middleware/auth.js";

export const engagementRouter = Router();
engagementRouter.use(authenticate);

engagementRouter.post("/conversations", asyncHandler(async (req, res) => {
  const input = z.object({ jobId: z.string(), participantId: z.string() }).parse(req.body);
  invariant(input.participantId !== req.auth!.userId, 422, "INVALID_PARTICIPANT", "Choose another participant.");
  const job = await prisma.job.findUnique({ where: { id: input.jobId }, include: { proposals: { where: { freelancerId: { in: [req.auth!.userId, input.participantId] } } } } });
  invariant(job && (job.clientId === req.auth!.userId || job.clientId === input.participantId) && job.proposals.length > 0, 403, "CONVERSATION_NOT_ALLOWED", "A proposal relationship is required to start a conversation.");
  const existing = await prisma.conversation.findFirst({ where: { jobId: input.jobId, AND: [{ participants: { some: { userId: req.auth!.userId } } }, { participants: { some: { userId: input.participantId } } }] }, include: { participants: true } });
  if (existing) return res.json({ data: existing });
  const conversation = await prisma.conversation.create({ data: { jobId: input.jobId, participants: { create: [{ userId: req.auth!.userId }, { userId: input.participantId }] } }, include: { participants: true } });
  res.status(201).json({ data: conversation });
}));

engagementRouter.get("/conversations", asyncHandler(async (req, res) => {
  res.json({ data: await prisma.conversation.findMany({ where: { participants: { some: { userId: req.auth!.userId } } }, include: { participants: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } }, messages: { take: 1, orderBy: { createdAt: "desc" } } }, orderBy: { updatedAt: "desc" } }) });
}));

engagementRouter.get("/conversations/:conversationId/messages", asyncHandler(async (req, res) => {
  const input = z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
  const conversationId = routeParam(req.params.conversationId);
  invariant(await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: req.auth!.userId } } }), 404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
  const messages = await prisma.message.findMany({ where: { conversationId, hiddenAt: null }, take: input.limit, ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}), orderBy: { createdAt: "desc" }, include: { sender: { select: { id: true, displayName: true, avatarUrl: true } }, reads: true } });
  res.json({ data: messages, meta: { nextCursor: messages.length === input.limit ? messages.at(-1)?.id : null } });
}));

engagementRouter.post("/conversations/:conversationId/messages", asyncHandler(async (req, res) => {
  const input = z.object({ body: z.string().trim().min(1).max(10_000), attachmentUrls: z.array(z.url()).max(10).default([]) }).parse(req.body);
  const conversationId = routeParam(req.params.conversationId);
  const participant = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: req.auth!.userId } } });
  invariant(participant, 404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({ data: { conversationId, senderId: req.auth!.userId, body: input.body, attachmentsJson: JSON.stringify(input.attachmentUrls), reads: { create: { userId: req.auth!.userId } } } });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    const recipients = await tx.conversationParticipant.findMany({ where: { conversationId, userId: { not: req.auth!.userId } } });
    if (recipients.length) await tx.notification.createMany({ data: recipients.map(({ userId }) => ({ userId, type: "MESSAGE", title: "New message", body: input.body.slice(0, 120), dataJson: JSON.stringify({ conversationId }) })) });
    return created;
  });
  res.status(201).json({ data: message });
}));

engagementRouter.post("/conversations/:conversationId/read", asyncHandler(async (req, res) => {
  const conversationId = routeParam(req.params.conversationId);
  invariant(await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId: req.auth!.userId } } }), 404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
  const unread = await prisma.message.findMany({ where: { conversationId, senderId: { not: req.auth!.userId }, reads: { none: { userId: req.auth!.userId } } }, select: { id: true } });
  if (unread.length) await prisma.messageRead.createMany({ data: unread.map(({ id }) => ({ messageId: id, userId: req.auth!.userId })) });
  res.status(204).send();
}));

engagementRouter.get("/notifications", asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === "true";
  res.json({ data: await prisma.notification.findMany({ where: { userId: req.auth!.userId, ...(unreadOnly ? { readAt: null } : {}) }, take: 100, orderBy: { createdAt: "desc" } }) });
}));

engagementRouter.post("/notifications/read-all", asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } });
  res.status(204).send();
}));

engagementRouter.post("/notifications/:notificationId/read", asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({ where: { id: routeParam(req.params.notificationId), userId: req.auth!.userId }, data: { readAt: new Date() } });
  invariant(result.count === 1, 404, "NOTIFICATION_NOT_FOUND", "Notification not found.");
  res.status(204).send();
}));

engagementRouter.post("/contracts/:contractId/reviews", asyncHandler(async (req, res) => {
  const input = z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(3000).nullable().optional() }).parse(req.body);
  const contract = await prisma.contract.findUnique({ where: { id: routeParam(req.params.contractId) }, include: { reviews: true } });
  invariant(contract && [contract.clientId, contract.freelancerId].includes(req.auth!.userId), 404, "CONTRACT_NOT_FOUND", "Contract not found.");
  invariant(contract.status === "COMPLETED" && contract.completedAt, 409, "REVIEW_NOT_AVAILABLE", "Reviews are available after contract completion.");
  invariant(Date.now() - contract.completedAt.getTime() <= 30 * 24 * 60 * 60 * 1000, 409, "REVIEW_WINDOW_CLOSED", "The review window has closed.");
  const revieweeId = req.auth!.userId === contract.clientId ? contract.freelancerId : contract.clientId;
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({ data: { contractId: contract.id, reviewerId: req.auth!.userId, revieweeId, rating: input.rating, feedback: input.feedback } });
    if (contract.reviews.length === 1) await tx.review.updateMany({ where: { contractId: contract.id }, data: { visibleAt: new Date() } });
    await tx.notification.create({ data: { userId: revieweeId, type: "REVIEW", title: "Review received", body: "Your contract review will be published according to the review window rules.", dataJson: JSON.stringify({ contractId: contract.id }) } });
    return created;
  });
  res.status(201).json({ data: review });
}));

engagementRouter.post("/reports", asyncHandler(async (req, res) => {
  const input = z.object({ targetType: z.enum(["USER", "JOB", "MESSAGE", "PORTFOLIO_ITEM", "REVIEW"]), targetId: z.string(), reason: z.string().trim().min(3).max(120), details: z.string().trim().max(2000).nullable().optional() }).parse(req.body);
  res.status(201).json({ data: await prisma.report.create({ data: { reporterId: req.auth!.userId, ...input } }) });
}));
