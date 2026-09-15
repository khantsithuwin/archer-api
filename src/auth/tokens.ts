import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

type AccessClaims = { userId: string; sessionId: string; tokenVersion: number };
type RefreshClaims = { userId: string; sessionId: string; familyId: string };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const signAccessToken = ({ userId, sessionId, tokenVersion }: AccessClaims) =>
  new SignJWT({ sid: sessionId, ver: tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(env.ACCESS_TOKEN_TTL).setJti(randomUUID()).sign(accessSecret);

export const signRefreshToken = ({ userId, sessionId, familyId }: RefreshClaims) =>
  new SignJWT({ sid: sessionId, family: familyId, type: "refresh" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(env.REFRESH_TOKEN_TTL).setJti(randomUUID()).sign(refreshSecret);

export const verifyAccessToken = async (token: string): Promise<AccessClaims> => {
  const { payload } = await jwtVerify(token, accessSecret);
  if (!payload.sub || typeof payload.sid !== "string" || typeof payload.ver !== "number") throw new Error("Invalid access token");
  return { userId: payload.sub, sessionId: payload.sid, tokenVersion: payload.ver };
};

export const verifyRefreshToken = async (token: string): Promise<RefreshClaims> => {
  const { payload } = await jwtVerify(token, refreshSecret);
  if (!payload.sub || typeof payload.sid !== "string" || typeof payload.family !== "string" || payload.type !== "refresh") throw new Error("Invalid refresh token");
  return { userId: payload.sub, sessionId: payload.sid, familyId: payload.family };
};
