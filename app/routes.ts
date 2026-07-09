import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("new", "routes/new.ts"),
  route("auth/login", "routes/auth.login.ts"),
  route("auth/callback", "routes/auth.callback.ts"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("tokens", "routes/tokens.tsx"),
  route("my", "routes/my.tsx"),
  route("docs/:id", "routes/docs.$id.tsx"),
  route("raw/:id", "routes/raw.$id.ts"),
  route("render/:id", "routes/render.$id.ts"),
] satisfies RouteConfig;
