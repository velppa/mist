import { redirect } from "react-router";
import type { Route } from "./+types/auth.callback";
import { getCloudflare } from "~/lib/cloudflare.server";
import {
  createSessionCookie,
  exchangeCode,
  getCookie,
  isSsoConfigured,
  oidcIssuer,
  verifyIdToken,
  verifyPayload,
  OIDC_COOKIE,
  type AuthEnv,
  type OidcStatePayload,
} from "~/lib/auth.server";

function authError(message: string) {
  return new Response(`authentication failed: ${message}\n`, {
    status: 403,
    headers: { "Content-Type": "text/plain" },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The authorization server reported a failure (RFC 6749 §4.1.2.1), or the
 * callback is malformed. Render a readable page instead of exchanging a
 * code we don't have. The error params come from the query string, so they
 * must be escaped before touching the markup.
 */
function oidcErrorPage(error: string, description: string | null): Response {
  const accessDenied = error === "access_denied";
  const hint = accessDenied
    ? "This usually means your account has not been assigned to the mist application in OneLogin — ask an administrator to grant access."
    : "Try signing in again; if the problem persists, contact an administrator.";

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mist — sign-in failed</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #fafaf9; color: #1c1917;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  main { max-width: 32rem; padding: 1rem; }
  h1 { font-size: 1rem; font-family: ui-monospace, monospace; text-transform: uppercase;
       letter-spacing: 0.05em; font-weight: 300; color: #78716c; }
  code { font-family: ui-monospace, monospace; background: #e7e5e4; padding: 0.1em 0.3em; }
  a { color: #1c1917; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    code { background: #292524; }
    a { color: #fafaf9; }
  }
</style>
</head>
<body>
<main>
<h1>Sign-in failed</h1>
<p><code>${escapeHtml(error)}</code>${description ? ` — ${escapeHtml(description)}` : ""}</p>
<p>${hint}</p>
<p><a href="/auth/login">Try again</a></p>
</main>
</body>
</html>
`;

  return new Response(body, {
    status: accessDenied ? 403 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The one-shot state cookie is dead weight after a failed round trip.
      "Set-Cookie": `${OIDC_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}

/**
 * OneLogin redirects back here with ?code&state. Validate the state
 * against the signed cookie set at /auth/login, exchange the code for an
 * ID token, verify it against OneLogin's JWKS, then start a session.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const authEnv = env as AuthEnv;

  if (!isSsoConfigured(authEnv)) {
    return redirect("/");
  }

  const url = new URL(request.url);

  const oidcError = url.searchParams.get("error");
  if (oidcError) {
    return oidcErrorPage(oidcError, url.searchParams.get("error_description"));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return oidcErrorPage(
      "invalid_callback",
      "The callback request is missing the code or state parameter.",
    );
  }

  const stateCookie = getCookie(request, OIDC_COOKIE);
  if (!stateCookie) {
    return authError("missing login state cookie — try signing in again");
  }

  const payload = await verifyPayload<OidcStatePayload>(
    stateCookie,
    authEnv.SESSION_SECRET!,
  );
  if (!payload || payload.state !== state) {
    return authError("state mismatch — try signing in again");
  }

  let email: string;
  try {
    const { id_token } = await exchangeCode({
      subdomain: authEnv.ONELOGIN_SUBDOMAIN!,
      clientId: authEnv.ONELOGIN_CLIENT_ID!,
      clientSecret: authEnv.ONELOGIN_CLIENT_SECRET!,
      code,
      redirectUri: `${url.origin}/auth/callback`,
      codeVerifier: payload.verifier,
    });
    email = await verifyIdToken({
      idToken: id_token,
      issuer: oidcIssuer(authEnv.ONELOGIN_SUBDOMAIN!),
      clientId: authEnv.ONELOGIN_CLIENT_ID!,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return authError(message);
  }

  const sessionCookie = await createSessionCookie(email, authEnv.SESSION_SECRET!);
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie);
  // Expire the one-shot state cookie.
  headers.append(
    "Set-Cookie",
    `${OIDC_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  headers.set("Location", payload.redirect || "/");

  return new Response(null, { status: 302, headers });
}
