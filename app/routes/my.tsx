import { redirect } from "react-router";

/**
 * The documents list lives on the homepage's default "My documents" tab now;
 * the old standalone page survives only as a redirect for bookmarks.
 */
export async function loader() {
  throw redirect("/");
}

export default function MyDocs() {
  return null;
}
