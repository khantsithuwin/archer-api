import { HttpError } from "./http-error.js";

export function routeParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, "INVALID_ROUTE_PARAMETER", "A valid route parameter is required.");
  return value;
}
