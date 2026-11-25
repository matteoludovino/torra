import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../src/prisma/prisma.service.ts";
import { FakeClock } from "../src/time/clock.ts";
import { Browser, PASSWORD, customer, emailsTo, linkToken, resetDb, testApp } from "./support.ts";

const clock = new FakeClock();
const app = await testApp({}, { clock });
const db = app.get(PrismaService);
afterAll(() => app.close());
beforeEach(() => resetDb(db));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("sign-up", () => {
  it("signs the person in at once, in a sandbox of their own, and emails a confirmation link", async () => {
    const browser = new Browser(app);
    const signup = await browser.post("/api/auth/signup", {
      name: " Ana  Souza ",
      email: "Ana@Exemplo.com",
      password: PASSWORD,
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json()).toMatchObject({
      name: "Ana Souza",
      email: "ana@exemplo.com",
      role: "customer",
      emailVerified: false,
      demo: false,
    });
    expect(signup.cookies.find((c) => c.name === "torra_session")).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    // A sandbox that is kept: a customer's private corner of the store.
    const user = await db.user.findUniqueOrThrow({
      where: { email: "ana@exemplo.com" },
      include: { sandbox: true },
    });
    expect(user.sandbox).toMatchObject({ expiresAt: null });

    const [email] = await emailsTo(app, "ana@exemplo.com");
    expect(email).toMatchObject({ kind: "verify_email", subject: "Confirme seu e-mail na Torra" });
    // The token travels in the fragment, which browsers never send to a server.
    expect(email!.text).toMatch(/http:\/\/localhost:3040\/verificar#t=[\w-]{43}/);
    const verify = await new Browser(app).post("/api/auth/verify", {
      token: await linkToken(app, "ana@exemplo.com", "verify_email"),
    });
    expect(verify.json()).toMatchObject({ emailVerified: true });
    expect((await browser.get("/api/me")).json()).toMatchObject({ emailVerified: true });
  });

  it("says plainly when an address already has an account, and changes nothing", async () => {
    const { email } = await customer(app);
    const again = await new Browser(app).post("/api/auth/signup", {
      name: "Outra Pessoa",
      email: email.toUpperCase(),
      password: "outra-senha-456",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("email_taken");
    expect(again.cookies.some((c) => c.name === "torra_session" && c.value)).toBe(false);
    expect(await db.user.count()).toBe(1);
    expect(await db.sandbox.count()).toBe(1);
  });

  it("lets two sign-ups for one address race: one account, one sandbox", async () => {
    const answers = await Promise.all(
      [1, 2].map(() =>
        new Browser(app).post("/api/auth/signup", { name: "Ana", email: "ana@x.com", password: PASSWORD }),
      ),
    );
    expect(answers.map((a) => a.statusCode).sort()).toEqual([201, 409]);
    expect(await db.user.count()).toBe(1);
    expect(await db.sandbox.count()).toBe(1);
  });

  it("uses a confirmation link once, even when clicked twice at the same moment", async () => {
    await customer(app, "Ana", "ana@x.com");
    const token = await linkToken(app, "ana@x.com", "verify_email");
    const clicks = await Promise.all([1, 2].map(() => new Browser(app).post("/api/auth/verify", { token })));
    expect(clicks.map((c) => c.statusCode).sort()).toEqual([200, 400]);
  });

  it("refuses an expired link, and a new one can be asked for", async () => {
    const { browser } = await customer(app, "Ana", "ana@x.com");
    const old = await linkToken(app, "ana@x.com", "verify_email");
    clock.advance(49 * HOUR);
    const late = await browser.post("/api/auth/verify", { token: old });
    expect(late.statusCode).toBe(400);
    expect(late.json().error.code).toBe("invalid_link");

    expect((await browser.post("/api/auth/resend-verification", { email: "ana@x.com" })).statusCode).toBe(
      202,
    );
    const fresh = await linkToken(app, "ana@x.com", "verify_email");
    expect((await browser.post("/api/auth/verify", { token: fresh })).statusCode).toBe(200);
  });

  it("sends nothing for an unknown address, with the same answer", async () => {
    const browser = new Browser(app);
    expect((await browser.post("/api/auth/resend-verification", { email: "nobody@x.com" })).json()).toEqual({
      ok: true,
    });
    expect((await browser.post("/api/auth/forgot-password", { email: "nobody@x.com" })).json()).toEqual({
      ok: true,
    });
    expect(await emailsTo(app, "nobody@x.com")).toEqual([]);
  });
});

describe("signing in", () => {
  it("needs the right password, not a confirmed address", async () => {
    await customer(app, "Ana", "ana@x.com");
    const browser = new Browser(app);
    const wrong = await browser.post("/api/auth/login", { email: "ana@x.com", password: "errada-123" });
    const unknown = await browser.post("/api/auth/login", { email: "nobody@x.com", password: PASSWORD });
    // An unknown address and a wrong password look the same.
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(browser.cookie).toBeNull();
    const right = await browser.post("/api/auth/login", { email: "ana@x.com", password: PASSWORD });
    expect(right.json()).toMatchObject({ name: "Ana", emailVerified: false });
  });

  it("signs in, out, and the old cookie stops working", async () => {
    const { email } = await customer(app);
    const browser = new Browser(app);
    const login = await browser.post("/api/auth/login", { email: email.toUpperCase(), password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookie = browser.cookie;
    expect((await browser.get("/api/me")).statusCode).toBe(200);

    expect((await browser.post("/api/auth/logout")).statusCode).toBe(204);
    expect(browser.cookie).toBeNull();
    browser.cookie = cookie;
    const after = await browser.get("/api/me");
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("unauthenticated");
  });

  it("locks an address after five wrong passwords, from any address, for a while", async () => {
    const { email } = await customer(app);
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await new Browser(app).post("/api/auth/login", { email, password: "errada-123" });
      expect(wrong.statusCode).toBe(401);
    }
    const locked = await new Browser(app).post("/api/auth/login", { email, password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers["retry-after"]).toBe("900");

    clock.advance(15 * 60_000);
    expect((await new Browser(app).post("/api/auth/login", { email, password: PASSWORD })).statusCode).toBe(
      200,
    );
  });

  it("limits sign-ups per client address", async () => {
    const browser = new Browser(app);
    const answers = [];
    for (let n = 0; n < 6; n++) {
      answers.push(
        (await browser.post("/api/auth/signup", { name: "Ana", email: `a${n}@x.com`, password: PASSWORD }))
          .statusCode,
      );
    }
    expect(answers).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("keeps an active session alive and ends an idle one after 30 days", async () => {
    const { browser } = await customer(app);
    clock.advance(16 * DAY);
    const renewed = await browser.get("/api/me");
    expect(renewed.statusCode).toBe(200);
    expect(renewed.cookies.some((c) => c.name === "torra_session")).toBe(true);

    clock.advance(29 * DAY);
    expect((await browser.get("/api/me")).statusCode).toBe(200);
    clock.advance(31 * DAY);
    expect((await browser.get("/api/me")).statusCode).toBe(401);
  });

  it("turns a suspended account away, session included", async () => {
    const { browser, me } = await customer(app);
    await db.user.update({ where: { id: me.id }, data: { suspendedAt: clock.now() } });
    expect((await browser.get("/api/me")).statusCode).toBe(401);
  });
});

describe("password reset", () => {
  it("sets a new password, ends every other session, and signs in", async () => {
    const { browser: elsewhere, email } = await customer(app);
    const browser = new Browser(app);
    expect((await browser.post("/api/auth/forgot-password", { email })).statusCode).toBe(202);
    const token = await linkToken(app, email, "reset_password");
    expect((await emailsTo(app, email)).at(-1)!.text).toContain("/redefinir-senha#t=");

    const reset = await browser.post("/api/auth/reset-password", { token, password: "nova-senha-789" });
    expect(reset.statusCode).toBe(200);
    expect((await browser.get("/api/me")).statusCode).toBe(200);
    expect((await elsewhere.get("/api/me")).statusCode).toBe(401);

    const old = await new Browser(app).post("/api/auth/login", { email, password: PASSWORD });
    expect(old.statusCode).toBe(401);
    const fresh = await new Browser(app).post("/api/auth/login", { email, password: "nova-senha-789" });
    expect(fresh.statusCode).toBe(200);
    expect(
      (await browser.post("/api/auth/reset-password", { token, password: "outra-senha-000" })).statusCode,
    ).toBe(400);
  });

  it("expires after an hour", async () => {
    const { email } = await customer(app);
    const browser = new Browser(app);
    await browser.post("/api/auth/forgot-password", { email });
    const token = await linkToken(app, email, "reset_password");
    clock.advance(HOUR + 1);
    expect(
      (await browser.post("/api/auth/reset-password", { token, password: "nova-senha-789" })).statusCode,
    ).toBe(400);
  });
});

describe("requests", () => {
  it("that change something must come from the web app", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "https://elsewhere.example" },
      payload: { email: "ana@x.com", password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("forbidden_origin");
    const noOrigin = await app.inject({ method: "POST", url: "/api/auth/signup", payload: {} });
    expect(noOrigin.statusCode).toBe(403);
  });

  it("are checked with the shared schemas, naming the fields only", async () => {
    const response = await new Browser(app).post("/api/auth/signup", {
      name: "A",
      email: "x",
      password: "1",
    });
    expect(response.statusCode).toBe(400);
    expect(
      response
        .json()
        .error.fields.map((f: { path: string }) => f.path)
        .sort(),
    ).toEqual(["email", "name", "password"]);
    expect(response.body).not.toContain('"1"');
  });
});
