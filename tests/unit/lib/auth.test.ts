import { describe, it, expect, vi } from "vitest";
import {
  authenticateNewRequest,
  base64UrlDecode,
  base64UrlEncode,
  buildAuthorizeUrl,
  createSessionCookie,
  exchangeCode,
  generatePkce,
  getBearerToken,
  getCookie,
  getSessionEmail,
  isAuthConfigured,
  isSsoConfigured,
  oidcIssuer,
  parseApiTokens,
  requiresLogin,
  signPayload,
  verifyIdToken,
  verifyPayload,
  SESSION_COOKIE,
} from "~/lib/auth.server";

const SECRET = "test-secret";

function futureExp(seconds = 3600): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

/* ------------------------------------------------------------------ */
/*  Token parsing                                                      */
/* ------------------------------------------------------------------ */

describe("parseApiTokens", () => {
  it("parses JSON object format", () => {
    const map = parseApiTokens('{"tok1":"alice@vio.com","tok2":"bob@vio.com"}');
    expect(map.get("tok1")).toBe("alice@vio.com");
    expect(map.get("tok2")).toBe("bob@vio.com");
    expect(map.size).toBe(2);
  });

  it("parses token:email CSV format", () => {
    const map = parseApiTokens("tok1:alice@vio.com, tok2:bob@vio.com");
    expect(map.get("tok1")).toBe("alice@vio.com");
    expect(map.get("tok2")).toBe("bob@vio.com");
  });

  it("returns empty map for undefined, empty, or malformed input", () => {
    expect(parseApiTokens(undefined).size).toBe(0);
    expect(parseApiTokens("").size).toBe(0);
    expect(parseApiTokens("{not json").size).toBe(0);
    expect(parseApiTokens(":missing-token").size).toBe(0);
  });

  it("ignores JSON entries with non-string emails", () => {
    const map = parseApiTokens('{"tok1":42,"tok2":"bob@vio.com"}');
    expect(map.has("tok1")).toBe(false);
    expect(map.get("tok2")).toBe("bob@vio.com");
  });
});

