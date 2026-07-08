// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

describe("MobilePanel", () => {
  it("renders three tab buttons", () => {
    const { getAllByRole } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toBe("Editing");
    expect(buttons[1].textContent).toBe("Comments");
    expect(buttons[2].textContent).toBe("Preview");
  });

  it("clicking a tab shows corresponding content, clicking again collapses", () => {
    const { getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { mode: "suggest" } },
    );

    // Editing tab starts active, should show ModeToggle content
    expect(queryByText("Suggest changes")).toBeTruthy();

    // Click Comments tab
    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comments (0)")).toBeTruthy();

    // Click Comments tab again to collapse
    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comments (0)")).toBeFalsy();
  });

  it("editing tab renders ModeToggle and SuggestionActions", () => {
    const { getByText, getByLabelText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );

    // Editing tab is active by default
    expect(getByText("Suggest changes")).toBeTruthy();
    expect(getByLabelText("Toggle suggest mode")).toBeTruthy();
  });

  it("comments tab renders CommentInput and ThreadList", () => {
    const { getByText, queryByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { commentActive: true } },
    );

    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comment")).toBeTruthy();
    expect(queryByText("No comments yet")).toBeTruthy();
  });
});
