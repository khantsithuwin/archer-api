import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" }) });
const mode = process.env.SEED_MODE ?? "demo";
if (!['minimal', 'demo', 'full'].includes(mode)) throw new Error("SEED_MODE must be minimal, demo, or full");
if (process.env.NODE_ENV === "production") throw new Error("Seed data cannot be loaded in production");

let state = 42;
const random = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
const dateBefore = (days: number) => new Date(Date.now() - Math.floor(random() * days) * 86_400_000);
const sizes = mode === "full" ? { clients: 60, freelancers: 250, jobs: 500, proposals: 2000, contracts: 180, conversations: 150, messages: 3000, reviews: 300, notifications: 800, reports: 40 } : mode === "demo" ? { clients: 8, freelancers: 25, jobs: 40, proposals: 140, contracts: 15, conversations: 12, messages: 120, reviews: 20, notifications: 80, reports: 8 } : { clients: 2, freelancers: 4, jobs: 4, proposals: 8, contracts: 2, conversations: 2, messages: 10, reviews: 2, notifications: 10, reports: 2 };

const categoryNames = ["Web Development", "Mobile Development", "Design", "Writing", "Marketing", "Data Science", "DevOps", "Business", "Video & Animation", "Customer Support", "Accounting", "Architecture"];
const skillNames = ["React", "TypeScript", "Node.js", "Express", "Prisma", "SQLite", "PostgreSQL", "React Native", "Expo", "Figma", "UI Design", "UX Research", "Copywriting", "SEO", "Social Media", "Python", "Data Analysis", "Machine Learning", "AWS", "Docker", "Kubernetes", "Project Management", "Virtual Assistance", "Video Editing", "Motion Design", "Bookkeeping", "AutoCAD", "Translation", "Content Strategy", "REST APIs", "GraphQL", "Testing", "Accessibility", "Technical Writing", "Branding", "Illustration", "PHP", "Laravel", "WordPress", "Shopify", "Java", "Kotlin", "Swift", "Go", "Rust", "C#", ".NET", "MongoDB", "Redis", "Cybersecurity", "QA Automation", "Product Management", "Sales", "Lead Generation", "Email Marketing", "Google Ads", "Analytics", "Excel", "Power BI", "Tableau", "Blender", "After Effects", "Premiere Pro", "3D Modeling", "Interior Design", "CAD", "Finance", "Research", "Customer Service", "Technical Support", "English", "Burmese", "Chinese", "Japanese", "Thai", "Data Entry", "Recruiting", "Legal Research", "Business Analysis", "Scrum", "Git", "CI/CD", "Linux", "Azure"];
const firstNames = ["Aung", "Su", "Min", "Mya", "Kyaw", "Nandar", "Liam", "Emma", "Noah", "Olivia", "Ethan", "Sophia"];
const lastNames = ["Win", "Tun", "Htet", "Lin", "Oo", "Smith", "Chen", "Patel", "Garcia", "Brown"];
const jobTitles = ["Build a responsive marketplace dashboard", "Create an Expo mobile application", "Design a clean brand identity", "Develop a REST API integration", "Improve search engine visibility", "Analyze customer retention data", "Set up CI and cloud deployment", "Write technical product documentation"];

async function clear() {
  await prisma.$transaction([
    prisma.adminAuditLog.deleteMany(), prisma.report.deleteMany(), prisma.notification.deleteMany(), prisma.review.deleteMany(), prisma.messageRead.deleteMany(), prisma.message.deleteMany(), prisma.conversationParticipant.deleteMany(), prisma.conversation.deleteMany(), prisma.contractEvent.deleteMany(), prisma.milestoneSubmission.deleteMany(), prisma.milestone.deleteMany(), prisma.contract.deleteMany(), prisma.proposalMilestone.deleteMany(), prisma.proposal.deleteMany(), prisma.savedJob.deleteMany(), prisma.jobSkill.deleteMany(), prisma.job.deleteMany(), prisma.portfolioItem.deleteMany(), prisma.freelancerSkill.deleteMany(), prisma.freelancerProfile.deleteMany(), prisma.clientProfile.deleteMany(), prisma.skill.deleteMany(), prisma.category.deleteMany(), prisma.passwordResetToken.deleteMany(), prisma.emailVerificationToken.deleteMany(), prisma.session.deleteMany(), prisma.userModeRecord.deleteMany(), prisma.user.deleteMany(),
  ]);
}

