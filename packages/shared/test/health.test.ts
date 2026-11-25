import { describe, expect, it } from "vitest";
import { API_VERSION, healthResponse, isSupportedVersion } from "../src";

describe("API version", () => {
  it("accepts the current version and the previous one only", () => {
    expect(isSupportedVersion(API_VERSION)).toBe(true);
    expect(isSupportedVersion(API_VERSION - 1)).toBe(true);
    expect(isSupportedVersion(API_VERSION - 2)).toBe(false);
    expect(isSupportedVersion(API_VERSION + 1)).toBe(false);
  });

  it("parses the health answer and nothing else", () => {
    expect(healthResponse.parse({ status: "ok", version: 1 })).toEqual({ status: "ok", version: 1 });
    expect(healthResponse.safeParse({ status: "down", version: 1 }).success).toBe(false);
  });
});
