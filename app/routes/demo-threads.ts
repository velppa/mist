import type { ThreadData } from "~/shared/types";

/**
 * Comment threads of the intro document, shown so a first-time visitor
 * sees what a conversation on a document looks like. They anchor to text
 * in `demo.md` by quote, so the two files change together.
 */
export const demoThreads: ThreadData[] = [
  {
    id: "demo-1",
    commentText: "Should we use a stronger word here?",
    highlightText: "good",
    author: { name: "Alice", color: "#E57373", colorLight: "#E57373" },
    createdAt: Date.parse("2026-02-01T10:00:00Z"),
    resolved: false,
    replies: [
      {
        id: "demo-1-r0",
        author: { name: "Bob", color: "#64B5F6", colorLight: "#64B5F6" },
        text: "How about 'excellent'?",
        createdAt: Date.parse("2026-02-01T10:05:00Z"),
      },
    ],
  },
  {
    id: "demo-2",
    commentText: "This paragraph needs a citation.",
    author: { name: "Alice", color: "#E57373", colorLight: "#E57373" },
    createdAt: Date.parse("2026-02-01T11:00:00Z"),
    resolved: false,
    replies: [],
  },
];
