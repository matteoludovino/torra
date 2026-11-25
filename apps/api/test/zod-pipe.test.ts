import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodPipe } from "../src/common/zod.pipe.ts";

const pipe = new ZodPipe(z.object({ title: z.string().trim().min(3), budget: z.coerce.number().int() }));

describe("ZodPipe", () => {
  it("returns the parsed (and converted) value", () => {
    expect(pipe.transform({ title: "  Landing page ", budget: "1500" })).toEqual({
      title: "Landing page",
      budget: 1500,
    });
  });

  it("rejects with each problem's path, without echoing the values", () => {
    try {
      pipe.transform({ title: "x", budget: "muito" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { fields: { path: string }[] };
      expect(body.fields.map((f) => f.path).sort()).toEqual(["budget", "title"]);
      expect(JSON.stringify(body)).not.toContain("muito");
    }
  });
});
