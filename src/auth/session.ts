import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { hashToken, signAccessToken, signRefreshToken } from "./tokens.js";

const refreshExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

export const setRefreshCookie = (res: Response, token: string) => {
  res.cookie("archer_refresh", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/v1/auth", maxAge: 30 * 24 * 60 * 60 * 1000 });
};

export const clearRefreshCookie = (res: Response) => res.clearCookie("archer_refresh", { path: "/api/v1/auth" });

export const issueSession = async (user: { id: string; tokenVersion: number }, req: Request, res: Response, familyId = randomUUID()) => {
  const session = await prisma.session.create({ data: { userId: user.id, familyId, refreshTokenHash: "pending-" + randomUUID(), expiresAt: refreshExpiry(), userAgent: req.get("user-agent") ?? null, ipAddress: req.ip ?? null } });
  const refreshToken = await signRefreshToken({ userId: user.id, sessionId: session.id, familyId });
  await prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(refreshToken) } });
  setRefreshCookie(res, refreshToken);
  const accessToken = await signAccessToken({ userId: user.id, sessionId: session.id, tokenVersion: user.tokenVersion });
  return { accessToken, refreshToken: req.get("x-client-platform") === "mobile" ? refreshToken : undefined };
};
