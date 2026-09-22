import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error.js";
import { errorMessage, requestLocale } from "../i18n/index.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `Route ${req.method} ${req.path} was not found.`));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const locale = requestLocale(req);
  res.setHeader("Content-Language", locale);
  res.vary("Accept-Language");
  if (error instanceof ZodError) {
    const fields: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "request";
      (fields[key] ??= []).push(issue.message);
    }
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: errorMessage(locale, "VALIDATION_ERROR", "The request could not be processed."), fields, requestId: req.requestId } });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: errorMessage(locale, error.code, error.message), fields: error.fields, requestId: req.requestId } });
    return;
  }

  req.log?.error?.({ err: error }, "Unhandled request error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: errorMessage(locale, "INTERNAL_ERROR", "An unexpected error occurred."), requestId: req.requestId } });
};
