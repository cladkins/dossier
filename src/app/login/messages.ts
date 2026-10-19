/** Sign-in errors (PRD AUTH-4), shared by the form and the action. */
export const loginMessages = {
  empty: "Enter your password.",
  wrong: "That's not the password set on the server. Try again.",
  insecure:
    "Password sign-in is turned off over plain HTTP, where your password would cross the network readable. Open Dossier over HTTPS.",
};

/** Why an OIDC sign-in came back to /login (`?error=`). */
export const oidcErrors = {
  provider: "Dossier couldn't reach the sign-in provider. Try again in a moment.",
  expired: "That sign-in took too long or was already used. Try again.",
  denied: "The sign-in was cancelled.",
  forbidden: "Your account isn't allowed to use Dossier. Ask whoever runs it to add you to the right group.",
  failed: "Signing in didn't work. Try again.",
} as const;

export type OidcErrorCode = keyof typeof oidcErrors;
