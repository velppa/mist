export interface UserInfo {
  name: string;
  color: string;
  colorLight: string;
}

export type DocMode = "edit" | "suggest";

export interface ThreadReply {
  id: string;
  author: UserInfo;
  text: string;
  createdAt: number;
}

/**
 * Text-quote selector locating a comment in rendered (preview) text:
 * the exact quote plus surrounding context, re-resolved against the
 * current text on every paint. Positions are hints, never authority.
 */
export interface ThreadAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  posStart: number;
  posEnd: number;
}

export interface ThreadData {
  id: string;
  commentText: string;
  highlightText?: string;
  author: UserInfo;
  createdAt: number;
  resolved: boolean;
  replies: ThreadReply[];
  /** Present on comments made in the HTML preview; absent on editor comments. */
  anchor?: ThreadAnchor;
}

/**
 * A document's entry in the registry that backs the homepage listing.
 * `author` is optional metadata: populated from markdown frontmatter
 * today, and designed to also carry an authenticated author once auth
 * lands.
 */
export interface RegistryEntry {
  id: string;
  title: string;
  author: string | null;
  /** Listed entries appear on the homepage; unlisted only under "My docs". */
  listed: boolean;
  /** Document format ("md", "txt", ...); defaults to markdown. */
  format?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CapturedSelection {
  from: number;
  to: number;
  text: string;
}
