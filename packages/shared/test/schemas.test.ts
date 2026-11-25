import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL, signupInput } from "../src";

describe("money", () => {
  it("formats centavos as reais", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(formatBRL(5).replace(/\s/g, " ")).toBe("R$ 0,05");
  });

  it("parses what people type, exactly", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 50")).toBe(5000);
    expect(parseBRL("0,1")).toBe(10);
    expect(parseBRL("1234")).toBe(123400);
    expect(parseBRL("1.234.567")).toBe(123456700);
    for (const bad of ["", "abc", "1,234", "12.34", "1,2,3", "-5", "1.23,00"])
      expect(parseBRL(bad)).toBeNull();
  });
});

describe("account input", () => {
  it("normalizes email and name", () => {
    expect(
      signupInput.parse({ name: "  Ana   Souza ", email: " Ana@Exemplo.COM ", password: "12345678" }),
    ).toEqual({
      name: "Ana Souza",
      email: "ana@exemplo.com",
      password: "12345678",
    });
  });

  it("rejects short passwords and bad emails", () => {
    expect(signupInput.safeParse({ name: "Ana", email: "ana@x.com", password: "1234567" }).success).toBe(
      false,
    );
    expect(signupInput.safeParse({ name: "Ana", email: "ana", password: "12345678" }).success).toBe(false);
  });
});
