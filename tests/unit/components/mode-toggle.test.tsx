// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import ModeToggle from "~/components/ModeToggle";

describe("ModeToggle", () => {
  it("keeps the 'Suggest changes' label in both modes", () => {
    for (const mode of ["edit", "suggest"] as const) {
      const { getByText, unmount } = renderWithDocument(
        createElement(ModeToggle),
        { context: { mode } },
      );
      expect(getByText("Suggest changes")).toBeTruthy();
      unmount();
    }
  });

  it("toggle calls toggleMode", () => {
    const { contextValue, getByLabelText } = renderWithDocument(
      createElement(ModeToggle),
    );
    fireEvent.click(getByLabelText("Toggle suggest mode"));
    expect(contextValue.toggleMode).toHaveBeenCalledOnce();
  });
});
