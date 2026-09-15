import type { RequestHandler } from "express";
import type { UserMode } from "../../generated/prisma/enums";
import { verifyAccessToken } from "../auth/tokens.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const value = req.get("authorization");
    if (!value?.startsWith("Bearer ")) throw new Error("Missing bearer token");
    const claims = await verifyAccessToken(value.slice(7));
    const user = await prisma.user.findUnique({ where: { id: claims.userId }, include: { modes: true, sessions: { where: { id: claims.sessionId } } } });
    if (!user || user.status !== "ACTIVE" || user.tokenVersion !== claims.tokenVersion || !user.sessions[0] || user.sessions[0].revokedAt || user.sessions[0].expiresAt <= new Date()) throw new Error("Inactive session");
    req.auth = { userId: user.id, sessionId: claims.sessionId, modes: user.modes.map(({ mode }) => mode) };
    next();
  } catch {
    next(new HttpError(401, "UNAUTHENTICATED", "A valid access token is required."));
  }
};

export const requireMode = (...modes: UserMode[]): RequestHandler => (req, _res, next) => {
  if (!req.auth || !modes.some((mode) => req.auth?.modes.includes(mode))) return next(new HttpError(403, "FORBIDDEN", "Your account does not have access to this action."));
  next();
};
