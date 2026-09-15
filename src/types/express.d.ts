import type { UserMode } from "../../generated/prisma/enums";

declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string; modes: UserMode[] };
      requestId: string;
    }
  }
}

export {};
