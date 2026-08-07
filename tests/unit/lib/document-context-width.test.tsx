// @vitest-environment jsdom
import React from "react"; // classic JSX transform in vitest needs React in scope
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import * as Y from "yjs";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import type { useYjsEditor } from "~/lib/useYjsEditor";

type Yjs = ReturnType<typeof useYjsEditor>;

function makeYjs(): Yjs {
  const doc = new Y.Doc();
  return {
    doc,
    awareness: {} as Yjs["awareness"],
    socket: null as unknown as Yjs["socket"],
    synced: true,
    user: { name: "Test User", color: "#000", colorLight: "#ccc" },
    mode: "edit",
    setMode: vi.fn(),
    docState: doc.getMap<string>("docState"),
    isOnboarding: false,
  };
}

function Probe() {
  const { docWidth, setDocWidth } = useDocument();
  const location = useLocation();
  return (
    <div>
      <span data-testid="width">{docWidth}</span>
      <span data-testid="search">{location.search}</span>
      <button onClick={() => setDocWidth("full")}>full</button>
    </div>
  );
}

function renderDocAt(url: string) {
  const Stub = createRoutesStub([
    {
      path: "/docs/:id",
      Component: () => (
        <DocumentProvider docId="abc12345" createdAt={null} yjs={makeYjs()}>
          <Probe />
        </DocumentProvider>
      ),
    },
  ]);
  return render(<Stub initialEntries={[url]} />);
}

describe("document width from URL", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the default width without a stored preference or param", () => {
    const { getByTestId } = renderDocAt("/docs/abc12345");
    expect(getByTestId("width").textContent).toBe("120");
  });

  it("uses the stored preference when the link carries no width", () => {
    localStorage.setItem("mist-doc-width", "65");
    const { getByTestId } = renderDocAt("/docs/abc12345");
    expect(getByTestId("width").textContent).toBe("65");
  });

  it("lets ?width= override the stored preference", () => {
    localStorage.setItem("mist-doc-width", "65");
    const { getByTestId } = renderDocAt("/docs/abc12345?width=full");
    expect(getByTestId("width").textContent).toBe("full");
  });

  it("ignores an unknown ?width value", () => {
    localStorage.setItem("mist-doc-width", "65");
    const { getByTestId } = renderDocAt("/docs/abc12345?width=banana");
    expect(getByTestId("width").textContent).toBe("65");
  });

  it("does not persist the override", () => {
    renderDocAt("/docs/abc12345?width=full");
    expect(localStorage.getItem("mist-doc-width")).toBeNull();
  });

  it("picking a width drops the override and stores the choice", () => {
    const { getByTestId, getByText } = renderDocAt("/docs/abc12345?width=65&view=edit");
    fireEvent.click(getByText("full"));
    expect(getByTestId("width").textContent).toBe("full");
    expect(getByTestId("search").textContent).toBe("?view=edit");
    expect(localStorage.getItem("mist-doc-width")).toBe("full");
  });
});
