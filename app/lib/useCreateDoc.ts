import { useCallback } from "react";
import { useNavigate } from "react-router";
import { generateDocumentId } from "~/shared/constants";

/**
 * Document creation shared by the homepage toolbar and the doc-page
 * header: a blank note, or one built from an uploaded file whose
 * extension decides the format.
 */
export function useCreateDoc() {
  const navigate = useNavigate();

  const createNew = useCallback(async () => {
    const id = generateDocumentId();
    await fetch(`/agents/document-agent/${id}`, { method: "POST" });
    // Creators land in edit mode; shared links open in preview by default
    navigate(`/docs/${id}?view=edit`);
  }, [navigate]);

  const uploadFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      // File extension decides the note format; frontmatter/threads are
      // a markdown concept.
      const ext = file.name.match(/\.(txt|html?|jsx|ipynb)$/i)?.[1]?.toLowerCase();
      const format =
        ext === "txt"
          ? "txt"
          : ext === "jsx"
            ? "jsx"
            : ext === "ipynb"
              ? "ipynb"
              : ext
                ? "html"
                : "md";
      const id = generateDocumentId();
      await fetch(`/agents/document-agent/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mist-format": format },
        body: JSON.stringify({ content: text }),
      });

      navigate(`/docs/${id}?view=edit`);
    },
    [navigate],
  );

  return { createNew, uploadFile };
}
