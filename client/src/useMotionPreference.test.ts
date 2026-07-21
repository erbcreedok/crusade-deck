import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMotionPreference } from "./useMotionPreference";

const KEY = "crusade-deck:animations-enabled";

function mockMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion }) as unknown as typeof window.matchMedia;
}

describe("useMotionPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to enabled when the system has no motion preference saved", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.enabled).toBe(true);
  });

  it("defaults to disabled when the system prefers reduced motion", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.enabled).toBe(false);
  });

  it("an explicit saved preference overrides the system setting", () => {
    mockMatchMedia(true); // системный — "меньше анимаций"
    localStorage.setItem(KEY, "1"); // но юзер явно включил анимации
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.enabled).toBe(true);
  });

  it("toggle() flips the value and persists it to localStorage", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useMotionPreference());

    act(() => result.current.toggle());

    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("0");
  });
});