describe("getBearerToken", () => {
  it("extracts the token from an Authorization header", () => {
    const req = new Request("https://x/", {
      headers: { Authorization: "Bearer abc123" },
    });
    expect(getBearerToken(req)).toBe("abc123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    const req = new Request("https://x/", {
      headers: { Authorization: "bearer abc123" },
    });
    expect(getBearerToken(req)).toBe("abc123");
  });

  it("returns null for missing or non-Bearer headers", () => {
    expect(getBearerToken(new Request("https://x/"))).toBeNull();
    const basic = new Request("https://x/", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(getBearerToken(basic)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Signed payloads / session cookie                                   */
/* ------------------------------------------------------------------ */

describe("signPayload / verifyPayload", () => {
  it("round-trips a payload", async () => {
    const token = await signPayload({ email: "a@vio.com", exp: futureExp() }, SECRET);
    const payload = await verifyPayload<{ email: string; exp: number }>(token, SECRET);
    expect(payload?.email).toBe("a@vio.com");
  });

  it("rejects a tampered payload", async () => {
    const token = await signPayload({ email: "a@vio.com", exp: futureExp() }, SECRET);
    const [data, sig] = token.split(".");
    const forged = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({ email: "evil@vio.com", exp: futureExp() }),
      ),
    );
    expect(await verifyPayload(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifyPayload(`${data}.AAAA`, SECRET)).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const token = await signPayload({ exp: futureExp() }, SECRET);
    expect(await verifyPayload(token, "other-secret")).toBeNull();
  });

  it("rejects expired payloads", async () => {
    const token = await signPayload({ exp: futureExp(-10) }, SECRET);
    expect(await verifyPayload(token, SECRET)).toBeNull();
  });

  it("rejects garbage input", async () => {
    expect(await verifyPayload("garbage", SECRET)).toBeNull();
    expect(await verifyPayload("a.b", SECRET)).toBeNull();
    expect(await verifyPayload("", SECRET)).toBeNull();
  });
});

describe("session cookie", () => {
  it("createSessionCookie produces an HttpOnly cookie that getSessionEmail accepts", async () => {
    const setCookie = await createSessionCookie("pavel@vio.com", SECRET);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");

    const value = setCookie.split(";")[0];
    const req = new Request("https://x/", { headers: { Cookie: value } });
    const email = await getSessionEmail(req, { SESSION_SECRET: SECRET });
    expect(email).toBe("pavel@vio.com");
  });

  it("getSessionEmail returns null without cookie or secret", async () => {
    const bare = new Request("https://x/");
    expect(await getSessionEmail(bare, { SESSION_SECRET: SECRET })).toBeNull();

    const setCookie = await createSessionCookie("pavel@vio.com", SECRET);
    const req = new Request("https://x/", {
      headers: { Cookie: setCookie.split(";")[0] },
    });
    expect(await getSessionEmail(req, {})).toBeNull();
  });

  it("getCookie finds a cookie among several", () => {
    const req = new Request("https://x/", {
      headers: { Cookie: `theme=dark; ${SESSION_COOKIE}=abc.def; other=1` },
    });
    expect(getCookie(req, SESSION_COOKIE)).toBe("abc.def");
    expect(getCookie(req, "missing")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

describe("configuration checks", () => {
  const fullSso = {
    ONELOGIN_SUBDOMAIN: "vio",
    ONELOGIN_CLIENT_ID: "cid",
    ONELOGIN_CLIENT_SECRET: "cs",
    SESSION_SECRET: "s",
  };

  it("isSsoConfigured requires all four variables", () => {
    expect(isSsoConfigured(fullSso)).toBe(true);
    expect(isSsoConfigured({ ...fullSso, SESSION_SECRET: undefined })).toBe(false);
    expect(isSsoConfigured({})).toBe(false);
  });

  it("isAuthConfigured is true with tokens or SSO", () => {
    expect(isAuthConfigured({})).toBe(false);
    expect(isAuthConfigured({ MIST_API_TOKENS: "t:a@vio.com" })).toBe(true);
    expect(isAuthConfigured(fullSso)).toBe(true);
  });

  it("requiresLogin exempts agents, auth, and /new paths", () => {
    expect(requiresLogin("/")).toBe(true);
    expect(requiresLogin("/raw/abcd1234.html")).toBe(true);
    expect(requiresLogin("/docs/abcd1234")).toBe(true);
    expect(requiresLogin("/agents/document-agent/abcd1234")).toBe(false);
    expect(requiresLogin("/auth/login")).toBe(false);
    expect(requiresLogin("/auth/callback")).toBe(false);
    expect(requiresLogin("/new")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  /new authentication decision                                       */
/* ------------------------------------------------------------------ */

describe("authenticateNewRequest", () => {
  it("is open when nothing is configured", async () => {
    const result = await authenticateNewRequest(new Request("https://x/new"), {});
    expect(result).toEqual({ ok: true, email: null });
  });

  it("maps a valid bearer token to its email", async () => {
    const req = new Request("https://x/new", {
      headers: { Authorization: "Bearer tok" },
    });
    const result = await authenticateNewRequest(req, {
      MIST_API_TOKENS: '{"tok":"alice@vio.com"}',
    });
    expect(result).toEqual({ ok: true, email: "alice@vio.com" });
  });

  it("rejects an unknown bearer token", async () => {
    const req = new Request("https://x/new", {
      headers: { Authorization: "Bearer wrong" },
    });
    const result = await authenticateNewRequest(req, {
      MIST_API_TOKENS: '{"tok":"alice@vio.com"}',
    });
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  OIDC helpers (OneLogin endpoints mocked)                           */
/* ------------------------------------------------------------------ */

describe("PKCE and authorize URL", () => {
  it("generates an S256 challenge for the verifier", async () => {
    const { verifier, challenge } = await generatePkce();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    expect(challenge).toBe(base64UrlEncode(new Uint8Array(digest)));
  });

  it("buildAuthorizeUrl points at the OneLogin OIDC2 endpoint", () => {
    const url = new URL(
      buildAuthorizeUrl({
        subdomain: "vio",
        clientId: "cid",
        redirectUri: "https://mist.example.com/auth/callback",
        state: "st4te",
        codeChallenge: "ch4llenge",
      }),
    );
    expect(url.origin).toBe("https://vio.onelogin.com");
    expect(url.pathname).toBe("/oidc/2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://mist.example.com/auth/callback",
    );
  });
});

describe("exchangeCode", () => {
  it("posts the code with PKCE verifier and returns the id_token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id_token: "the-id-token" })),
    );

    const result = await exchangeCode({
      subdomain: "vio",
      clientId: "cid",
      clientSecret: "cs",
      code: "authcode",
      redirectUri: "https://mist.example.com/auth/callback",
      codeVerifier: "verif",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.id_token).toBe("the-id-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://vio.onelogin.com/oidc/2/token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authcode");
    expect(body.get("code_verifier")).toBe("verif");
    // Credentials travel via client_secret_basic, not in the body
    expect(body.get("client_secret")).toBeNull();
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("cid:cs")}`);
  });

  it("throws on a non-OK token response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    await expect(
      exchangeCode({
        subdomain: "vio",
        clientId: "cid",
        clientSecret: "cs",
        code: "authcode",
        redirectUri: "https://x/auth/callback",
        codeVerifier: "verif",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow("token exchange failed");
  });
});

/* ------------------------------------------------------------------ */
/*  ID token verification against mocked JWKS                          */
/* ------------------------------------------------------------------ */

const ISSUER = oidcIssuer("vio");
const CLIENT_ID = "cid";

async function makeSigningSetup() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
    kid?: string;
  };
  jwk.kid = "key-1";
  return { keyPair, jwk };
}

async function makeIdToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  kid = "key-1",
): Promise<string> {
  const enc = (obj: object) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc({ alg: "RS256", typ: "JWT", kid })}.${enc(claims)}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

function jwksFetch(jwk: JsonWebKey) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] })));
}

describe("verifyIdToken", () => {
  it("accepts a valid token and returns the email", async () => {
    const { keyPair, jwk } = await makeSigningSetup();
    const idToken = await makeIdToken(keyPair.privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: futureExp(),
      email: "pavel@vio.com",
    });

    const email = await verifyIdToken({
      idToken,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
    });
    expect(email).toBe("pavel@vio.com");
  });

  it("rejects a token signed with a different key", async () => {
    const { keyPair } = await makeSigningSetup();
    const other = await makeSigningSetup();
    const idToken = await makeIdToken(keyPair.privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: futureExp(),
      email: "pavel@vio.com",
    });

    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: jwksFetch(other.jwk) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("signature verification failed");
  });

  it("rejects wrong issuer, wrong audience, and expired tokens", async () => {
    const { keyPair, jwk } = await makeSigningSetup();
    const base = { aud: CLIENT_ID, exp: futureExp(), email: "p@vio.com" };

    const wrongIss = await makeIdToken(keyPair.privateKey, {
      ...base,
      iss: "https://evil.onelogin.com/oidc/2",
    });
    await expect(
      verifyIdToken({
        idToken: wrongIss,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("issuer mismatch");

    const wrongAud = await makeIdToken(keyPair.privateKey, {
      ...base,
      iss: ISSUER,
      aud: "someone-else",
    });
    await expect(
      verifyIdToken({
        idToken: wrongAud,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("audience mismatch");

    const expired = await makeIdToken(keyPair.privateKey, {
      ...base,
      iss: ISSUER,
      exp: futureExp(-60),
    });
    await expect(
      verifyIdToken({
        idToken: expired,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("expired");
  });

  it("rejects a token missing the email claim", async () => {
    const { keyPair, jwk } = await makeSigningSetup();
    const idToken = await makeIdToken(keyPair.privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: futureExp(),
    });
    await expect(
      verifyIdToken({
        idToken,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("missing email");
  });

  it("falls back to preferred_username when email is absent", async () => {
    const { keyPair, jwk } = await makeSigningSetup();
    const idToken = await makeIdToken(keyPair.privateKey, {
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: futureExp(),
      preferred_username: "pavel@vio.com",
    });
    const email = await verifyIdToken({
      idToken,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      fetchImpl: jwksFetch(jwk) as unknown as typeof fetch,
    });
    expect(email).toBe("pavel@vio.com");
  });

  it("rejects non-RS256 algorithms (alg confusion)", async () => {
    const enc = (obj: object) =>
      base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
    const forged = `${enc({ alg: "none" })}.${enc({
      iss: ISSUER,
      aud: CLIENT_ID,
      exp: futureExp(),
      email: "evil@vio.com",
    })}.`;
    await expect(
      verifyIdToken({
        idToken: forged,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toThrow("unsupported ID token alg");
  });
});

/* ------------------------------------------------------------------ */
/*  base64url                                                          */
/* ------------------------------------------------------------------ */

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it("produces URL-safe output without padding", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 239, 190]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});
