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

export interface ThreadData {
  id: string;
  commentText: string;
  highlightText?: string;
  author: UserInfo;
  createdAt: number;
  resolved: boolean;
  replies: ThreadReply[];
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
  createdAt: number;
  updatedAt: number;
}

export interface CapturedSelection {
  from: number;
  to: number;
  text: string;
}
