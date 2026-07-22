import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnimationSettings } from "./useAnimationSettings";

const LEVEL_KEY = "crusade-deck:anim-level";
const SPEED_KEY = "crusade-deck:anim-speed";
const LEGACY_KEY = "crusade-deck:animations-enabled";

function mockMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion }) as unknown as typeof window.matchMedia;
}

describe("useAnimationSettings", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("по умолчанию — полная анимация, скорость 1x, если нет системного предпочтения", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings).toEqual({ level: "full", speed: 1 });
    expect(result.current.motionEnabled).toBe(true);
  });

  it("системное «меньше движения» → уровень выкл", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("off");
    expect(result.current.motionEnabled).toBe(false);
  });

  it("сохранённый уровень важнее системного", () => {
    mockMatchMedia(true);
    localStorage.setItem(LEVEL_KEY, "moderate");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("moderate");
  });

  it("миграция со старого boolean-тумблера: 0 → выкл", () => {
    mockMatchMedia(false);
    localStorage.setItem(LEGACY_KEY, "0");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings.level).toBe("off");
  });

  it("setLevel/setSpeed меняют и сохраняют значения", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useAnimationSettings());

    act(() => result.current.setLevel("moderate"));
    act(() => result.current.setSpeed(4));

    expect(result.current.settings).toEqual({ level: "moderate", speed: 4 });
    expect(localStorage.getItem(LEVEL_KEY)).toBe("moderate");
    expect(localStorage.getItem(SPEED_KEY)).toBe("4");
  });

  it("битые значения в localStorage → безопасные дефолты", () => {
    mockMatchMedia(false);
    localStorage.setItem(LEVEL_KEY, "turbo");
    localStorage.setItem(SPEED_KEY, "7");
    const { result } = renderHook(() => useAnimationSettings());
    expect(result.current.settings).toEqual({ level: "full", speed: 1 });
  });
});
