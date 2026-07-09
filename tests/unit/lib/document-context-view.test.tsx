// @vitest-environment jsdom
import React from "react"; // classic JSX transform in vitest needs React in scope
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createRoutesStub, useLocation } from "react-router";
import * as Y from "yjs";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import type { useYjsEditor } from "~/lib/useYjsEditor";

type Yjs = ReturnType<typeof useYjsEditor>;

// Real Y.Doc so useThreads can observe maps; network bits are stubbed
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
  const { showPreview, togglePreview } = useDocument();
  const location = useLocation();
  return (
    <div>
      <span data-testid="view">{showPreview ? "preview" : "edit"}</span>
      <span data-testid="search">{location.search}</span>
      <button onClick={togglePreview}>toggle</button>
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

describe("document view mode from URL", () => {
  it("opens in preview by default (no query param)", () => {
    const { getByTestId } = renderDocAt("/docs/abc12345");
    expect(getByTestId("view").textContent).toBe("preview");
  });

  it("opens in edit mode with ?view=edit", () => {
    const { getByTestId } = renderDocAt("/docs/abc12345?view=edit");
    expect(getByTestId("view").textContent).toBe("edit");
  });

  it("opens in preview with explicit ?view=preview", () => {
    const { getByTestId } = renderDocAt("/docs/abc12345?view=preview");
    expect(getByTestId("view").textContent).toBe("preview");
  });

  it("opens in preview for unknown ?view values", () => {
    const { getByTestId } = renderDocAt("/docs/abc12345?view=nonsense");
    expect(getByTestId("view").textContent).toBe("preview");
  });

  it("toggling to edit updates the URL so the link is shareable", () => {
    const { getByTestId, getByText } = renderDocAt("/docs/abc12345");
    fireEvent.click(getByText("toggle"));
    expect(getByTestId("view").textContent).toBe("edit");
    expect(getByTestId("search").textContent).toBe("?view=edit");
  });

  it("toggling back to preview removes the param", () => {
    const { getByTestId, getByText } = renderDocAt("/docs/abc12345?view=edit");
    fireEvent.click(getByText("toggle"));
    expect(getByTestId("view").textContent).toBe("preview");
    expect(getByTestId("search").textContent).toBe("");
  });

  it("toggling preserves unrelated query params", () => {
    const { getByTestId, getByText } = renderDocAt("/docs/abc12345?foo=bar");
    fireEvent.click(getByText("toggle"));
    expect(getByTestId("search").textContent).toContain("foo=bar");
    expect(getByTestId("search").textContent).toContain("view=edit");
  });
});

describe("editor-less preview text", () => {
  function ProbeMarkdown() {
    const { markdown } = useDocument();
    return <span data-testid="md">{markdown}</span>;
  }

  it("derives markdown from the Yjs doc when no editor is mounted", async () => {
    const yjs = makeYjs();
    yjs.doc.transact(() => {
      const frag = yjs.doc.getXmlFragment("default");
      const para = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      para.insert(0, [text]);
      text.insert(0, "hello ", {});
      text.insert(6, "world", { criticAddition: {} });
      frag.insert(0, [para]);
    });

    const Stub = createRoutesStub([
      {
        path: "/docs/:id",
        Component: () => (
          <DocumentProvider docId="abc12345" createdAt={null} yjs={yjs}>
            <ProbeMarkdown />
          </DocumentProvider>
        ),
      },
    ]);
    const { getByTestId, findByTestId } = render(
      <Stub initialEntries={["/docs/abc12345"]} />,
    );
    expect(getByTestId("md").textContent).toBe("hello {++world++}");

    // Remote updates keep flowing without an editor
    yjs.doc.transact(() => {
      const frag = yjs.doc.getXmlFragment("default");
      const para = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      para.insert(0, [text]);
      text.insert(0, "tail", {});
      frag.insert(frag.length, [para]);
    });
    const el = await findByTestId("md");
    expect(el.textContent).toBe("hello {++world++}\ntail");
  });
});
