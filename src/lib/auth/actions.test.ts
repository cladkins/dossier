import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

import { signOut } from "./actions";
import { endSession } from "./session";

vi.mock("./session", () => ({ endSession: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const env = vi.hoisted(() => ({ DOSSIER_AUTH: "password" }));
vi.mock("@/lib/env", () => ({ env }));

describe("signOut", () => {
  it("deletes the session cookie and goes to the sign-in page", async () => {
    await signOut();
    expect(endSession).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("with OIDC, stays on the sign-in page instead of signing straight back in", async () => {
    env.DOSSIER_AUTH = "oidc";
    await signOut();
    expect(redirect).toHaveBeenCalledWith("/login?signedOut=1");
  });
});
