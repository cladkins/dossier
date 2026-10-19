import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Where requests without a signed-in person land. Authentik signs people in,
 * in front of Dossier, so there's nothing to fill in here: it says how to get
 * in instead.
 */
export default async function LoginPage() {
  if (await getSession()) redirect("/");

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-8 py-12">
      <div className="flex w-full max-w-[420px] flex-col gap-6">
        <div className="flex flex-col items-start gap-2">
          <BrandMark className="size-10" />
          <div className="font-serif text-[30px] font-medium tracking-[-0.01em]">Dossier</div>
        </div>
        <h1 className="font-serif text-[28px] leading-[1.15] tracking-[-0.01em]">Sign in through Authentik</h1>
        <p className="text-sm leading-[1.6] text-pretty text-muted">
          Dossier doesn&apos;t have its own sign-in. Open it at the address your Authentik setup serves, and Authentik
          signs you in. If you got here from that address, Authentik isn&apos;t passing on who you are: check that the
          proxy provider sends its <code className="font-mono text-label">X-authentik-*</code> headers to Dossier.
        </p>
      </div>
    </main>
  );
}
