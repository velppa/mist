import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  configuredIssuer,
  externalUrl,
  getCookie,
  isSsoConfigured,
  oidcClient,
  ID_TOKEN_COOKIE,
  SESSION_COOKIE,
  type AuthEnv,
} from "~/lib/auth.server";

/**
 * End the session: clear the session cookie and, when SSO is configured,
 * also end the provider session so the next visit prompts for credentials
 * instead of silently re-authenticating.  The provider sends the browser
 * back home only when the login's ID token is known, since providers
 * reject a post-logout redirect without it.
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  let target = "/";
  if (isSsoConfigured(authEnv)) {
    const logoutUrl = new URL(`${configuredIssuer(authEnv)}/logout`);
    logoutUrl.searchParams.set("client_id", oidcClient(authEnv).clientId);
    const idToken = getCookie(request, ID_TOKEN_COOKIE);
    if (idToken) {
      logoutUrl.searchParams.set("id_token_hint", idToken);
      logoutUrl.searchParams.set(
        "post_logout_redirect_uri",
        `${externalUrl(request).origin}/`,
      );
    }
    target = logoutUrl.toString();
  }

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  headers.append(
    "Set-Cookie",
    `${ID_TOKEN_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  return redirect(target, { headers });
}
