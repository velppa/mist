// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import PreviewToggle from "~/components/PreviewToggle";

describe("PreviewToggle", () => {
  it("labels the action: Edit while in preview mode (default URL)", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: true },
    });
    const button = getByText("Edit");
    expect(button.className).toContain("bg-ink");
  });

  it("labels the action: Preview while in edit mode", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: false },
      url: "/docs/abc?view=edit",
    });
    const button = getByText("Preview");
    expect(button.className).toContain("text-muted");
  });

  it("label follows the URL mode, not the transient peek", () => {
    // Peek (showPreview true) while the URL still says edit
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: true },
      url: "/docs/abc?view=edit",
    });
    expect(getByText("Preview")).toBeTruthy();
  });

  it("click calls togglePreview", () => {
    const { contextValue, getByText } = renderWithDocument(
      createElement(PreviewToggle),
      { url: "/docs/abc?view=edit" },
    );
    fireEvent.click(getByText("Preview"));
    expect(contextValue.togglePreview).toHaveBeenCalledOnce();
  });

  it("shows spinner when not synced and not active", () => {
    const { container } = renderWithDocument(createElement(PreviewToggle), {
      context: {
        showPreview: false,
        yjs: {
          doc: {} as never,
          awareness: {} as never,
          socket: null as never,
          synced: false,
          user: { name: "Test", color: "#000", colorLight: "#ccc" },
          mode: "edit" as const,
          setMode: () => {},
          docState: {} as never,
        },
      },
    });
    expect(container.querySelector("svg.animate-spin")).toBeTruthy();
  });
});
