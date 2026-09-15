import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { clearRefreshCookie, issueSession, setRefreshCookie } from "../auth/session.js";
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/tokens.js";
import { asyncHandler } from "../lib/async-handler.js";
import { HttpError, invariant } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";

export const authRouter = Router();
const strictLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const credentials = z.object({ email: z.email().transform((v) => v.trim().toLowerCase()), password: z.string().min(8).max(128) });
const publicUser = (user: { id: string; email: string; displayName: string; emailVerifiedAt: Date | null; createdAt: Date; modes: { mode: string }[] }) => ({ id: user.id, email: user.email, displayName: user.displayName, emailVerifiedAt: user.emailVerifiedAt, modes: user.modes.map((item) => item.mode), createdAt: user.createdAt });

authRouter.post("/register", strictLimit, asyncHandler(async (req, res) => {
  const input = credentials.extend({ displayName: z.string().trim().min(2).max(80), modes: z.array(z.enum(["CLIENT", "FREELANCER"])).min(1).max(2).default(["FREELANCER"]) }).parse(req.body);
  invariant(!await prisma.user.findUnique({ where: { email: input.email } }), 409, "EMAIL_TAKEN", "An account already exists for this email.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const rawVerificationToken = randomBytes(32).toString("hex");
  const user = await prisma.user.create({
    data: { email: input.email, displayName: input.displayName, passwordHash, modes: { create: [...new Set(input.modes)].map((mode) => ({ mode })) } },
    include: { modes: true },
  });
  await prisma.emailVerificationToken.create({ data: { userId: user.id, tokenHash: hashToken(rawVerificationToken), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  const tokens = await issueSession(user, req, res);
  res.status(201).json({ data: { user: publicUser(user), ...tokens, ...(process.env.NODE_ENV !== "production" ? { verificationToken: rawVerificationToken } : {}) } });
}));

authRouter.post("/login", strictLimit, asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { modes: true } });
  invariant(user && await bcrypt.compare(input.password, user.passwordHash), 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  invariant(user.status === "ACTIVE", 403, "ACCOUNT_UNAVAILABLE", "This account is not active.");
  res.json({ data: { user: publicUser(user), ...await issueSession(user, req, res) } });
}));

authRouter.post("/refresh", strictLimit, asyncHandler(async (req, res) => {
  const token = z.object({ refreshToken: z.string().optional() }).parse(req.body).refreshToken ?? req.cookies?.archer_refresh;
  invariant(token, 401, "INVALID_REFRESH_TOKEN", "A refresh token is required.");
  let claims;
  try { claims = await verifyRefreshToken(token); } catch { throw new HttpError(401, "INVALID_REFRESH_TOKEN", "The refresh token is invalid or expired."); }
  const session = await prisma.session.findUnique({ where: { id: claims.sessionId }, include: { user: { include: { modes: true } } } });
  if (!session || session.refreshTokenHash !== hashToken(token) || session.revokedAt || session.expiresAt <= new Date()) {
    await prisma.session.updateMany({ where: { familyId: claims.familyId }, data: { revokedAt: new Date() } });
    throw new HttpError(401, "REFRESH_TOKEN_REUSED", "The refresh-token family has been revoked.");
  }
  invariant(session.user.status === "ACTIVE", 403, "ACCOUNT_UNAVAILABLE", "This account is not active.");
  const nextRefresh = await signRefreshToken({ userId: session.userId, sessionId: session.id, familyId: session.familyId });
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(nextRefresh), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
  setRefreshCookie(res, nextRefresh);
  res.json({ data: { accessToken: await signAccessToken({ userId: session.userId, sessionId: session.id, tokenVersion: session.user.tokenVersion }), refreshToken: req.get("x-client-platform") === "mobile" ? nextRefresh : undefined } });
}));

authRouter.post("/logout", authenticate, asyncHandler(async (req, res) => {
  await prisma.session.updateMany({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } });
  clearRefreshCookie(res);
  res.status(204).send();
}));

authRouter.post("/logout-all", authenticate, asyncHandler(async (req, res) => {
  await prisma.$transaction([prisma.session.updateMany({ where: { userId: req.auth!.userId, revokedAt: null }, data: { revokedAt: new Date() } }), prisma.user.update({ where: { id: req.auth!.userId }, data: { tokenVersion: { increment: 1 } } })]);
  clearRefreshCookie(res);
  res.status(204).send();
}));

authRouter.post("/verify-email", strictLimit, asyncHandler(async (req, res) => {
  const { token } = z.object({ token: z.string().min(32) }).parse(req.body);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  invariant(record && !record.usedAt && record.expiresAt > new Date(), 400, "INVALID_VERIFICATION_TOKEN", "The verification token is invalid or expired.");
  await prisma.$transaction([prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }), prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } })]);
  res.status(204).send();
}));

authRouter.post("/forgot-password", strictLimit, asyncHandler(async (req, res) => {
  const email = z.object({ email: z.email().transform((v) => v.toLowerCase()) }).parse(req.body).email;
  const user = await prisma.user.findUnique({ where: { email } });
  let resetToken: string | undefined;
  if (user) {
    resetToken = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
  }
  res.json({ data: { message: "If that account exists, password-reset instructions have been created.", ...(process.env.NODE_ENV !== "production" && resetToken ? { resetToken } : {}) } });
}));

authRouter.post("/reset-password", strictLimit, asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32), password: z.string().min(8).max(128) }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
  invariant(record && !record.usedAt && record.expiresAt > new Date(), 400, "INVALID_RESET_TOKEN", "The reset token is invalid or expired.");
  await prisma.$transaction([prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }), prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await bcrypt.hash(input.password, 12), tokenVersion: { increment: 1 } } }), prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } })]);
  clearRefreshCookie(res);
  res.status(204).send();
}));

authRouter.get("/me", authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include: { modes: true, clientProfile: true, freelancerProfile: { include: { skills: { include: { skill: true } }, portfolioItems: true } } } });
  const { passwordHash: _, tokenVersion: __, ...safe } = user;
  res.json({ data: safe });
}));
