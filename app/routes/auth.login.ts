import { redirect } from "react-router";
import type { Route } from "./+types/auth.login";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  buildAuthorizeUrl,
  generatePkce,
  generateState,
  isSsoConfigured,
  signPayload,
  OIDC_COOKIE,
  OIDC_STATE_MAX_AGE_SECONDS,
  type AuthEnv,
  type OidcStatePayload,
} from "~/lib/auth.server";

/**
 * Kick off the OneLogin authorization-code flow. The state and PKCE
 * verifier travel in a short-lived signed cookie so the callback can
 * validate the round trip without server-side storage.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  if (!isSsoConfigured(authEnv)) {
    return redirect("/");
  }

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirect") ?? "/";
  // Only allow same-origin relative paths to prevent open redirects.
  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//")
    ? redirectTo
    : "/";

  const state = generateState();
  const { verifier, challenge } = await generatePkce();

  const payload: OidcStatePayload = {
    state,
    verifier,
    redirect: safeRedirect,
    exp: Math.floor(Date.now() / 1000) + OIDC_STATE_MAX_AGE_SECONDS,
  };
  const cookieValue = await signPayload(payload, authEnv.SESSION_SECRET!);

  const authorizeUrl = buildAuthorizeUrl({
    subdomain: authEnv.ONELOGIN_SUBDOMAIN!,
    clientId: authEnv.ONELOGIN_CLIENT_ID!,
    redirectUri: `${url.origin}/auth/callback`,
    state,
    codeChallenge: challenge,
  });

  return redirect(authorizeUrl, {
    headers: {
      "Set-Cookie": `${OIDC_COOKIE}=${cookieValue}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${OIDC_STATE_MAX_AGE_SECONDS}`,
    },
  });
}
