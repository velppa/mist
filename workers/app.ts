import { createRequestHandler, RouterContextProvider } from "react-router";
import { routeAgentRequest } from "agents";
import { cloudflareContext } from "../app/lib/cloudflare.server";
import { handleDocUpdate } from "../app/lib/update.server";
import {
  getSessionEmail,
  isSsoConfigured,
  requiresLogin,
  type AuthEnv,
} from "../app/lib/auth.server";

export { default as DocumentAgent } from "../agents/document";
export { default as DocumentRegistry } from "../agents/registry";
export { default as TokenStore } from "../agents/tokens";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const authEnv = env as AuthEnv;
    const url = new URL(request.url);
    let incoming: Request = request;

    // The token store trusts the email in its request bodies, so it may
    // only ever be called server-side (getAgentByName) — never routed.
    if (url.pathname.startsWith("/agents/token-store")) {
      return new Response("Not found", { status: 404 });
    }

    // API update: PUT /docs/:id replaces the document. Handled here so
    // curl gets a plain-text response instead of the rendered page.
    if (request.method === "PUT" && /^\/docs\/[^/]+$/.test(url.pathname)) {
      return handleDocUpdate(request, env);
    }

    if (url.pathname.startsWith("/agents/") && request.method === "POST") {
      // The author header is trusted by the Durable Object, so it must
      // only ever carry an identity verified here — strip whatever the
      // client sent and stamp the session email if there is one.
      const headers = new Headers(request.headers);
      headers.delete("x-mist-author");
      const email = await getSessionEmail(request, authEnv);
      if (email) headers.set("x-mist-author", email);
      incoming = new Request(request, { headers });
    } else if (isSsoConfigured(authEnv) && requiresLogin(url.pathname)) {
      // Browser pages require a session when SSO is configured.
      const email = await getSessionEmail(request, authEnv);
      if (!email) {
        const target = `/auth/login?redirect=${encodeURIComponent(url.pathname + url.search)}`;
        return new Response(null, { status: 302, headers: { Location: target } });
      }
    }

    // routeAgentRequest will route to available agents using the
    // /agents/:agent/:name pattern, otherwise hand off to react-router
    const agentResponse = await routeAgentRequest(incoming, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Create context provider with cloudflare bindings for middleware mode
    const contextProvider = new RouterContextProvider();
    contextProvider.set(cloudflareContext, { env, ctx });

    return requestHandler(incoming, contextProvider);
  },
} satisfies ExportedHandler<Env>;
