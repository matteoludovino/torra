import { describe, expect, it } from "vitest";
import { ago, budget, money, plural } from "./format";

const clean = (text: string) => text.replace(/\s/g, " ");

describe("format", () => {
  it("shows whole reais without cents", () => {
    expect(clean(money(400_000))).toBe("R$ 4.000");
    expect(clean(money(400_050))).toBe("R$ 4.000,50");
    expect(clean(budget(400_000, 800_000))).toBe("R$ 4.000 a R$ 8.000");
  });

  it("says how long ago, in Portuguese", () => {
    const now = new Date("2026-11-24T12:00:00Z").getTime();
    expect(ago("2026-11-24T09:00:00Z", now)).toBe("hoje");
    expect(ago("2026-11-23T12:00:00Z", now)).toBe("ontem");
    expect(ago("2026-11-20T12:00:00Z", now)).toBe("há 4 dias");
    expect(plural(1, "proposta", "propostas")).toBe("1 proposta");
    expect(plural(0, "proposta", "propostas")).toBe("0 propostas");
  });
});
