import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentFetch } = vi.hoisted(() => ({ mockAgentFetch: vi.fn() }));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

import { getAgentByName } from "agents";
import { isPublicDocumentPage } from "~/lib/public-access.server";

const env = { DocumentAgent: {} };

function docMeta(fields: Record<string, unknown>) {
  mockAgentFetch.mockImplementation(async () => new Response(JSON.stringify(fields)));
}

describe("isPublicDocumentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens /raw and /render of a public document", async () => {
    docMeta({ exists: true, publicAccess: true });
    expect(await isPublicDocumentPage("/raw/abcd1234", env)).toBe(true);
    expect(await isPublicDocumentPage("/render/abcd1234", env)).toBe(true);
  });

  it("resolves title aliases to the canonical document", async () => {
    docMeta({ exists: true, publicAccess: true });
    expect(await isPublicDocumentPage("/render/my-title-abcd1234.md", env)).toBe(true);
    expect(vi.mocked(getAgentByName).mock.calls.at(-1)![1]).toBe("abcd1234");
  });

  it("keeps private and missing documents closed", async () => {
    docMeta({ exists: true, publicAccess: false });
    expect(await isPublicDocumentPage("/raw/abcd1234", env)).toBe(false);

    docMeta({ exists: false, publicAccess: true });
    expect(await isPublicDocumentPage("/raw/abcd1234", env)).toBe(false);
  });

  it("never opens other pages, even of a public document", async () => {
    docMeta({ exists: true, publicAccess: true });
    for (const path of ["/docs/abcd1234", "/", "/my", "/raw/abcd1234/extra", "/raw/!bad!"]) {
      expect(await isPublicDocumentPage(path, env)).toBe(false);
    }
    expect(mockAgentFetch).not.toHaveBeenCalled();
  });

  it("stays closed when the document cannot be reached", async () => {
    mockAgentFetch.mockRejectedValue(new Error("boom"));
    expect(await isPublicDocumentPage("/raw/abcd1234", env)).toBe(false);
  });
});
