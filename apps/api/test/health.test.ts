import { afterAll, describe, expect, it } from "vitest";
import { API_VERSION, healthResponse } from "@torra/shared";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { testApp } from "./support.ts";

const app = await testApp();
afterAll(() => app.close());

describe("GET /api/health", () => {
  it("answers with the API version in the shared shape", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(healthResponse.parse(response.json())).toEqual({ status: "ok", version: API_VERSION });
  });

  it("answers without the database", async () => {
    const offline = await testApp({ DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/none" });
    expect((await offline.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    await offline.close();
  });
});

describe("the database", () => {
  it("is reachable through the injected client", async () => {
    const rows = await app.get(PrismaService).$queryRaw<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows).toEqual([{ one: 1 }]);
  });
});

describe("errors", () => {
  it("have one shape, in Portuguese, for Nest's own errors too", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nothing-here" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "not_found", message: "Não encontrado." } });
  });
});
