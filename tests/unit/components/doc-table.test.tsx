// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import DocTable from "~/components/DocTable";
import type { RegistryEntry } from "~/shared/types";

const doc: RegistryEntry = {
  id: "4q5dalwz", format: "html",
  title: "SAPI Override Generator",
  author: "pavel@vio.com",
  listed: true,
  createdAt: 1,
  updatedAt: 2,
};

describe("DocTable", () => {
  it("links documents through their title alias", () => {
    const { getByText } = render(
      createElement(MemoryRouter, null, createElement(DocTable, { documents: [doc] })),
    );
    const link = getByText("SAPI Override Generator").closest("a")!;
    expect(link.getAttribute("href")).toBe(
      "/docs/sapi-override-generator-4q5dalwz.html",
    );
  });

  it("falls back to the plain id when the title yields no slug", () => {
    const { getByText } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(DocTable, { documents: [{ ...doc, title: "!!!" }] }),
      ),
    );
    const link = getByText("!!!").closest("a")!;
    expect(link.getAttribute("href")).toBe("/docs/4q5dalwz.html");
  });

  it("status cell is plain text without a toggle callback", () => {
    const { getByText } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(DocTable, { documents: [doc], showListed: true }),
      ),
    );
    expect(getByText("listed").closest("button")).toBeNull();
  });

  it("status cell toggles through the callback", () => {
    const calls: string[] = [];
    const { getByText } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(DocTable, {
          documents: [doc],
          showListed: true,
          onToggleListed: (d) => calls.push(d.id),
        }),
      ),
    );
    const btn = getByText("listed").closest("button")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    btn.click();
    expect(calls).toEqual(["4q5dalwz"]);
  });

  it("disables the toggle while a flip is pending", () => {
    const { getByText } = render(
      createElement(
        MemoryRouter,
        null,
        createElement(DocTable, {
          documents: [doc],
          showListed: true,
          onToggleListed: () => {},
          pendingListedId: "4q5dalwz",
        }),
      ),
    );
    const btn = getByText("listed").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
