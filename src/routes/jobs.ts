import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate, requireMode } from "../middleware/auth.js";

export const jobsRouter = Router();
const money = z.number().int().positive().max(2_000_000_000);
const jobFields = z.object({
  categoryId: z.string().min(1), title: z.string().trim().min(8).max(150), description: z.string().trim().min(40).max(20_000),
  workType: z.enum(["FIXED_PRICE", "HOURLY"]), currency: z.enum(["USD", "MMK"]), budgetMinMinor: money, budgetMaxMinor: money,
  experienceLevel: z.enum(["ENTRY", "INTERMEDIATE", "EXPERT"]), estimatedDuration: z.string().trim().max(80).nullable().optional(),
  applicationDeadline: z.coerce.date().nullable().optional(), skillIds: z.array(z.string()).min(1).max(20),
});
const jobInput = jobFields.refine((data) => data.budgetMaxMinor >= data.budgetMinMinor, { path: ["budgetMaxMinor"], message: "Maximum budget must be at least the minimum budget." });

jobsRouter.get("/categories", asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.category.findMany({ include: { skills: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }) });
}));

jobsRouter.get("/jobs", asyncHandler(async (req, res) => {
  const input = z.object({ q: z.string().trim().optional(), category: z.string().optional(), skill: z.string().optional(), workType: z.enum(["FIXED_PRICE", "HOURLY"]).optional(), currency: z.enum(["USD", "MMK"]).optional(), experienceLevel: z.enum(["ENTRY", "INTERMEDIATE", "EXPERT"]).optional(), min: z.coerce.number().int().positive().optional(), max: z.coerce.number().int().positive().optional(), sort: z.enum(["newest", "budget_high", "budget_low"]).default("newest"), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
  const where = { status: "OPEN" as const, ...(input.q ? { OR: [{ title: { contains: input.q } }, { description: { contains: input.q } }] } : {}), ...(input.category ? { category: { slug: input.category } } : {}), ...(input.skill ? { skills: { some: { skill: { slug: input.skill } } } } : {}), ...(input.workType ? { workType: input.workType } : {}), ...(input.currency ? { currency: input.currency } : {}), ...(input.experienceLevel ? { experienceLevel: input.experienceLevel } : {}), ...(input.min ? { budgetMaxMinor: { gte: input.min } } : {}), ...(input.max ? { budgetMinMinor: { lte: input.max } } : {}) };
  const orderBy = input.sort === "budget_high" ? { budgetMaxMinor: "desc" as const } : input.sort === "budget_low" ? { budgetMinMinor: "asc" as const } : { publishedAt: "desc" as const };
  const [items, total] = await prisma.$transaction([prisma.job.findMany({ where, orderBy, skip: (input.page - 1) * input.limit, take: input.limit, include: { category: true, skills: { include: { skill: true } }, client: { select: { id: true, displayName: true, avatarUrl: true, country: true, createdAt: true } }, _count: { select: { proposals: true } } } }), prisma.job.count({ where })]);
  res.json({ data: items, meta: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } });
}));

jobsRouter.get("/client/jobs", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  res.json({ data: await prisma.job.findMany({ where: { clientId: req.auth!.userId }, include: { category: true, skills: { include: { skill: true } }, _count: { select: { proposals: true } } }, orderBy: { updatedAt: "desc" } }) });
}));

jobsRouter.get("/jobs/:jobId", asyncHandler(async (req, res) => {
  const job = await prisma.job.findFirst({ where: { id: routeParam(req.params.jobId), status: { notIn: ["DRAFT", "HIDDEN"] } }, include: { category: true, skills: { include: { skill: true } }, client: { select: { id: true, displayName: true, avatarUrl: true, country: true, createdAt: true } }, _count: { select: { proposals: true } } } });
  invariant(job, 404, "JOB_NOT_FOUND", "Job not found.");
  res.json({ data: job });
}));

jobsRouter.post("/jobs", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const input = jobInput.parse(req.body);
  const { skillIds, ...data } = input;
  const job = await prisma.job.create({ data: { ...data, clientId: req.auth!.userId, skills: { create: [...new Set(skillIds)].map((skillId) => ({ skillId })) } }, include: { category: true, skills: { include: { skill: true } } } });
  res.status(201).json({ data: job });
}));

jobsRouter.patch("/jobs/:jobId", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const input = jobFields.partial().refine((data) => data.budgetMinMinor === undefined || data.budgetMaxMinor === undefined || data.budgetMaxMinor >= data.budgetMinMinor, { path: ["budgetMaxMinor"], message: "Maximum budget must be at least the minimum budget." }).parse(req.body);
  const existing = await prisma.job.findUnique({ where: { id: routeParam(req.params.jobId) }, include: { _count: { select: { proposals: true } } } });
  invariant(existing && existing.clientId === req.auth!.userId, 404, "JOB_NOT_FOUND", "Job not found.");
  invariant(existing.status === "DRAFT" || existing._count.proposals === 0, 409, "JOB_LOCKED", "A job with proposals can no longer be materially edited.");
  const { skillIds, ...data } = input;
  const job = await prisma.$transaction(async (tx) => {
    if (skillIds) { await tx.jobSkill.deleteMany({ where: { jobId: existing.id } }); await tx.jobSkill.createMany({ data: [...new Set(skillIds)].map((skillId) => ({ jobId: existing.id, skillId })) }); }
    return tx.job.update({ where: { id: existing.id }, data, include: { category: true, skills: { include: { skill: true } } } });
  });
  res.json({ data: job });
}));

jobsRouter.post("/jobs/:jobId/publish", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const job = await prisma.job.findUnique({ where: { id: routeParam(req.params.jobId) }, include: { skills: true } });
  invariant(job && job.clientId === req.auth!.userId, 404, "JOB_NOT_FOUND", "Job not found.");
  invariant(job.status === "DRAFT" || job.status === "PAUSED", 409, "INVALID_JOB_STATE", "Only draft or paused jobs can be published.");
  invariant(job.skills.length > 0, 422, "JOB_INCOMPLETE", "At least one skill is required.");
  res.json({ data: await prisma.job.update({ where: { id: job.id }, data: { status: "OPEN", publishedAt: job.publishedAt ?? new Date() } }) });
}));

jobsRouter.post("/jobs/:jobId/close", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const result = await prisma.job.updateMany({ where: { id: routeParam(req.params.jobId), clientId: req.auth!.userId, status: { in: ["OPEN", "PAUSED"] } }, data: { status: "CLOSED" } });
  invariant(result.count === 1, 404, "JOB_NOT_FOUND", "An open job was not found.");
  res.status(204).send();
}));

jobsRouter.put("/jobs/:jobId/saved", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const job = await prisma.job.findFirst({ where: { id: routeParam(req.params.jobId), status: "OPEN" } });
  invariant(job, 404, "JOB_NOT_FOUND", "Open job not found.");
  await prisma.savedJob.upsert({ where: { userId_jobId: { userId: req.auth!.userId, jobId: job.id } }, create: { userId: req.auth!.userId, jobId: job.id }, update: {} });
  res.status(204).send();
}));

jobsRouter.delete("/jobs/:jobId/saved", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  await prisma.savedJob.deleteMany({ where: { userId: req.auth!.userId, jobId: routeParam(req.params.jobId) } });
  res.status(204).send();
}));

jobsRouter.get("/saved-jobs", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  res.json({ data: await prisma.savedJob.findMany({ where: { userId: req.auth!.userId }, include: { job: { include: { category: true, skills: { include: { skill: true } } } } }, orderBy: { createdAt: "desc" } }) });
}));
