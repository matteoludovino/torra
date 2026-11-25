import { describe, expect, it } from "vitest";
import { API_VERSION } from "@torra/shared";
import { checkServer } from "./health";

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe("checkServer", () => {
  it("is online when the server speaks our protocol", async () => {
    expect(await checkServer(respond(200, { status: "ok", version: API_VERSION }))).toBe("online");
  });

  it("asks for a reload when the server moved on", async () => {
    expect(await checkServer(respond(200, { status: "ok", version: API_VERSION + 2 }))).toBe("outdated");
  });

  it("is offline on errors, odd answers and network failures", async () => {
    expect(await checkServer(respond(502, {}))).toBe("offline");
    expect(await checkServer(respond(200, { hello: "world" }))).toBe("offline");
    expect(
      await checkServer(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("offline");
  });
});
