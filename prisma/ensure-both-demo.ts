import type { PrismaClient } from "../generated/prisma/client";

const bothUserId = "usr_both_demo";
const bothEmail = "both@archer.local";

export async function ensureBothDemo(prisma: PrismaClient, passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email: bothEmail } });
  if (existing && existing.id !== bothUserId) throw new Error(`${bothEmail} belongs to a different user; refusing to overwrite it.`);

  const user = existing ?? await prisma.user.create({ data: {
    id: bothUserId, email: bothEmail, passwordHash, displayName: "Avery Morgan", country: "Myanmar", city: "Yangon",
    emailVerifiedAt: new Date(), modes: { create: [{ mode: "CLIENT" }, { mode: "FREELANCER" }] },
  } });
  for (const mode of ["CLIENT", "FREELANCER"] as const) {
    await prisma.userModeRecord.upsert({ where: { userId_mode: { userId: user.id, mode } }, create: { userId: user.id, mode }, update: {} });
  }
  await prisma.clientProfile.upsert({ where: { userId: user.id }, create: {
    userId: user.id, companyName: "Avery Studio", overview: "We build thoughtful digital products with independent specialists.",
    industry: "Technology", isCompany: true,
  }, update: {} });
  await prisma.freelancerProfile.upsert({ where: { userId: user.id }, create: {
    userId: user.id, username: "avery-morgan", title: "Full-stack product designer",
    overview: "I design and build accessible digital products with clear communication and reliable delivery.",
    hourlyRateMinor: 5500, rateCurrency: "USD", experienceLevel: "EXPERT", availability: "AVAILABLE",
  }, update: {} });

  const skills = await prisma.skill.findMany({ where: { id: { in: ["skill_1", "skill_2", "skill_10"] } }, select: { id: true } });
  const category = await prisma.category.findUnique({ where: { id: "cat_1" } });
  if (!category || skills.length !== 3) throw new Error("Seed categories and skills are required before adding the both-role demo account.");
  for (const { id: skillId } of skills) {
    await prisma.freelancerSkill.upsert({ where: { freelancerId_skillId: { freelancerId: user.id, skillId } }, create: { freelancerId: user.id, skillId }, update: {} });
  }

  const ownJob = await prisma.job.findUnique({ where: { id: "job_both_demo" } });
  if (ownJob && ownJob.clientId !== user.id) throw new Error("job_both_demo belongs to another client; refusing to overwrite it.");
  if (!ownJob) await prisma.job.create({ data: {
    id: "job_both_demo", clientId: user.id, categoryId: category.id, title: "Build an accessible client portal",
    description: "Create an accessible client portal with clear project updates, responsive layouts, and well-tested interactions.",
    workType: "FIXED_PRICE", currency: "USD", budgetMinMinor: 80_000, budgetMaxMinor: 150_000,
    experienceLevel: "INTERMEDIATE", estimatedDuration: "1–3 months", status: "OPEN", publishedAt: new Date(),
    skills: { create: [{ skillId: "skill_1" }, { skillId: "skill_2" }] },
  } });

  const incomingFreelancer = await prisma.freelancerProfile.findUnique({ where: { userId: "usr_freelancer_1" } });
  if (!incomingFreelancer) throw new Error("The first seeded freelancer is required for the both-role demo job.");
  const incomingProposal = await prisma.proposal.findUnique({ where: { jobId_freelancerId: { jobId: "job_both_demo", freelancerId: incomingFreelancer.userId } } });
  if (!incomingProposal) await prisma.proposal.create({ data: {
    id: "proposal_to_both_demo", jobId: "job_both_demo", freelancerId: incomingFreelancer.userId,
    coverLetter: "I can build your accessible client portal with a clear delivery plan, responsive interface, and tested interactions. I will share regular progress updates.",
    amountMinor: 110_000, currency: "USD", estimatedDuration: "8 weeks", status: "SUBMITTED",
  } });

  const otherJob = await prisma.job.findFirst({ where: { status: "OPEN", clientId: { not: user.id }, budgetMinMinor: { not: null } }, orderBy: { id: "asc" } });
  if (!otherJob || otherJob.budgetMinMinor === null) throw new Error("An open job from another client is required for the both-role demo proposal.");
  const existingProposal = await prisma.proposal.findUnique({ where: { jobId_freelancerId: { jobId: otherJob.id, freelancerId: user.id } } });
  if (!existingProposal) await prisma.proposal.create({ data: {
    id: "proposal_both_demo", jobId: otherJob.id, freelancerId: user.id,
    coverLetter: "I can deliver this project with a clear plan, accessible implementation, and frequent progress updates. My design and development experience fits the brief.",
    amountMinor: otherJob.budgetMinMinor, currency: otherJob.currency, estimatedDuration: "4 weeks", status: "SUBMITTED",
  } });
  await prisma.savedJob.upsert({ where: { userId_jobId: { userId: user.id, jobId: otherJob.id } }, create: { userId: user.id, jobId: otherJob.id }, update: {} });
  return { userId: user.id, ownedJobId: "job_both_demo", proposedJobId: otherJob.id };
}
