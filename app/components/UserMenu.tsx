import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Link } from "react-router";
import { useDocument } from "~/lib/DocumentContext";

/** Signed-in user's menu: shown only when a session email exists. */
export default function UserMenu() {
  const { userEmail } = useDocument();

  if (!userEmail) return null;

  return (
    <div className="shrink-0 border-l border-border">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="flex h-full cursor-pointer items-center gap-1 px-3 text-sm lowercase transition-colors hover:bg-border"
            aria-label="User menu"
          >
            {userEmail}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="min-w-40 border border-border bg-paper py-1"
            align="end"
            sideOffset={4}
          >
            <DropdownMenu.Item asChild>
              <Link
                to="/tokens"
                className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
              >
                API tokens
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => {
                // Server route must clear the cookie — full navigation, not SPA
                window.location.href = "/auth/logout";
              }}
              className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm outline-none data-[highlighted]:bg-border"
            >
              Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
