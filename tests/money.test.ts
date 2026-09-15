import { describe, expect, it } from "vitest";

const formatMoney = (minor: number, currency: "USD" | "MMK") => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: currency === "MMK" ? 0 : 2, maximumFractionDigits: currency === "MMK" ? 0 : 2 }).format(currency === "USD" ? minor / 100 : minor);

describe("money representation", () => {
  it("formats USD cents", () => expect(formatMoney(1234, "USD")).toBe("$12.34"));
  it("formats MMK whole kyat without dividing by 100", () => expect(formatMoney(12000, "MMK")).toContain("12,000"));
});
