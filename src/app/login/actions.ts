"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { ActionError, publicAction } from "@/lib/action";
import { clientIp } from "@/lib/auth/client-ip";
import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { authMode } from "@/lib/auth/mode";
import { safeNextPath } from "@/lib/auth/next-path";
import { isHttps, passwordMatches, startSession } from "@/lib/auth/session";
import { tooManyAttemptsMessage } from "@/lib/auth/throttle";
import { env } from "@/lib/env";
import { systemPrisma as prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { loginMessages } from "./messages";

/**
 * Signs in with the password that DOSSIER_PASSWORD is a hash of (PRD AUTH-1, AUTH-4).
 * Failed attempts are rate-limited per IP and globally (AUTH-5). Returns
 * where to go next: the requested page if it's on this site, or the dashboard.
 */
export const signIn = publicAction(
  z.object({
    password: z.string(),
    remember: z.boolean(),
    next: z.string().optional(),
  }),
  async ({ password, remember, next }, { toast }) => {
    if (authMode() !== "password") throw new ActionError(loginMessages.wrong);
    const requestHeaders = await headers();
    if (!env.DOSSIER_ALLOW_INSECURE_LOGIN && !(await isHttps()) && !isLocalHost(requestHeaders)) {
      throw new ActionError(loginMessages.insecure);
    }
    const ip = clientIp(requestHeaders);
    const wait = await loginWaitMs(prisma, ip);
    if (wait > 0) throw new ActionError(tooManyAttemptsMessage(wait));

    if (!password) throw new ActionError(loginMessages.empty);
    if (!(await passwordMatches(password))) {
      await recordLoginFailure(prisma, ip);
      throw new ActionError(loginMessages.wrong);
    }
    await recordLoginSuccess(prisma, ip);

    await startSession({ persistent: remember });
    const firstName = (await loadProfileName()).trim().split(/\s+/)[0] || "there";
    toast(`Welcome back, ${firstName}.`);
    return { redirectTo: safeNextPath(next) };
  },
);

/** Whether the browser opened Dossier on this machine (localhost), where plain HTTP never leaves it. */
function isLocalHost(requestHeaders: Headers): boolean {
  const host = (requestHeaders.get("x-forwarded-host")?.split(",")[0] ?? requestHeaders.get("host") ?? "").trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}
