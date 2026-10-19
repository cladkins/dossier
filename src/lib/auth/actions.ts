"use server";

import { redirect } from "next/navigation";

import { authMode } from "./mode";
import { endSession } from "./session";

/** Signs out from the sidebar (PRD AUTH-7). */
export async function signOut(): Promise<void> {
  await endSession();
  // With OIDC, /login would otherwise send the browser straight back to the
  // provider, which would sign it in again.
  redirect(authMode() === "oidc" ? "/login?signedOut=1" : "/login");
}
