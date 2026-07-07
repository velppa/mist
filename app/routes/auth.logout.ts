import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  isSsoConfigured,
  oidcIssuer,
  SESSION_COOKIE,
  type AuthEnv,
} from "~/lib/auth.server";

/**
 * End the session: clear the session cookie and, when SSO is configured,
 * also end the OneLogin session so the next visit prompts for credentials
 * instead of silently re-authenticating.
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  let target = "/";
  if (isSsoConfigured(authEnv)) {
    const logoutUrl = new URL(`${oidcIssuer(authEnv.ONELOGIN_SUBDOMAIN!)}/logout`);
    logoutUrl.searchParams.set("client_id", authEnv.ONELOGIN_CLIENT_ID!);
    logoutUrl.searchParams.set(
      "post_logout_redirect_uri",
      `${new URL(request.url).origin}/`,
    );
    target = logoutUrl.toString();
  }

  return redirect(target, {
    headers: {
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
