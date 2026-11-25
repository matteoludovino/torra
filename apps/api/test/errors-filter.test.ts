import { BadRequestException, Logger, NotFoundException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ErrorsFilter } from "../src/common/errors.filter.ts";

function catchWith(exception: unknown) {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    send(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => reply }) } as unknown as ArgumentsHost;
  new ErrorsFilter().catch(exception, host);
  return sent;
}

describe("ErrorsFilter", () => {
  it("keeps our own code, message and fields", () => {
    const sent = catchWith(
      new BadRequestException({
        code: "invalid",
        message: "Dados inválidos.",
        fields: [{ path: "title", problem: "too_small" }],
      }),
    );
    expect(sent).toEqual({
      status: 400,
      body: {
        error: {
          code: "invalid",
          message: "Dados inválidos.",
          fields: [{ path: "title", problem: "too_small" }],
        },
      },
    });
  });

  it("gives Nest's own errors a Portuguese default", () => {
    expect(catchWith(new NotFoundException()).body).toEqual({
      error: { code: "not_found", message: "Não encontrado." },
    });
  });

  it("never leaks the details of an unexpected error", () => {
    const log = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    const sent = catchWith(new Error("connection string postgres://secret@db"));
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain("secret");
    expect(sent.body).toEqual({
      error: { code: "internal", message: "Algo deu errado do nosso lado. Tente de novo." },
    });
    log.mockRestore();
  });
});
