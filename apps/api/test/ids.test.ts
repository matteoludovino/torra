import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/common/ids.ts";

describe("uuidv7", () => {
  it("is a version 7 UUID that sorts by creation, also within one millisecond", () => {
    const at = Date.UTC(2026, 10, 26);
    const ids = Array.from({ length: 500 }, () => uuidv7(at));
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseInt(ids[0]!.replace(/-/g, "").slice(0, 12), 16)).toBe(at);
    // A later millisecond sorts after.
    expect(uuidv7(at + 1) > ids.at(-1)!).toBe(true);
  });
});
