// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import ThreadList from "~/components/ThreadList";

const makeThread = (overrides = {}) => ({
  id: "t1",
  commentText: "Test comment",
  author: { name: "Alice", color: "#000", colorLight: "#ccc" },
  createdAt: Date.now(),
  resolved: false,
  replies: [],
  position: 0,
  ...overrides,
});

describe("ThreadList", () => {
  it("shows thread count and 'No comments yet' when empty", () => {
    const { getByText } = renderWithDocument(createElement(ThreadList));
    expect(getByText("Comments (0)")).toBeTruthy();
    expect(getByText("No comments yet")).toBeTruthy();
  });

  it("renders ThreadPanel for each open thread with separator borders", () => {
    const threads = [
      makeThread({ id: "t1", commentText: "First" }),
      makeThread({ id: "t2", commentText: "Second" }),
    ];
    const { getByText, container } = renderWithDocument(createElement(ThreadList), {
      context: { threads },
    });
    expect(getByText("Comments (2)")).toBeTruthy();
    expect(getByText("First")).toBeTruthy();
    expect(getByText("Second")).toBeTruthy();

    // Each thread wrapper has border-b separator
    const separators = container.querySelectorAll(".border-b.border-border");
    expect(separators.length).toBe(2);
  });

  it("'Show resolved' toggle reveals resolved threads", () => {
    const threads = [
      makeThread({ id: "t1", commentText: "Open thread" }),
      makeThread({ id: "t2", commentText: "Resolved thread", resolved: true }),
    ];
    const { getByText, queryByText } = renderWithDocument(
      createElement(ThreadList),
      { context: { threads } },
    );

    expect(getByText("Comments (1)")).toBeTruthy();
    expect(queryByText("Resolved thread")).toBeFalsy();
    expect(getByText("Show resolved (1)")).toBeTruthy();

    fireEvent.click(getByText("Show resolved (1)"));
    expect(queryByText("Resolved thread")).toBeTruthy();
  });

  it("new comment button calls openCommentInput when the editor is mounted", () => {
    const { contextValue, getByLabelText } = renderWithDocument(
      createElement(ThreadList),
      { context: { editorInstance: {} as never } },
    );

    fireEvent.click(getByLabelText("New comment"));
    expect(contextValue.openCommentInput).toHaveBeenCalledOnce();
  });

  it("hides the new comment button without an editor (preview)", () => {
    const { queryByLabelText } = renderWithDocument(createElement(ThreadList));
    expect(queryByLabelText("New comment")).toBeNull();
  });
});
