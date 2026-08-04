/**
 * /my: the standalone page became the homepage's "My documents" tab;
 * the route only redirects bookmarks there.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("react-router", () => ({
  redirect: (url: string) =>
    new Response(null, { status: 302, headers: { Location: url } }),
}));

import { loader } from "~/routes/my";

describe("/my", () => {
  it("redirects to the homepage tab", async () => {
    try {
      await loader();
      expect.unreachable("loader should redirect");
    } catch (res) {
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(302);
      expect((res as Response).headers.get("Location")).toBe("/?tab=my");
    }
  });
});
