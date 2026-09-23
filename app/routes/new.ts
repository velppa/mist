import { redirect } from "react-router";
import type { Route } from "./+types/new";
import { getCloudflare } from "~/lib/cloudflare.server";
import { handleNewDocument } from "~/lib/new.server";

export function loader() {
  return redirect("/");
}

export function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  return handleNewDocument(request, env);
}