async function seed() {
  await clear();
  const passwordHash = await bcrypt.hash("ArcherDemo123!", 10);
  await prisma.user.create({ data: { id: "usr_admin", email: "admin@archer.local", passwordHash, displayName: "Archer Admin", emailVerifiedAt: new Date(), modes: { create: { mode: "ADMIN" } } } });

  const clients = Array.from({ length: sizes.clients }, (_, i) => ({ id: `usr_client_${i + 1}`, email: `client${i + 1}@archer.local`, passwordHash, displayName: `${pick(firstNames)} ${pick(lastNames)}`, country: i % 3 === 0 ? "Myanmar" : pick(["Singapore", "Thailand", "United States"]), city: i % 3 === 0 ? "Yangon" : null, emailVerifiedAt: new Date(), createdAt: dateBefore(600), updatedAt: new Date() }));
  const freelancers = Array.from({ length: sizes.freelancers }, (_, i) => ({ id: `usr_freelancer_${i + 1}`, email: `freelancer${i + 1}@archer.local`, passwordHash, displayName: `${pick(firstNames)} ${pick(lastNames)}`, country: i % 2 === 0 ? "Myanmar" : pick(["Thailand", "Singapore", "Philippines"]), city: i % 2 === 0 ? pick(["Yangon", "Mandalay", "Naypyidaw"]) : null, emailVerifiedAt: new Date(), createdAt: dateBefore(700), updatedAt: new Date() }));
  await prisma.user.createMany({ data: [...clients, ...freelancers] });
  await prisma.userModeRecord.createMany({ data: [...clients.map((user) => ({ userId: user.id, mode: "CLIENT" as const })), ...freelancers.map((user) => ({ userId: user.id, mode: "FREELANCER" as const }))] });
  await prisma.clientProfile.createMany({ data: clients.map((user, i) => ({ userId: user.id, companyName: i % 2 ? `Studio ${i + 1}` : null, overview: "We hire skilled independent professionals for thoughtful digital projects.", industry: pick(["Technology", "Retail", "Education", "Media"]), isCompany: i % 2 === 1 })) });
  await prisma.freelancerProfile.createMany({ data: freelancers.map((user, i) => ({ userId: user.id, username: `freelancer-${i + 1}`, title: pick(["Full-stack Developer", "Product Designer", "Mobile Engineer", "Content Strategist", "Data Analyst"]), overview: "Experienced independent professional focused on clear communication, reliable delivery, and practical outcomes for clients.", hourlyRateMinor: i % 2 ? 25_00 + i * 100 : 30_000 + i * 1000, rateCurrency: i % 2 ? "USD" as const : "MMK" as const, experienceLevel: pick(["ENTRY", "INTERMEDIATE", "EXPERT"] as const), availability: pick(["AVAILABLE", "AVAILABLE", "LIMITED"] as const) })) });

  await prisma.category.createMany({ data: categoryNames.map((name, i) => ({ id: `cat_${i + 1}`, name, slug: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/-$/, "") })) });
  await prisma.skill.createMany({ data: skillNames.map((name, i) => ({ id: `skill_${i + 1}`, name, slug: name.toLowerCase().replaceAll(/[^a-z0-9+#.]+/g, "-").replace(/-$/, ""), categoryId: `cat_${(i % categoryNames.length) + 1}` })) });
  await prisma.freelancerSkill.createMany({ data: freelancers.flatMap((user, i) => Array.from({ length: 5 }, (_, n) => ({ freelancerId: user.id, skillId: `skill_${((i * 3 + n) % skillNames.length) + 1}` }))) });

  const openJobCount = mode === "full" ? 250 : Math.max(2, Math.floor(sizes.jobs / 2));
  const jobs = Array.from({ length: sizes.jobs }, (_, i) => { const workType = i % 3 === 0 ? "HOURLY" as const : "FIXED_PRICE" as const; const currency = i % 2 ? "USD" as const : "MMK" as const; const base = currency === "USD" ? 20_000 + (i % 20) * 5_000 : 500_000 + (i % 20) * 100_000; return { id: `job_${i + 1}`, clientId: clients[i % clients.length]!.id, categoryId: `cat_${(i % categoryNames.length) + 1}`, title: `${pick(jobTitles)} #${i + 1}`, description: "We are looking for an experienced freelancer to deliver a well-tested, maintainable solution. Please describe your approach, relevant experience, expected timeline, and any questions in your proposal.", workType, currency, budgetMinMinor: base, budgetMaxMinor: base * 2, experienceLevel: pick(["ENTRY", "INTERMEDIATE", "EXPERT"] as const), estimatedDuration: pick(["Less than 1 month", "1–3 months", "3–6 months"]), status: i < sizes.contracts ? (i < Math.floor(sizes.contracts * .84) ? "COMPLETED" as const : "IN_PROGRESS" as const) : (i < sizes.contracts + openJobCount ? "OPEN" as const : pick(["DRAFT", "PAUSED", "CLOSED"] as const)), publishedAt: dateBefore(120), createdAt: dateBefore(150), updatedAt: new Date() }; });
  await prisma.job.createMany({ data: jobs });
  await prisma.jobSkill.createMany({ data: jobs.flatMap((job, i) => Array.from({ length: 3 }, (_, n) => ({ jobId: job.id, skillId: `skill_${((i * 2 + n) % skillNames.length) + 1}` }))) });

  const proposalCount = Math.min(sizes.proposals, sizes.jobs * sizes.freelancers);
  const proposals = Array.from({ length: proposalCount }, (_, i) => { const jobIndex = Math.floor(i / Math.max(1, Math.ceil(proposalCount / sizes.jobs))) % sizes.jobs; const job = jobs[jobIndex]!; const freelancerIndex = i % freelancers.length; const contracted = jobIndex < sizes.contracts && i % Math.max(1, Math.ceil(proposalCount / sizes.jobs)) === 0; return { id: `proposal_${i + 1}`, jobId: job.id, freelancerId: freelancers[freelancerIndex]!.id, coverLetter: "I understand the goals and can deliver this project with clear milestones, frequent updates, and tested results. My background closely matches the requested skills.", amountMinor: job.budgetMinMinor + Math.floor((job.budgetMaxMinor - job.budgetMinMinor) * random()), currency: job.currency, estimatedDuration: job.estimatedDuration, status: contracted ? "ACCEPTED" as const : jobIndex < sizes.contracts ? "REJECTED" as const : pick(["SUBMITTED", "SUBMITTED", "SHORTLISTED", "WITHDRAWN"] as const), createdAt: dateBefore(100), updatedAt: new Date() }; });
  await prisma.proposal.createMany({ data: proposals });

  // Keep the named demo accounts connected in every seed mode. The generated
  // volume data is intentionally varied, so this explicit relationship makes
  // the first client and freelancer useful for walkthroughs and screenshots.
  const demoClient = clients[0]!;
  const demoFreelancer = freelancers[0]!;
  const demoOpenJob = jobs.find((job) => job.clientId === demoClient.id && job.status === "OPEN");
  if (demoOpenJob && !proposals.some((proposal) => proposal.jobId === demoOpenJob.id && proposal.freelancerId === demoFreelancer.id)) {
    await prisma.proposal.create({ data: { id: "demo_proposal_client1_freelancer1", jobId: demoOpenJob.id, freelancerId: demoFreelancer.id, coverLetter: "I understand the goals and can deliver this project with clear milestones, frequent updates, and tested results. My background closely matches the requested skills.", amountMinor: demoOpenJob.budgetMinMinor, currency: demoOpenJob.currency, estimatedDuration: demoOpenJob.estimatedDuration, status: "SUBMITTED", createdAt: new Date(), updatedAt: new Date() } });
  }

  const contracts = Array.from({ length: sizes.contracts }, (_, i) => { const proposal = proposals.find((item) => item.jobId === `job_${i + 1}` && item.status === "ACCEPTED")!; const completed = i < Math.floor(sizes.contracts * .84); return { id: `contract_${i + 1}`, jobId: proposal.jobId, proposalId: proposal.id, clientId: jobs[i]!.clientId, freelancerId: proposal.freelancerId, title: jobs[i]!.title, workType: jobs[i]!.workType, currency: proposal.currency, amountMinor: proposal.amountMinor, termsSnapshot: JSON.stringify({ seeded: true, proposalId: proposal.id }), status: completed ? "COMPLETED" as const : "ACTIVE" as const, acceptedAt: dateBefore(90), completedAt: completed ? dateBefore(30) : null, createdAt: dateBefore(100), updatedAt: new Date() }; });
  await prisma.contract.createMany({ data: contracts });
  const milestones = contracts.flatMap((contract, i) => Array.from({ length: 3 }, (_, n) => ({ id: `milestone_${i * 3 + n + 1}`, contractId: contract.id, title: ["Discovery and plan", "Implementation", "Final delivery"][n]!, description: "Seeded milestone for development and demonstration.", amountMinor: n === 2 ? contract.amountMinor - Math.floor(contract.amountMinor / 3) * 2 : Math.floor(contract.amountMinor / 3), sortOrder: n, status: contract.status === "COMPLETED" ? "APPROVED" as const : n === 0 ? "IN_PROGRESS" as const : "PENDING" as const })));
  await prisma.milestone.createMany({ data: milestones });
  const submitted = milestones.filter((_, i) => i < Math.min(milestones.length, mode === "full" ? 270 : Math.ceil(milestones.length / 2)));
  await prisma.milestoneSubmission.createMany({ data: submitted.map((milestone, i) => ({ id: `submission_${i + 1}`, milestoneId: milestone.id, submittedById: contracts.find((item) => item.id === milestone.contractId)!.freelancerId, message: "Deliverables are ready for review. Please see the linked project materials.", deliverablesJson: JSON.stringify([`https://example.com/deliverable/${i + 1}`]), createdAt: dateBefore(60) })) });

  const conversations = Array.from({ length: Math.min(sizes.conversations, contracts.length) }, (_, i) => ({ id: `conversation_${i + 1}`, jobId: contracts[i]!.jobId, createdAt: dateBefore(90), updatedAt: new Date() }));
  await prisma.conversation.createMany({ data: conversations });
  await prisma.conversationParticipant.createMany({ data: conversations.flatMap((conversation, i) => [{ conversationId: conversation.id, userId: contracts[i]!.clientId }, { conversationId: conversation.id, userId: contracts[i]!.freelancerId }]) });
  const messages = Array.from({ length: sizes.messages }, (_, i) => { const conversationIndex = i % conversations.length; const contract = contracts[conversationIndex]!; return { id: `message_${i + 1}`, conversationId: conversations[conversationIndex]!.id, senderId: i % 2 ? contract.clientId : contract.freelancerId, body: pick(["Thanks for the update.", "I have reviewed the latest work.", "Could you clarify this requirement?", "The next milestone is on schedule.", "I have shared the deliverable for review."]), createdAt: new Date(Date.now() - (sizes.messages - i) * 60_000) }; });
  await prisma.message.createMany({ data: messages });

  const completedContracts = contracts.filter((item) => item.status === "COMPLETED");
  const reviews = Array.from({ length: Math.min(sizes.reviews, completedContracts.length * 2) }, (_, i) => { const contract = completedContracts[Math.floor(i / 2)]!; const clientWrites = i % 2 === 0; return { id: `review_${i + 1}`, contractId: contract.id, reviewerId: clientWrites ? contract.clientId : contract.freelancerId, revieweeId: clientWrites ? contract.freelancerId : contract.clientId, rating: pick([3, 4, 4, 5, 5, 5]), feedback: pick(["Clear communication and excellent work.", "A smooth and professional collaboration.", "Delivered the agreed scope reliably."]), visibleAt: new Date(), createdAt: dateBefore(25) }; });
  await prisma.review.createMany({ data: reviews });
  const allUsers = ["usr_admin", ...clients.map((item) => item.id), ...freelancers.map((item) => item.id)];
  await prisma.notification.createMany({ data: Array.from({ length: sizes.notifications }, (_, i) => ({ id: `notification_${i + 1}`, userId: allUsers[(i % (allUsers.length - 1)) + 1]!, type: pick(["PROPOSAL", "CONTRACT", "MILESTONE", "MESSAGE", "REVIEW"] as const), title: "Archer activity update", body: "There is new activity in your Archer workspace.", dataJson: "{}", readAt: i % 3 ? dateBefore(10) : null, createdAt: dateBefore(30) })) });
  await prisma.report.createMany({ data: Array.from({ length: sizes.reports }, (_, i) => ({ id: `report_${i + 1}`, reporterId: allUsers[(i % (allUsers.length - 1)) + 1]!, targetType: i % 2 ? "JOB" as const : "USER" as const, targetId: i % 2 ? jobs[i % jobs.length]!.id : freelancers[i % freelancers.length]!.id, reason: pick(["Spam", "Misleading content", "Inappropriate content"]), details: "Seeded moderation report for testing the administration workflow.", status: pick(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const), createdAt: dateBefore(60), updatedAt: new Date() })) });

  console.log(`Seeded Archer (${mode}):`, sizes);
  console.log("Demo login: admin@archer.local / ArcherDemo123!");
}

seed().finally(() => prisma.$disconnect());
