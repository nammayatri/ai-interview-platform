import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidShareKey, shareKeyFor } from "../share-key";

const old = process.env.NEXTAUTH_SECRET;
beforeEach(() => { process.env.NEXTAUTH_SECRET = "test-secret"; });
afterEach(() => { process.env.NEXTAUTH_SECRET = old; });

describe("share key", () => {
  it("is stable per interview and differs between interviews", () => {
    expect(shareKeyFor("a")).toBe(shareKeyFor("a"));
    expect(shareKeyFor("a")).not.toBe(shareKeyFor("b"));
  });
  it("accepts its own key only", () => {
    const k = shareKeyFor("a")!;
    expect(isValidShareKey("a", k)).toBe(true);
    expect(isValidShareKey("b", k)).toBe(false);
    expect(isValidShareKey("a", "true")).toBe(false);
    expect(isValidShareKey("a", "")).toBe(false);
    expect(isValidShareKey("a", null)).toBe(false);
  });
  it("is off when there is no secret", () => {
    process.env.NEXTAUTH_SECRET = "";
    expect(shareKeyFor("a")).toBeNull();
    expect(isValidShareKey("a", "anything")).toBe(false);
  });
});
