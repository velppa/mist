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
});
