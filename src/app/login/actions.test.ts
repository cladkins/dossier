import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { systemPrisma as prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { signIn } from "./actions";
import { loginMessages } from "./messages";

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  passwordMatches: vi.fn(),
  startSession: vi.fn(),
  isHttps: async () => requestHeaders.value.get("x-forwarded-proto") === "https",
}));
const env = vi.hoisted(() => ({ DOSSIER_AUTH: "password", DOSSIER_ALLOW_INSECURE_LOGIN: false }));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("@/lib/auth/login-throttle", () => ({
  loginWaitMs: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ systemPrisma: {} }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: vi.fn() }));

describe("signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.DOSSIER_AUTH = "password";
    env.DOSSIER_ALLOW_INSECURE_LOGIN = false;
    requestHeaders.value = new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.7", "x-forwarded-proto": "https", host: "dossier.example.com" });
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    vi.mocked(loginWaitMs).mockResolvedValue(0);
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  it("asks for a password when none was entered, without counting it as a failure", async () => {
    await expect(signIn({ password: "", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.empty,
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("refuses a wrong password and counts the failure for the client's IP", async () => {
    await expect(signIn({ password: "hunter2", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.wrong,
    });
    expect(recordLoginFailure).toHaveBeenCalledWith(prisma, "203.0.113.7");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("refuses to even check the password while the IP is blocked", async () => {
    vi.mocked(loginWaitMs).mockResolvedValue(29_500);
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toEqual({
      ok: false,
      error: "Too many attempts. Try again in 30 seconds.",
    });
    expect(passwordMatches).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts a session, resets the IP's counter and welcomes the user by first name", async () => {
    await expect(
      signIn({ password: "correct horse", remember: true, next: "/applications/abc" }),
    ).resolves.toEqual({
      ok: true,
      data: { redirectTo: "/applications/abc" },
      toast: "Welcome back, Jane.",
    });
    expect(recordLoginSuccess).toHaveBeenCalledWith(prisma, "203.0.113.7");
    expect(startSession).toHaveBeenCalledWith({ persistent: true });
  });

  it("says 'there' before the profile has a name, and ignores unsafe redirects", async () => {
    vi.mocked(loadProfileName).mockResolvedValue("");
    await expect(
      signIn({ password: "correct horse", remember: false, next: "https://evil.example" }),
    ).resolves.toMatchObject({ data: { redirectTo: "/" }, toast: "Welcome back, there." });
    expect(startSession).toHaveBeenCalledWith({ persistent: false });
  });

  it("refuses a password sent over plain HTTP from another machine, before checking it", async () => {
    requestHeaders.value = new Headers({ "x-forwarded-for": "203.0.113.7", host: "192.168.1.5:3000" });
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toEqual({ ok: false, error: loginMessages.insecure });
    expect(passwordMatches).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("allows plain HTTP on localhost, or everywhere with DOSSIER_ALLOW_INSECURE_LOGIN", async () => {
    requestHeaders.value = new Headers({ host: "localhost:3000" });
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toMatchObject({ ok: true });

    requestHeaders.value = new Headers({ host: "192.168.1.5:3000" });
    env.DOSSIER_ALLOW_INSECURE_LOGIN = true;
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toMatchObject({ ok: true });
  });

  it("refuses password sign-in when people sign in with OIDC", async () => {
    env.DOSSIER_AUTH = "oidc";
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toMatchObject({ ok: false });
    expect(passwordMatches).not.toHaveBeenCalled();
  });
});
