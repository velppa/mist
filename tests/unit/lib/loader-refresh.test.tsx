// @vitest-environment jsdom
import React from "react"; // classic JSX transform in vitest needs React in scope
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import {
  useLoaderRefresh,
  HOME_REFRESH_INTERVAL_MS,
} from "~/lib/useLoaderRefresh";

function Probe() {
  useLoaderRefresh();
  return <div>home</div>;
}

function renderWithLoader() {
  const loader = vi.fn().mockResolvedValue(null);
  const Stub = createRoutesStub([{ path: "/", Component: Probe, loader }]);
  render(<Stub initialEntries={["/"]} />);
  return loader;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useLoaderRefresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("revalidates when the window regains focus", async () => {
    const loader = renderWithLoader();
    await flush();
    const before = loader.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();

    expect(loader.mock.calls.length).toBeGreaterThan(before);
  });

  it("revalidates when the tab becomes visible", async () => {
    const loader = renderWithLoader();
    await flush();
    const before = loader.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(loader.mock.calls.length).toBeGreaterThan(before);
  });

  it("revalidates on the polling interval", async () => {
    vi.useFakeTimers();
    const loader = renderWithLoader();
    await flush();
    const before = loader.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOME_REFRESH_INTERVAL_MS + 50);
    });

    expect(loader.mock.calls.length).toBeGreaterThan(before);
  });

  it("does not revalidate while the tab is hidden", async () => {
    vi.useFakeTimers();
    const loader = renderWithLoader();
    await flush();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const before = loader.mock.calls.length;

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(HOME_REFRESH_INTERVAL_MS + 50);
    });

    expect(loader.mock.calls.length).toBe(before);
  });
});
