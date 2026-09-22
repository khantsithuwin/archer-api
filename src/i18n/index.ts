import type { Request } from "express";
import { enErrors } from "./locales/en.js";
import { myErrors } from "./locales/my.js";

export type Locale = "en" | "my";

export function requestLocale(req: Request): Locale {
  if (!req.get("accept-language")) return "en";
  return req.acceptsLanguages("my", "en") === "my" ? "my" : "en";
}

export function errorMessage(locale: Locale, code: string, fallback: string): string {
  if (locale === "my") return myErrors[code] ?? myErrors.INTERNAL_ERROR!;
  return enErrors[code as keyof typeof enErrors] ?? fallback;
}
