import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { prisma } from "../lib/prisma.js";
import { routeParam } from "../lib/route-param.js";
import { authenticate, requireMode } from "../middleware/auth.js";

export const profilesRouter = Router();

profilesRouter.put("/client-profile", authenticate, requireMode("CLIENT"), asyncHandler(async (req, res) => {
  const input = z.object({ companyName: z.string().trim().max(120).nullable().optional(), overview: z.string().trim().max(2000).nullable().optional(), industry: z.string().trim().max(100).nullable().optional(), website: z.url().nullable().optional(), isCompany: z.boolean().default(false) }).parse(req.body);
  const profile = await prisma.clientProfile.upsert({ where: { userId: req.auth!.userId }, create: { userId: req.auth!.userId, ...input }, update: input });
  res.json({ data: profile });
}));

profilesRouter.put("/freelancer-profile", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const input = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{3,30}$/), title: z.string().trim().min(2).max(120), overview: z.string().trim().min(20).max(4000), hourlyRateMinor: z.number().int().positive().nullable().optional(), rateCurrency: z.enum(["USD", "MMK"]).nullable().optional(), experienceLevel: z.enum(["ENTRY", "INTERMEDIATE", "EXPERT"]).default("INTERMEDIATE"), availability: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]).default("AVAILABLE"), skillIds: z.array(z.string()).max(30).default([]) }).parse(req.body);
  const { skillIds, ...profileData } = input;
  const profile = await prisma.$transaction(async (tx) => {
    await tx.freelancerProfile.upsert({ where: { userId: req.auth!.userId }, create: { userId: req.auth!.userId, ...profileData }, update: profileData });
    await tx.freelancerSkill.deleteMany({ where: { freelancerId: req.auth!.userId } });
    if (skillIds.length) await tx.freelancerSkill.createMany({ data: [...new Set(skillIds)].map((skillId) => ({ freelancerId: req.auth!.userId, skillId })) });
    return tx.freelancerProfile.findUniqueOrThrow({ where: { userId: req.auth!.userId }, include: { skills: { include: { skill: true } } } });
  });
  res.json({ data: profile });
}));

profilesRouter.post("/portfolio-items", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(10).max(3000), projectUrl: z.url().nullable().optional(), imageUrls: z.array(z.url()).max(10).default([]) }).parse(req.body);
  const { imageUrls, ...data } = input;
  const item = await prisma.portfolioItem.create({ data: { freelancerId: req.auth!.userId, ...data, imageUrlsJson: JSON.stringify(imageUrls) } });
  res.status(201).json({ data: item });
}));

profilesRouter.patch("/portfolio-items/:itemId", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(2).max(120).optional(), description: z.string().trim().min(10).max(3000).optional(), projectUrl: z.url().nullable().optional(), imageUrls: z.array(z.url()).max(10).optional() }).parse(req.body);
  const id = routeParam(req.params.itemId);
  const existing = await prisma.portfolioItem.findFirst({ where: { id, freelancerId: req.auth!.userId } });
  if (!existing) return res.status(404).json({ error: { code: "PORTFOLIO_ITEM_NOT_FOUND", message: "Portfolio item not found.", requestId: req.requestId } });
  const { imageUrls, ...data } = input;
  res.json({ data: await prisma.portfolioItem.update({ where: { id }, data: { ...data, ...(imageUrls ? { imageUrlsJson: JSON.stringify(imageUrls) } : {}) } }) });
}));

profilesRouter.delete("/portfolio-items/:itemId", authenticate, requireMode("FREELANCER"), asyncHandler(async (req, res) => {
  await prisma.portfolioItem.deleteMany({ where: { id: routeParam(req.params.itemId), freelancerId: req.auth!.userId } });
  res.status(204).send();
}));

profilesRouter.get("/freelancers", asyncHandler(async (req, res) => {
  const input = z.object({ q: z.string().trim().optional(), skill: z.string().optional(), currency: z.enum(["USD", "MMK"]).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query);
  const where = { ...(input.q ? { OR: [{ title: { contains: input.q } }, { overview: { contains: input.q } }, { user: { displayName: { contains: input.q } } }] } : {}), ...(input.currency ? { rateCurrency: input.currency } : {}), ...(input.skill ? { skills: { some: { skill: { slug: input.skill } } } } : {}) };
  const [items, total] = await prisma.$transaction([prisma.freelancerProfile.findMany({ where, skip: (input.page - 1) * input.limit, take: input.limit, include: { user: { select: { displayName: true, avatarUrl: true, country: true, createdAt: true } }, skills: { include: { skill: true } } }, orderBy: { user: { createdAt: "desc" } } }), prisma.freelancerProfile.count({ where })]);
  res.json({ data: items, meta: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } });
}));

profilesRouter.get("/freelancers/:username", asyncHandler(async (req, res) => {
  const profile = await prisma.freelancerProfile.findUnique({ where: { username: routeParam(req.params.username) }, include: { user: { select: { id: true, displayName: true, avatarUrl: true, country: true, city: true, languagesJson: true, createdAt: true, reviewsReceived: { where: { visibleAt: { not: null } }, select: { rating: true, feedback: true, createdAt: true } } } }, skills: { include: { skill: true } }, portfolioItems: true } });
  if (!profile) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Freelancer not found.", requestId: req.requestId } });
  res.json({ data: profile });
}));
