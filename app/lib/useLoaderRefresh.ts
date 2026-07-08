import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

export const HOME_REFRESH_INTERVAL_MS = 10_000;

/**
 * Keep loader data fresh without a reload: revalidate when the tab
 * regains focus/visibility and on a modest interval while visible.
 * Polling rides the existing loader — no extra realtime infra.
 */
export function useLoaderRefresh(intervalMs: number = HOME_REFRESH_INTERVAL_MS) {
  const revalidator = useRevalidator();
  // The revalidator object is recreated on state changes; a ref keeps
  // the listeners/interval stable across renders.
  const revalidateRef = useRef(revalidator.revalidate);
  useEffect(() => {
    revalidateRef.current = revalidator.revalidate;
  }, [revalidator.revalidate]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void revalidateRef.current();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, intervalMs);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [intervalMs]);
}
