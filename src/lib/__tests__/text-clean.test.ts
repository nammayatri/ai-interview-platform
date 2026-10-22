import { describe, expect, it } from "vitest";
import { stripNul } from "../text-clean";

describe("stripNul", () => {
  it("removes NUL characters that Postgres rejects", () => {
    expect(stripNul("Bharath\u0000 Kumar\u0000")).toBe("Bharath Kumar");
  });
  it("leaves normal text, unicode and empty values alone", () => {
    expect(stripNul("Résumé – 日本語")).toBe("Résumé – 日本語");
    expect(stripNul("")).toBe("");
    expect(stripNul(null)).toBeNull();
    expect(stripNul(undefined)).toBeUndefined();
  });
});
