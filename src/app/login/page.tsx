import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { buttonClassName } from "@/components/ui/button";
import { authMode } from "@/lib/auth/mode";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";

import { LoginForm } from "./login-form";
import { oidcErrors } from "./messages";

export const metadata: Metadata = { title: "Sign in" };

/** Sign-in, outside the app shell (PRD AUTH-1, AUTH-8): a password, or a button for the OIDC provider. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next, error, signedOut } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const oidc = authMode() === "oidc";
  const problem = typeof error === "string" && Object.hasOwn(oidcErrors, error) ? oidcErrors[error as keyof typeof oidcErrors] : null;
  const startUrl = `/api/auth/login${nextPath ? `?${new URLSearchParams({ next: nextPath })}` : ""}`;
  // Straight on to the provider, which usually still knows the person,
  // unless they just signed out or the last try failed.
  if (oidc && !problem && signedOut === undefined) redirect(startUrl);

  return (
    // The form on the panel's colour, a warm wash on the right.
    <main className="grid min-h-screen bg-surface min-[960px]:grid-cols-2">
      <div className="flex items-center justify-center px-8 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <div className="flex flex-col items-start gap-2">
          <BrandMark className="size-10" />
          <div className="flex flex-col">
            <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Dossier</div>
            <div className="text-sm text-muted">Your job search, on your server</div>
          </div>
        </div>
        {oidc ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">
                {signedOut !== undefined ? "You're signed out" : "Welcome back"}
              </h1>
              <p className="text-sm text-muted">Each person gets their own profile and applications.</p>
            </div>
            {problem && (
              <p role="alert" className="text-meta text-error">
                {problem}
              </p>
            )}
            {/* A plain link: the sign-in is a full page navigation to the provider. */}
            <a href={startUrl} className={buttonClassName("primary", "lg")}>
              Sign in with {env.DOSSIER_OIDC_NAME}
            </a>
          </div>
        ) : (
          <>
            <LoginForm next={nextPath} />
            <p className="text-meta leading-[1.6] text-pretty text-muted">
              Your password is set on the server, as a hash in{" "}
              <code className="font-mono text-label">DOSSIER_PASSWORD</code>. Forgot it? Make a new hash with{" "}
              <code className="font-mono text-label">hash-password</code> and restart.
            </p>
          </>
        )}
      </div>
      </div>
      <div
        aria-hidden="true"
        className="hidden bg-[linear-gradient(to_left,color-mix(in_srgb,var(--color-ink)_9%,transparent)_0%,transparent_65%)] min-[960px]:grid min-[960px]:place-items-center"
      >
        <BrandMark className="size-40 opacity-90 shadow-dialog rounded-[36px]" />
      </div>
    </main>
  );
}
